import { NextResponse } from "next/server";
import {
  cancelReservation,
  getReservationByNumber,
  updateReservationSelections,
} from "@/lib/services/reservations";
import { getMenuCatalog, getRestaurantDate } from "@/lib/services/restaurant";
import { validateReservationRequest } from "@/lib/services/booking-rules";
import { isAdminAuthenticated } from "@/lib/auth/session";
import { canGuestModify } from "@/lib/reservation-policy";
import { updateSelectionsSchema } from "@/lib/validation/booking";
import type { ReservationRecord } from "@/types/booking";

const NOT_FOUND = { error: "Reservation not found." };

/**
 * A reservation number alone is not proof of ownership: anyone who saw or
 * guessed one could otherwise read a guest's details and cancel their table.
 * Guests must also present the room number the booking was made for; staff
 * with a valid admin session are exempt.
 */
async function authorize(reservation: ReservationRecord | null, providedRoomNumber: string | null) {
  if (!reservation) {
    return { ok: false as const, isAdmin: false };
  }

  if (await isAdminAuthenticated()) {
    return { ok: true as const, isAdmin: true };
  }

  const matches = providedRoomNumber !== null && Number(providedRoomNumber) === reservation.roomNumber;
  return { ok: matches, isAdmin: false };
}

function roomNumberFrom(request: Request) {
  return new URL(request.url).searchParams.get("roomNumber");
}

export async function GET(request: Request, { params }: { params: Promise<{ reservationNumber: string }> }) {
  try {
    const { reservationNumber } = await params;
    const reservation = await getReservationByNumber(reservationNumber.trim().toUpperCase());
    const access = await authorize(reservation, roomNumberFrom(request));

    if (!access.ok || !reservation) {
      // Deliberately identical to the missing-reservation response, so this
      // cannot be used to discover which reservation numbers exist.
      return NextResponse.json(NOT_FOUND, { status: 404 });
    }

    const check = canGuestModify(reservation);

    return NextResponse.json({
      reservation,
      // Lets the guest's screen explain why the buttons are unavailable.
      canModify: check.allowed,
      modificationDeadline: check.deadline.toISOString(),
      modificationBlockedReason: check.reason ?? null,
    });
  } catch (error) {
    console.error("[reservations] failed to load reservation", error);
    return NextResponse.json({ error: "Unable to load reservation." }, { status: 500 });
  }
}

/** Changes the menu choices on an existing booking. */
export async function PATCH(request: Request, { params }: { params: Promise<{ reservationNumber: string }> }) {
  try {
    const { reservationNumber } = await params;
    const parsed = updateSelectionsSchema.safeParse(await request.json());

    if (!parsed.success) {
      return NextResponse.json({ error: "Please choose a menu option for every course." }, { status: 400 });
    }

    const reservation = await getReservationByNumber(reservationNumber.trim().toUpperCase());
    const access = await authorize(reservation, String(parsed.data.roomNumber));

    if (!access.ok || !reservation) {
      return NextResponse.json(NOT_FOUND, { status: 404 });
    }

    // Staff can fix a booking at any time; guests only up to the cutoff.
    if (!access.isAdmin) {
      const check = canGuestModify(reservation);
      if (!check.allowed) {
        return NextResponse.json({ error: check.reason, code: "CHANGES_CLOSED" }, { status: 409 });
      }
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

    const updated = await updateReservationSelections(reservation.reservationNumber, validation.selections);
    if (!updated) {
      return NextResponse.json(NOT_FOUND, { status: 404 });
    }

    return NextResponse.json({ reservation: updated });
  } catch (error) {
    console.error("[reservations] failed to update reservation", error);
    return NextResponse.json({ error: "Unable to update this reservation." }, { status: 500 });
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ reservationNumber: string }> }) {
  try {
    const { reservationNumber } = await params;
    const reservation = await getReservationByNumber(reservationNumber.trim().toUpperCase());
    const access = await authorize(reservation, roomNumberFrom(request));

    if (!access.ok || !reservation) {
      return NextResponse.json(NOT_FOUND, { status: 404 });
    }

    if (!access.isAdmin) {
      const check = canGuestModify(reservation);
      if (!check.allowed) {
        return NextResponse.json({ error: check.reason, code: "CHANGES_CLOSED" }, { status: 409 });
      }
    }

    const cancelled = await cancelReservation(reservation.reservationNumber);
    if (!cancelled) {
      return NextResponse.json(NOT_FOUND, { status: 404 });
    }

    return NextResponse.json(cancelled);
  } catch (error) {
    console.error("[reservations] failed to cancel reservation", error);
    return NextResponse.json({ error: "Unable to cancel reservation." }, { status: 500 });
  }
}
