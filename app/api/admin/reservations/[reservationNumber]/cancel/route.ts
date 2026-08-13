import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { cancelReservation } from "@/lib/services/reservations";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ reservationNumber: string }> },
) {
  const cookieStore = await cookies();
  const isAuthenticated = cookieStore.get("admin-auth")?.value === "true";
  if (!isAuthenticated) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { reservationNumber } = await params;
    const cancelled = await cancelReservation(reservationNumber);
    if (!cancelled) {
      return NextResponse.json({ error: "Reservation not found." }, { status: 404 });
    }
    return NextResponse.json(cancelled);
  } catch {
    return NextResponse.json({ error: "Unable to cancel reservation." }, { status: 500 });
  }
}
