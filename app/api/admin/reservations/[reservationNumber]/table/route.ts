import { NextResponse } from "next/server";
import { isDenied, requireStaff } from "@/lib/auth/guard";
import { assignTableNumber } from "@/lib/services/reservations";
import { tableAssignmentSchema } from "@/lib/validation/booking";

/**
 * Assigns a table. Rooms that asked to dine together are moved as one, so a
 * shared table cannot end up split across two numbers.
 */
export async function POST(request: Request, { params }: { params: Promise<{ reservationNumber: string }> }) {
  const auth = await requireStaff("reservations:edit");
  if (isDenied(auth)) {
    return auth;
  }

  try {
    const { reservationNumber } = await params;
    const parsed = tableAssignmentSchema.safeParse(await request.json());

    if (!parsed.success) {
      return NextResponse.json({ error: "Please enter a shorter table name." }, { status: 400 });
    }

    const updated = await assignTableNumber(reservationNumber, parsed.data.tableNumber);
    if (!updated) {
      return NextResponse.json({ error: "Reservation not found." }, { status: 404 });
    }

    return NextResponse.json({ reservations: updated });
  } catch (error) {
    console.error("[admin] failed to assign table", error);
    return NextResponse.json({ error: "Unable to save the table number." }, { status: 500 });
  }
}
