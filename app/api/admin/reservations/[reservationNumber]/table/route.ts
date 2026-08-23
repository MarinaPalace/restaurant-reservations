import { NextResponse } from "next/server";
import { isDenied, requireStaff } from "@/lib/auth/guard";
import { tableSourceOfUser } from "@/lib/auth/permissions";
import { recordAuditEntry } from "@/lib/services/audit-log";
import { assignTableNumber, getReservationByNumber } from "@/lib/services/reservations";
import { describeReservationChanges, summariseChanges } from "@/lib/reservation-changes";
import { tableAssignmentSchema } from "@/lib/validation/booking";

/**
 * Assigns a table. Rooms that asked to dine together are moved as one, so a
 * shared table cannot end up split across two numbers.
 *
 * ## Who chose it travels with the number
 *
 * Owner, staff and guest all write the same `tableNumber`, and once written
 * they were indistinguishable — so nobody could tell whether a table could be
 * moved freely or whether a guest had picked it deliberately. The source is
 * taken from the **account making the request**, never from the body: a request
 * that named its own source could claim to be a guest's choice.
 *
 * ## And it is logged
 *
 * This route wrote a table and left no trace, which made "who moved this
 * table?" unanswerable — the one question the log exists to answer. The entry
 * names the old table and the new.
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

    // Read before the write, so the log can say what it was as well as what it
    // became. A missing booking is answered by the write below either way.
    const before = await getReservationByNumber(reservationNumber);

    const updated = await assignTableNumber(
      reservationNumber,
      parsed.data.tableNumber,
      tableSourceOfUser(auth.user),
    );

    if (!updated) {
      return NextResponse.json({ error: "Reservation not found." }, { status: 404 });
    }

    const after = updated.find((entry) => entry.reservationNumber === reservationNumber) ?? updated[0];
    const changes = describeReservationChanges(before ?? {}, after ?? {});

    if (changes.length > 0) {
      await recordAuditEntry({
        action: "reservation:table",
        actor: auth.actor,
        reservationNumber,
        summary: summariseChanges(changes),
        changes,
      });
    }

    return NextResponse.json({ reservations: updated });
  } catch (error) {
    console.error("[admin] failed to assign table", error);
    return NextResponse.json({ error: "Unable to save the table number." }, { status: 500 });
  }
}
