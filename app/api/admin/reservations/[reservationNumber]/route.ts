import { NextResponse } from "next/server";
import { isDenied, requireStaff } from "@/lib/auth/guard";
import {
  BookingError,
  TableJoinError,
  deleteReservation,
  getReservationByNumber,
  updateReservationDetails,
} from "@/lib/services/reservations";
import { releasePassKey } from "@/lib/services/pass-keys";
import { recordAuditEntry } from "@/lib/services/audit-log";
import { tableSourceOfUser } from "@/lib/auth/permissions";
import { describeReservationChanges, summariseChanges } from "@/lib/reservation-changes";
import { getMenuCatalog, getRestaurantDate } from "@/lib/services/restaurant";
import { validateReservationRequest } from "@/lib/services/booking-rules";
import { staffReservationPatchSchema } from "@/lib/validation/booking";
import { normalizeContact } from "@/lib/contact";
import { canonicalizeSelections } from "@/lib/menu-selection";
import { pruneSelectionsToGuestCount } from "@/lib/booking-session";

/**
 * Staff edit of any part of a booking: courses, date, party size, comment,
 * contact, room or table. Unlike the guest route this has no cutoff — the
 * whole point is that reception can fix things late.
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ reservationNumber: string }> }) {
  const auth = await requireStaff("reservations:edit");
  if (isDenied(auth)) {
    return auth;
  }

  try {
    const { reservationNumber } = await params;
    const parsed = staffReservationPatchSchema.safeParse(await request.json());

    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Please check the reservation details." },
        { status: 400 },
      );
    }

    const existing = await getReservationByNumber(reservationNumber);
    if (!existing) {
      return NextResponse.json({ error: "Reservation not found." }, { status: 404 });
    }

    const nextDate = parsed.data.date ?? existing.date;
    const nextGuestCount = parsed.data.guestCount ?? existing.guestCount;
    // Shrinking the party drops the choices of guests who are no longer coming.
    const nextSelections = pruneSelectionsToGuestCount(
      parsed.data.selections ?? existing.selections,
      nextGuestCount,
    );

    const [menu, restaurantDate] = await Promise.all([getMenuCatalog(), getRestaurantDate(nextDate)]);

    /**
     * Menu rules still apply, but availability is deliberately not judged
     * here: the service does that when it actually moves the seats, and it
     * knows how many this booking already holds. Faking an open date with
     * room to spare keeps this check to the menu, and lets a genuine capacity
     * problem come back with the message written for staff rather than the
     * one written for guests.
     */
    const validation = validateReservationRequest({
      roomNumber: parsed.data.roomNumber ?? existing.roomNumber,
      additionalRooms: parsed.data.additionalRooms ?? existing.additionalRooms,
      guestCount: nextGuestCount,
      date: nextDate,
      selections: nextSelections,
      restaurantDate: restaurantDate
        ? {
            ...restaurantDate,
            isOpen: true,
            reservedSeats: 0,
            capacity: Math.max(restaurantDate.capacity, nextGuestCount),
            remainingSeats: Math.max(restaurantDate.capacity, nextGuestCount),
          }
        : null,
      menu,
      // Staff are allowed to correct a booking for an evening in progress.
      now: new Date(`${nextDate}T00:00:00`),
    });

    if (!validation.ok) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }

    const updated = await updateReservationDetails(reservationNumber, {
      roomNumber: parsed.data.roomNumber,
      additionalRooms: parsed.data.additionalRooms,
      guestCount: parsed.data.guestCount,
      date: parsed.data.date,
      selections: canonicalizeSelections(validation.selections, menu),
      notes: parsed.data.notes,
      contact: parsed.data.contact ? normalizeContact(parsed.data.contact) : undefined,
      tableNumber: parsed.data.tableNumber,
      // Taken from the account rather than the body: a source a caller could
      // name is a source a caller could lie about.
      tableSource: tableSourceOfUser(auth.user),
      joinReservationNumber: parsed.data.joinReservationNumber,
    });

    if (!updated) {
      return NextResponse.json({ error: "Reservation not found." }, { status: 404 });
    }

    /**
     * What moved, worked out from the record rather than from the patch.
     *
     * The patch says what was *sent*; the pair of records says what actually
     * changed, which is a different thing — sending a table number that is
     * already set is not a change, and this used to log it as one. It is also
     * the only version that can say **Table 12 → 7** rather than "table 7".
     *
     * Nothing is written when nothing moved: a log full of "no visible change"
     * is a log nobody scrolls.
     */
    const changes = describeReservationChanges(existing, updated);

    if (changes.length > 0) {
      await recordAuditEntry({
        action: "reservation:update",
        actor: auth.actor,
        reservationNumber: updated.reservationNumber,
        summary: summariseChanges(changes),
        changes,
        version: updated.version,
      });
    }

    return NextResponse.json({ reservation: updated });
  } catch (error) {
    if (error instanceof BookingError) {
      return NextResponse.json(
        {
          error:
            error.code === "DATE_CLOSED"
              ? "That evening is closed for reservations. Open it first, then move the booking."
              : "That evening does not have enough seats left. Raise its capacity first, then move the booking.",
        },
        { status: 409 },
      );
    }

    // Its message names what is wrong with the number they typed, so it is
    // the thing worth showing rather than a generic failure.
    if (error instanceof TableJoinError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }

    console.error("[admin] failed to update reservation", error);
    return NextResponse.json({ error: "Unable to update this reservation." }, { status: 500 });
  }
}

/**
 * Removes a reservation permanently. Cancelling keeps the record for the
 * night's history; this is for bookings that should never have existed —
 * a duplicate or a test entry — and releases the seats.
 */
export async function DELETE(_request: Request, { params }: { params: Promise<{ reservationNumber: string }> }) {
  // Deleting is the one action reserved for administrators: it destroys the
  // record, so a mistake cannot be undone the way a cancellation can.
  const auth = await requireStaff("reservations:delete");
  if (isDenied(auth)) {
    return auth;
  }

  try {
    const { reservationNumber } = await params;
    const removed = await deleteReservation(reservationNumber);

    if (!removed) {
      return NextResponse.json({ error: "Reservation not found." }, { status: 404 });
    }

    // The booking is gone, so the guest's key must not stay attached to it.
    if (removed.passKeyId) {
      await releasePassKey(removed.passKeyId, removed.reservationNumber).catch((error) => {
        console.error("[admin] failed to release pass-key after deleting", error);
      });
    }

    /**
     * The log entry outlives the record it describes — deliberately. "Why is
     * there no booking for room 402?" is answerable only if the deletion left
     * a trace.
     */
    await recordAuditEntry({
      action: "reservation:delete",
      actor: auth.actor,
      reservationNumber: removed.reservationNumber,
      summary:
        `Permanently deleted the reservation for ${removed.date} ` +
        `(room ${removed.roomNumber || "—"}, ${removed.guestCount} guest(s)).`,
    });

    return NextResponse.json({ reservation: removed });
  } catch (error) {
    console.error("[admin] failed to delete reservation", error);
    return NextResponse.json({ error: "Unable to delete this reservation." }, { status: 500 });
  }
}
