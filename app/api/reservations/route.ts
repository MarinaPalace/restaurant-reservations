import { NextResponse } from "next/server";
import {
  BookingError,
  TableJoinError,
  createReservationEntry,
  reserveReservationNumber,
} from "@/lib/services/reservations";
import { getMenuCatalog, getRestaurantDate } from "@/lib/services/restaurant";
import { BOOKING_MESSAGES, validateReservationRequest } from "@/lib/services/booking-rules";
import {
  PASS_KEY_MESSAGES,
  consumePassKey,
  describeGuestCountProblem,
  describePassKeyProblem,
  getPassKeyByCode,
  isDateWithinStay,
  releasePassKey,
} from "@/lib/services/pass-keys";
import { recordAuditEntry } from "@/lib/services/audit-log";
import { createReservationSchema } from "@/lib/validation/booking";
import { describeContactProblem, normalizeContact } from "@/lib/contact";
import { canonicalizeSelections } from "@/lib/menu-selection";
import { checkRateLimit, clientKeyFrom } from "@/lib/rate-limit";

const GENERIC_ERROR = "Something went wrong while creating your reservation. Please try again.";

/**
 * A guest booking.
 *
 * Two things have to be true and neither is checked in the browser:
 *
 * 1. **They are staying here, long enough to be entitled to dinner.** That is
 *    what the pass-key proves — reception issues one at check-in and only for
 *    a qualifying stay. A room number on its own proves nothing; anyone can
 *    read one off a door.
 * 2. **The evening is one they may book.** Premium evenings are held for
 *    invited guests, and a dinner after check-out is not part of the stay.
 *
 * The key is spent *before* the reservation is written and handed back if the
 * write fails — the same claim-then-release shape the seat accounting uses,
 * and the reason two requests with one key cannot both produce a booking.
 */
export async function POST(request: Request) {
  // A booking presents a pass-key, so this endpoint is guessable in the same
  // way the check endpoint is, and gets the same limit.
  const limit = checkRateLimit(clientKeyFrom(request, "booking"), { limit: 12, windowMs: 60_000 });

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
    return NextResponse.json({ error: "Please enter valid reservation details." }, { status: 400 });
  }

  const parsed = createReservationSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Please enter valid reservation details." },
      { status: 400 },
    );
  }

  let claimedKeyId: string | null = null;
  let claimedReservationNumber: string | null = null;

  try {
    const [menu, restaurantDate, passKey] = await Promise.all([
      getMenuCatalog(),
      getRestaurantDate(parsed.data.date),
      getPassKeyByCode(parsed.data.passKey),
    ]);

    /**
     * The key is judged before anything else is revealed, so a wrong key
     * cannot be used to probe which evenings have seats left.
     */
    const keyProblem = describePassKeyProblem(passKey);

    /**
     * An invitation key is refused here, and an in-house key is refused on the
     * invitation flow. The two have separate menus and separate evenings, so a
     * key belongs to exactly one of them — without this check a premium key
     * booked an everyday evening from the everyday menu, and spent itself
     * doing it.
     */
    if (keyProblem || !passKey || passKey.kind === "premium") {
      return NextResponse.json(
        { error: keyProblem?.message ?? PASS_KEY_MESSAGES.invalid, code: `PASS_KEY_${keyProblem?.code ?? "INVALID"}` },
        { status: 403 },
      );
    }

    /**
     * The party may shrink but never grow: the seats were held for the number
     * on the hotel booking, and no more.
     */
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

    /**
     * A premium evening is held for invited guests. Hiding it from the date
     * list is not enough — the seats have to be defended here too, or a
     * hand-made request could take one.
     */
    if (restaurantDate?.premium) {
      return NextResponse.json(
        { error: BOOKING_MESSAGES.unavailable, code: "DATE_UNAVAILABLE" },
        { status: 409 },
      );
    }

    const validation = validateReservationRequest({
      roomNumber: parsed.data.roomNumber,
      guestCount: parsed.data.guestCount,
      date: parsed.data.date,
      selections: parsed.data.selections,
      restaurantDate,
      menu,
    });

    const contactProblem = describeContactProblem(parsed.data.contact);
    if (contactProblem) {
      return NextResponse.json({ error: contactProblem, code: "INVALID_REQUEST" }, { status: 400 });
    }

    if (!validation.ok) {
      const isAvailabilityProblem =
        validation.error === BOOKING_MESSAGES.unavailable ||
        validation.error === BOOKING_MESSAGES.fullyBooked ||
        validation.error === BOOKING_MESSAGES.pastDate;

      return NextResponse.json(
        { error: validation.error, code: isAvailabilityProblem ? "DATE_UNAVAILABLE" : "INVALID_REQUEST" },
        { status: isAvailabilityProblem ? 409 : 400 },
      );
    }

    /**
     * Spend the key now. `consumePassKey` only matches a key that is still
     * active, so if two requests arrive together exactly one gets a record
     * back and the other is told the key is used.
     *
     * The reservation number is generated here rather than by the service, so
     * the key and the booking it paid for carry the same number even though
     * the key is written first.
     */
    claimedReservationNumber = await reserveReservationNumber();
    const spent = await consumePassKey(parsed.data.passKey, claimedReservationNumber);

    if (!spent) {
      return NextResponse.json({ error: PASS_KEY_MESSAGES.used, code: "PASS_KEY_USED" }, { status: 409 });
    }

    claimedKeyId = spent.id;

    const reservation = await createReservationEntry({
      reservationNumber: claimedReservationNumber,
      roomNumber: parsed.data.roomNumber,
      guestCount: parsed.data.guestCount,
      date: parsed.data.date,
      // Stored in the master English wording, whatever language the guest
      // booked in, so the kitchen always reads one language.
      selections: canonicalizeSelections(validation.selections, menu),
      contact: normalizeContact(parsed.data.contact!),
      notes: parsed.data.notes,
      joinReservationNumber: parsed.data.joinReservationNumber,
      passKeyId: spent.id,
    });

    await recordAuditEntry({
      action: "reservation:create",
      actor: { kind: "guest", id: spent.id, name: `Room ${parsed.data.roomNumber}` },
      reservationNumber: reservation.reservationNumber,
      summary: `Booked ${reservation.guestCount} guest(s) for ${reservation.date} with a pass-key.`,
    });

    return NextResponse.json({ reservation }, { status: 201 });
  } catch (error) {
    // The booking failed after the key was spent, so give it back — otherwise
    // the guest is locked out by a failure that was not theirs.
    if (claimedKeyId && claimedReservationNumber) {
      await releasePassKey(claimedKeyId, claimedReservationNumber).catch((releaseError) => {
        console.error("[reservations] failed to release pass-key after a failed booking", releaseError);
      });
    }

    // The party being joined may have gone away between choosing it and here.
    if (error instanceof TableJoinError) {
      return NextResponse.json({ error: error.message, code: "TABLE_JOIN_FAILED" }, { status: 409 });
    }

    // The date may have filled up between the check above and the write.
    if (error instanceof BookingError) {
      return NextResponse.json(
        {
          error: error.code === "DATE_CLOSED" ? BOOKING_MESSAGES.unavailable : BOOKING_MESSAGES.fullyBooked,
          code: "DATE_UNAVAILABLE",
        },
        { status: 409 },
      );
    }

    console.error("[reservations] failed to create reservation", error);
    return NextResponse.json({ error: GENERIC_ERROR }, { status: 500 });
  }
}
