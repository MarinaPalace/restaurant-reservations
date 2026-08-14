import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/auth/guard";
import {
  BookingError,
  deleteReservation,
  getReservationByNumber,
  updateReservationDetails,
} from "@/lib/services/reservations";
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
  const unauthorized = await requireAdminApi();
  if (unauthorized) {
    return unauthorized;
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
      guestCount: parsed.data.guestCount,
      date: parsed.data.date,
      selections: canonicalizeSelections(validation.selections, menu),
      notes: parsed.data.notes,
      contact: parsed.data.contact ? normalizeContact(parsed.data.contact) : undefined,
      tableNumber: parsed.data.tableNumber,
    });

    if (!updated) {
      return NextResponse.json({ error: "Reservation not found." }, { status: 404 });
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
  const unauthorized = await requireAdminApi();
  if (unauthorized) {
    return unauthorized;
  }

  try {
    const { reservationNumber } = await params;
    const removed = await deleteReservation(reservationNumber);

    if (!removed) {
      return NextResponse.json({ error: "Reservation not found." }, { status: 404 });
    }

    return NextResponse.json({ reservation: removed });
  } catch (error) {
    console.error("[admin] failed to delete reservation", error);
    return NextResponse.json({ error: "Unable to delete this reservation." }, { status: 500 });
  }
}
