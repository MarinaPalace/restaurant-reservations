import { NextResponse } from "next/server";
import {
  getReservationByPassKey,
  updateReservationSelections,
} from "@/lib/services/reservations";
import { getMenuCatalog, getRestaurantDate } from "@/lib/services/restaurant";
import { validateReservationRequest } from "@/lib/services/booking-rules";
import { getPassKeyByCode } from "@/lib/services/pass-keys";
import { recordAuditEntry } from "@/lib/services/audit-log";
import { canGuestModify } from "@/lib/reservation-policy";
import { canonicalizeSelections } from "@/lib/menu-selection";
import { manageReservationSchema, updateSelectionsSchema } from "@/lib/validation/booking";
import type { ReservationRecord } from "@/types/booking";

/**
 * Guest self-service, authorised by the pass-key.
 *
 * The reservation number deliberately does **not** grant access here. Guests
 * read it out to other rooms so they can be seated together, which would
 * otherwise let any of those rooms change or cancel the booking. The pass-key
 * is the one thing only the guest has.
 *
 * The key travels in the request body rather than the URL, so it does not end
 * up in browser history, proxy logs or a Referer header.
 *
 * Every response for an unusable key is the same 404 as "no such booking", so
 * this cannot be used to work out which keys exist.
 */

const NOT_FOUND = { error: "We could not find a reservation for that pass-key." };

type Resolved = { reservation: ReservationRecord; passKeyId: string };

async function resolveByPassKey(code: string): Promise<Resolved | null> {
  const passKey = await getPassKeyByCode(code);

  // A revoked key loses access to its booking; an expired or spent one keeps
  // it, because the guest still needs to see and cancel the dinner they have.
  if (!passKey || passKey.status === "revoked") {
    return null;
  }

  const reservation = await getReservationByPassKey(passKey.id);
  return reservation ? { reservation, passKeyId: passKey.id } : null;
}

/** Looks up the booking behind a pass-key. */
export async function POST(request: Request) {
  try {
    const parsed = manageReservationSchema.safeParse(await request.json());

    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Please enter your pass-key." },
        { status: 400 },
      );
    }

    const resolved = await resolveByPassKey(parsed.data.passKey);
    if (!resolved) {
      return NextResponse.json(NOT_FOUND, { status: 404 });
    }

    const check = canGuestModify(resolved.reservation);

    return NextResponse.json({
      reservation: resolved.reservation,
      // Lets the guest's screen explain why the buttons are unavailable.
      canModify: check.allowed,
      modificationDeadline: check.deadline.toISOString(),
      modificationBlockedReason: check.reason ?? null,
    });
  } catch (error) {
    console.error("[booking] failed to load reservation by pass-key", error);
    return NextResponse.json({ error: "Unable to load your reservation." }, { status: 500 });
  }
}

/** Changes the menu choices on an existing booking. */
export async function PATCH(request: Request) {
  try {
    const parsed = updateSelectionsSchema.safeParse(await request.json());

    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Please choose a menu option for every course." },
        { status: 400 },
      );
    }

    const resolved = await resolveByPassKey(parsed.data.passKey);
    if (!resolved) {
      return NextResponse.json(NOT_FOUND, { status: 404 });
    }

    const { reservation } = resolved;

    const check = canGuestModify(reservation);
    if (!check.allowed) {
      return NextResponse.json({ error: check.reason, code: "CHANGES_CLOSED" }, { status: 409 });
    }

    const [menu, restaurantDate] = await Promise.all([
      getMenuCatalog(),
      getRestaurantDate(reservation.date),
    ]);

    /**
     * The same rules as a new booking, minus availability: the seats are
     * already held, so a full date must not block an existing guest from
     * swapping a dish.
     */
    const validation = validateReservationRequest({
      roomNumber: reservation.roomNumber,
      guestCount: reservation.guestCount,
      date: reservation.date,
      selections: parsed.data.selections,
      restaurantDate: restaurantDate
        ? { ...restaurantDate, isOpen: true, reservedSeats: 0, remainingSeats: restaurantDate.capacity }
        : null,
      menu,
    });

    if (!validation.ok) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }

    const updated = await updateReservationSelections(
      reservation.reservationNumber,
      canonicalizeSelections(validation.selections, menu),
    );

    if (!updated) {
      return NextResponse.json(NOT_FOUND, { status: 404 });
    }

    await recordAuditEntry({
      action: "reservation:update",
      actor: { kind: "guest", id: resolved.passKeyId, name: `Room ${reservation.roomNumber}` },
      reservationNumber: reservation.reservationNumber,
      summary: "Guest changed their menu choices.",
    });

    return NextResponse.json({ reservation: updated });
  } catch (error) {
    console.error("[booking] failed to update reservation", error);
    return NextResponse.json({ error: "Unable to update this reservation." }, { status: 500 });
  }
}
