import { NextResponse } from "next/server";
import { cancelReservation, getReservationByNumber } from "@/lib/services/reservations";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ reservationNumber: string }> },
) {
  try {
    const { reservationNumber } = await params;
    const reservation = await getReservationByNumber(reservationNumber);
    if (!reservation) {
      return NextResponse.json({ error: "Reservation not found." }, { status: 404 });
    }
    return NextResponse.json(reservation);
  } catch {
    return NextResponse.json({ error: "Unable to load reservation." }, { status: 500 });
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ reservationNumber: string }> },
) {
  try {
    const { reservationNumber } = await params;
    const reservation = await cancelReservation(reservationNumber);
    if (!reservation) {
      return NextResponse.json({ error: "Reservation not found." }, { status: 404 });
    }
    return NextResponse.json(reservation);
  } catch {
    return NextResponse.json({ error: "Unable to cancel reservation." }, { status: 500 });
  }
}
