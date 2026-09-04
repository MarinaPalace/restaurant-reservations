import { NextResponse } from "next/server";
import { canGuestBookDate } from "@/lib/reservation-policy";
import { BOOKING_MESSAGES } from "@/lib/services/booking-rules";
import { getRestaurantDate } from "@/lib/services/restaurant";
import {
  PASS_KEY_MESSAGES,
  describeGuestCountProblem,
  describePassKeyProblem,
  getPassKeyByCode,
  isDateWithinStay,
} from "@/lib/services/pass-keys";
import { SeatHoldError, advanceSeatHoldStep, holdSeats, releaseSeatHold } from "@/lib/services/seat-holds";
import { SEAT_HOLD_MINUTES } from "@/lib/seat-hold";
import {
  advanceSeatHoldSchema,
  createSeatHoldSchema,
  releaseSeatHoldSchema,
} from "@/lib/validation/booking";
import { checkRateLimit, clientKeyFrom } from "@/lib/rate-limit";
import { reportError } from "@/lib/observability";

const GENERIC_ERROR = "Something went wrong while holding your seats. Please try again.";

/**
 * Seats held while a guest finishes booking.
 *
 * ## Why the flow stops here at all
 *
 * It used to be possible for two guests to be shown the same last four seats,
 * both walk the whole flow, and only the second find out — at the end, with
 * every dish chosen — that there had never been room for them. Worse, the
 * screen said nothing about it: they were simply put back on the calendar.
 *
 * So the seats are taken as soon as the guest has said the two things that
 * decide how many they need — the size of the party and the evening — and given
 * back if they do not finish within {@link SEAT_HOLD_MINUTES} minutes. The
 * second guest now meets a full evening on the calendar, before they have spent
 * any time on it, which is a true answer told early rather than a false one told
 * late.
 *
 * ## Every gate the booking itself would apply is applied here
 *
 * Holding seats is not booking, but it takes seats out of the room, so the
 * things that decide whether this guest may have this evening at all are asked
 * now rather than in fifteen minutes: the key is live (rule 2.5 — in the route,
 * never only in the UI), the party is no bigger than the key allows, the evening
 * is inside the stay, it is not a premium evening, and bookings for it have not
 * closed. A guest who would be refused at the end is refused at the start, and
 * an evening's seats are never held out of the room by somebody who could never
 * have had them.
 *
 * The key is *not* spent here. It is spent by the booking, once (rule 2.11), and
 * a hold that expires must leave the guest exactly as they were.
 */
export async function POST(request: Request) {
  // A hold takes seats out of the room, so it is guessable in the same way a
  // booking is and gets the same limit. Generous enough for a guest who changes
  // their mind about the date several times.
  const limit = checkRateLimit(clientKeyFrom(request, "seat-hold"), { limit: 30, windowMs: 60_000 });

  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many attempts. Please wait a moment and try again.", code: "RATE_LIMITED" },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Please choose a date and party size." }, { status: 400 });
  }

  const parsed = createSeatHoldSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Please choose a date and party size.", code: "INVALID_REQUEST" },
      { status: 400 },
    );
  }

  try {
    const [restaurantDate, passKey] = await Promise.all([
      getRestaurantDate(parsed.data.date),
      getPassKeyByCode(parsed.data.passKey),
    ]);

    /**
     * The key is judged before anything else is revealed, so a wrong key cannot
     * be used to probe which evenings have seats left — the same order the
     * booking route uses, for the same reason.
     */
    const keyProblem = describePassKeyProblem(passKey);

    if (keyProblem || !passKey || passKey.kind === "premium") {
      return NextResponse.json(
        {
          error: keyProblem?.message ?? PASS_KEY_MESSAGES.invalid,
          code: `PASS_KEY_${keyProblem?.code ?? "INVALID"}`,
        },
        { status: 403 },
      );
    }

    const guestProblem = describeGuestCountProblem(passKey, parsed.data.guestCount);
    if (guestProblem) {
      return NextResponse.json({ error: guestProblem, code: "PASS_KEY_TOO_MANY_GUESTS" }, { status: 409 });
    }

    if (!isDateWithinStay(passKey, parsed.data.date)) {
      return NextResponse.json(
        { error: PASS_KEY_MESSAGES.afterStay, code: "PASS_KEY_AFTER_STAY" },
        { status: 409 },
      );
    }

    // A premium evening belongs to the invitation flow, and its seats are not
    // the everyday flow's to hold.
    if (restaurantDate?.premium) {
      return NextResponse.json(
        { error: BOOKING_MESSAGES.unavailable, code: "DATE_UNAVAILABLE" },
        { status: 409 },
      );
    }

    if (restaurantDate && !canGuestBookDate(restaurantDate).allowed) {
      return NextResponse.json(
        { error: BOOKING_MESSAGES.bookingClosed, code: "BOOKING_CLOSED" },
        { status: 409 },
      );
    }

    const hold = await holdSeats({
      date: parsed.data.date,
      guests: parsed.data.guestCount,
      passKeyId: passKey.id,
      // The room the guest typed, so an unfinished attempt has a name on it.
      // The key's own room is the fallback: it is the one reception issued it
      // for, and it cannot be got wrong by a guest reading a different door.
      roomNumber: parsed.data.roomNumber || passKey.roomNumber,
      previousHoldId: parsed.data.previousHoldId,
    });

    return NextResponse.json({
      hold: {
        holdId: hold.holdId,
        date: hold.date,
        guests: hold.guests,
        expiresAt: hold.expiresAt,
        holdMinutes: SEAT_HOLD_MINUTES,
      },
    });
  } catch (error) {
    /**
     * The evening filled up, or closed, while the guest was on the calendar.
     * A `409` with the codes the calendar already knows, so the screen can say
     * which of the two it was — the whole point of holding seats is that this
     * is heard here rather than after the menu.
     */
    if (error instanceof SeatHoldError) {
      return NextResponse.json(
        {
          error: error.code === "DATE_FULL" ? BOOKING_MESSAGES.fullyBooked : BOOKING_MESSAGES.unavailable,
          code: error.code === "DATE_FULL" ? "DATE_FULL" : "DATE_UNAVAILABLE",
        },
        { status: 409 },
      );
    }

    reportError({ scope: "seat-holds", event: "hold:create", error });
    return NextResponse.json({ error: GENERIC_ERROR }, { status: 500 });
  }
}

