import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/auth/guard";
import { cancelReservation } from "@/lib/services/reservations";

export async function POST(_request: Request, { params }: { params: Promise<{ reservationNumber: string }> }) {
  const unauthorized = await requireAdminApi();
  if (unauthorized) {
    return unauthorized;
  }

  try {
    const { reservationNumber } = await params;
    const cancelled = await cancelReservation(reservationNumber);

    if (!cancelled) {
      return NextResponse.json({ error: "Reservation not found." }, { status: 404 });
    }

    return NextResponse.json(cancelled);
  } catch (error) {
    console.error("[admin] failed to cancel reservation", error);
    return NextResponse.json({ error: "Unable to cancel reservation." }, { status: 500 });
  }
}
