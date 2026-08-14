import { NextResponse } from "next/server";
import { cancelReservation, getReservationByNumber } from "@/lib/services/reservations";
import { isAdminAuthenticated } from "@/lib/auth/session";
import type { ReservationRecord } from "@/types/booking";

const NOT_FOUND = { error: "Reservation not found." };

/**
 * A reservation number alone is not proof of ownership: anyone who saw or
 * guessed one could previously read a guest's details and cancel their table.
 * Guests must also present the room number the booking was made for; staff
 * with a valid admin session are exempt.
 */
async function authorize(reservation: ReservationRecord | null, providedRoomNumber: string | null) {
  if (!reservation) {
    return false;
  }

  if (await isAdminAuthenticated()) {
    return true;
  }

  return providedRoomNumber !== null && Number(providedRoomNumber) === reservation.roomNumber;
}

export async function GET(request: Request, { params }: { params: Promise<{ reservationNumber: string }> }) {
  try {
    const { reservationNumber } = await params;
    const roomNumber = new URL(request.url).searchParams.get("roomNumber");
    const reservation = await getReservationByNumber(reservationNumber);

    if (!(await authorize(reservation, roomNumber))) {
      // Deliberately identical to the missing-reservation response so this
      // cannot be used to confirm which reservation numbers exist.
      return NextResponse.json(NOT_FOUND, { status: 404 });
    }

    return NextResponse.json(reservation);
  } catch (error) {
    console.error("[reservations] failed to load reservation", error);
    return NextResponse.json({ error: "Unable to load reservation." }, { status: 500 });
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ reservationNumber: string }> }) {
  try {
    const { reservationNumber } = await params;
    const roomNumber = new URL(request.url).searchParams.get("roomNumber");
    const reservation = await getReservationByNumber(reservationNumber);

    if (!(await authorize(reservation, roomNumber))) {
      return NextResponse.json(NOT_FOUND, { status: 404 });
    }

    const cancelled = await cancelReservation(reservationNumber);
    if (!cancelled) {
      return NextResponse.json(NOT_FOUND, { status: 404 });
    }

    return NextResponse.json(cancelled);
  } catch (error) {
    console.error("[reservations] failed to cancel reservation", error);
    return NextResponse.json({ error: "Unable to cancel reservation." }, { status: 500 });
  }
}