/**
 * Gives seats back before the hold runs out.
 *
 * Called when the guest goes back to the calendar, which is the moment they
 * have stopped wanting the evening they were holding. Waiting the full fifteen
 * minutes would keep an evening shut against everybody else for no reason.
 *
 * No pass-key is asked for, and that is safe: the id is the only thing that
 * identifies a hold, it is unguessable, and the worst a stolen one could do is
 * hand seats back to the restaurant. Requiring the key would mean sending it on
 * a request whose whole purpose is to give something up.
 */
export async function DELETE(request: Request) {
  const limit = checkRateLimit(clientKeyFrom(request, "seat-hold"), { limit: 30, windowMs: 60_000 });

  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many attempts. Please wait a moment and try again.", code: "RATE_LIMITED" },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Nothing to release." }, { status: 400 });
  }

  const parsed = releaseSeatHoldSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Nothing to release.", code: "INVALID_REQUEST" }, { status: 400 });
  }

  try {
    const released = await releaseSeatHold(parsed.data.holdId);

    // A hold that was already gone is not an error: expiry and this request
    // race every fifteen minutes, and both mean the same thing to the guest.
    return NextResponse.json({ released: Boolean(released) });
  } catch (error) {
    reportError({ scope: "seat-holds", event: "hold:release", error });
    return NextResponse.json({ error: GENERIC_ERROR }, { status: 500 });
  }
}

/**
 * Says how far the guest has got, so an attempt nobody finishes says so.
 *
 * This is the difference between a log line reading "started a booking" and one
 * reading "was choosing from the menu" — and that is the difference between a
 * record and an answer, when a guest is at the desk insisting they booked.
 *
 * Deliberately unauthenticated beyond holding the id, like the release: the
 * hold id is unguessable, it names no guest, and the worst a stolen one could
 * do is claim somebody got further than they did. Asking for the pass-key on
 * every step of the flow would be a real cost for no real protection.
 *
 * It answers `204` whatever happens. A hold that has expired, been spent, or
 * never existed is not an error the guest should ever see — this runs behind a
 * screen they are in the middle of using, and nothing about their booking
 * depends on it.
 */
export async function PATCH(request: Request) {
  const limit = checkRateLimit(clientKeyFrom(request, "seat-hold"), { limit: 60, windowMs: 60_000 });

  if (!limit.allowed) {
    return new Response(null, { status: 204 });
  }

  try {
    const parsed = advanceSeatHoldSchema.safeParse(await request.json());

    if (parsed.success) {
      await advanceSeatHoldStep(parsed.data.holdId, parsed.data.step);
    }
  } catch (error) {
    // Worth knowing about, never worth showing: the footprint is for staff and
    // the guest is mid-booking.
    reportError({ scope: "seat-holds", event: "hold:step", error });
  }

  return new Response(null, { status: 204 });
}
