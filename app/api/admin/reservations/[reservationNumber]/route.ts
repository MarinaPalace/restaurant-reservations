import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/auth/guard";
import { deleteReservation } from "@/lib/services/reservations";

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
