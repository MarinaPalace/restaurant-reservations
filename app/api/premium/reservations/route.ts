import { NextResponse } from "next/server";
import {
  BookingError,
  createReservationEntry,
  reserveReservationNumber,
} from "@/lib/services/reservations";
import {
  PASS_KEY_MESSAGES,
  consumePassKey,
  describeGuestCountProblem,
  describePassKeyProblem,
  getPassKeyByCode,
  releasePassKey,
} from "@/lib/services/pass-keys";
import { recordAuditEntry } from "@/lib/services/audit-log";
import { checkRateLimit, clientKeyFrom } from "@/lib/rate-limit";
import { getMenuCatalog, getRestaurantDate } from "@/lib/services/restaurant";
import { BOOKING_MESSAGES, validateReservationRequest } from "@/lib/services/booking-rules";
import { premiumReservationSchema } from "@/lib/validation/booking";
import { describeContactProblem, normalizeContact } from "@/lib/contact";
import { canonicalizeSelections } from "@/lib/menu-selection";

const GENERIC_ERROR = "Something went wrong while creating your reservation. Please try again.";

/**
 * Bookings from the invitation flow.
 *
 * These guests are not staying yet, so they give a name rather than a room,
 * they order from the premium menu, and they may only choose an evening that
 * has been opened for them.
 */
export async function POST(request: Request) {
  const limit = checkRateLimit(clientKeyFrom(request, "premium"), { limit: 12, windowMs: 60_000 });

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
    return NextResponse.json({ error: "Please check the reservation details." }, { status: 400 });
  }

  const parsed = premiumReservationSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Please check the reservation details." },
      { status: 400 },
    );
  }

  const contactProblem = describeContactProblem(parsed.data.contact);
  if (contactProblem) {
    return NextResponse.json({ error: contactProblem, code: "INVALID_REQUEST" }, { status: 400 });
  }

  let claimedKeyId: string | null = null;
  let claimedReservationNumber: string | null = null;

  try {
    const [menu, restaurantDate, passKey] = await Promise.all([
      getMenuCatalog("en", "premium"),
      getRestaurantDate(parsed.data.date),
      getPassKeyByCode(parsed.data.passKey),
    ]);

    /**
     * The invitation key is what makes this link private. Without it anyone
     * who came across the address could take a seat held for an invited
     * guest — the hole that was left open when /premium was only obscure.
     *
     * An in-house key is refused here on purpose: the two flows have separate
     * menus and separate evenings, so a key belongs to exactly one of them.
     */
    const keyProblem = describePassKeyProblem(passKey);
    if (keyProblem || !passKey || passKey.kind !== "premium") {
      return NextResponse.json(
        {
          error: keyProblem?.message ?? PASS_KEY_MESSAGES.invalid,
          code: `PASS_KEY_${keyProblem?.code ?? "INVALID"}`,
        },
        { status: 403 },
      );
    }

    // An evening that is not marked premium is not on offer here, however
    // valid it may be for hotel guests.
    if (!restaurantDate?.premium) {
      return NextResponse.json(
        { error: "That evening is not part of this invitation. Please choose one of the dates offered." },
        { status: 409 },
      );
    }

    const guestProblem = describeGuestCountProblem(passKey, parsed.data.guestCount);
    if (guestProblem) {
      return NextResponse.json({ error: guestProblem, code: "PASS_KEY_TOO_MANY_GUESTS" }, { status: 409 });
    }

    const validation = validateReservationRequest({
      // Invited guests have no room; the rules only need a usable label.
      roomNumber: "INVITED",
      guestCount: parsed.data.guestCount,
      date: parsed.data.date,
      selections: parsed.data.selections,
      restaurantDate,
      menu,
    });

    if (!validation.ok) {
      const unavailable =
        validation.error === BOOKING_MESSAGES.unavailable ||
        validation.error === BOOKING_MESSAGES.fullyBooked ||
        validation.error === BOOKING_MESSAGES.pastDate;

      return NextResponse.json(
        { error: validation.error, code: unavailable ? "DATE_UNAVAILABLE" : "INVALID_REQUEST" },
        { status: unavailable ? 409 : 400 },
      );
    }

    // Spent before the booking is written, and handed back below if the write
    // fails — the same shape as the in-house flow.
    claimedReservationNumber = await reserveReservationNumber();
    const spent = await consumePassKey(parsed.data.passKey, claimedReservationNumber);

    if (!spent) {
      return NextResponse.json({ error: PASS_KEY_MESSAGES.used, code: "PASS_KEY_USED" }, { status: 409 });
    }

    claimedKeyId = spent.id;

    const reservation = await createReservationEntry({
      reservationNumber: claimedReservationNumber,
      kind: "premium",
      roomNumber: "",
      guestName: parsed.data.guestName,
      guestCount: parsed.data.guestCount,
      date: parsed.data.date,
      selections: canonicalizeSelections(validation.selections, menu),
      contact: normalizeContact(parsed.data.contact),
      notes: parsed.data.notes,
      passKeyId: spent.id,
    });

    await recordAuditEntry({
      action: "reservation:create",
      actor: { kind: "guest", id: spent.id, name: parsed.data.guestName },
      reservationNumber: reservation.reservationNumber,
      summary: `Invited guest booked ${reservation.guestCount} seat(s) for ${reservation.date}.`,
    });

    return NextResponse.json({ reservation }, { status: 201 });
  } catch (error) {
    if (claimedKeyId && claimedReservationNumber) {
      await releasePassKey(claimedKeyId, claimedReservationNumber).catch((releaseError) => {
        console.error("[premium] failed to release pass-key after a failed booking", releaseError);
      });
    }

    if (error instanceof BookingError) {
      return NextResponse.json(
        {
          error: error.code === "DATE_CLOSED" ? BOOKING_MESSAGES.unavailable : BOOKING_MESSAGES.fullyBooked,
          code: "DATE_UNAVAILABLE",
        },
        { status: 409 },
      );
    }

    console.error("[premium] failed to create reservation", error);
    return NextResponse.json({ error: GENERIC_ERROR }, { status: 500 });
  }
}
