import { NextResponse } from "next/server";
import { isDenied, requireStaff } from "@/lib/auth/guard";
import { recordAuditEntry } from "@/lib/services/audit-log";
import {
  getReservationByNumber,
  setReservationAttendance,
  setReservationCourseServedForGuests,
  setReservationGuestServed,
} from "@/lib/services/reservations";
import { NONE_OPTION_ID } from "@/lib/menu-selection";
import { serviceMarkSchema } from "@/lib/validation/booking";

/**
 * One mark from the service board.
 *
 * ## Two kinds of write, deliberately different
 *
 * **Attendance is a permanent record** — it decides what analytics concludes
 * and it is disputable ("we were there"), so it names who marked it and it
 * lands in the audit log.
 *
 * **A course going out is operational.** It is worthless the next morning, and
 * forty tables times five courses would bury the log it shares with
 * cancellations and refunds. Not audited, deliberately.
 *
 * ## Why the writes are shaped the way they are
 *
 * Both are **idempotent and last-write-wins per key**, never
 * read-modify-write. Two waiters marking different courses on the same table
 * at the same moment must both succeed — the service layer touches one dotted
 * key on Mongo, and does the same work inside the store lock locally. Same
 * shape as the seat claims (rule 2.7).
 *
 * `PATCH` rather than `POST`: this changes part of a booking that already
 * exists, and the board sends one field at a time.
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ reservationNumber: string }> }) {
  const auth = await requireStaff("service:record");
  if (isDenied(auth)) {
    return auth;
  }

  try {
    const { reservationNumber } = await params;
    const parsed = serviceMarkSchema.safeParse(await request.json());

    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Please check the mark." },
        { status: 400 },
      );
    }

    const existing = await getReservationByNumber(reservationNumber);
    if (!existing) {
      return NextResponse.json({ error: "Reservation not found." }, { status: 404 });
    }

    /**
     * A cancelled booking has no table and nobody to seat. Marking one arrived
     * would put a cover into analytics for a guest who was never coming.
     */
    if (existing.status !== "confirmed") {
      return NextResponse.json({ error: "That booking is cancelled." }, { status: 409 });
    }

    /* ---- attendance: permanent, audited ---- */
    if (parsed.data.attendance !== undefined) {
      const attendance = parsed.data.attendance
        ? {
            status: parsed.data.attendance,
            at: new Date().toISOString(),
            byName: auth.actor.name,
            guests: parsed.data.guests,
          }
        : null;

      const updated = await setReservationAttendance(reservationNumber, attendance);
      if (!updated) {
        return NextResponse.json({ error: "Reservation not found." }, { status: 404 });
      }

      await recordAuditEntry({
        action: "reservation:attendance",
        actor: auth.actor,
        reservationNumber,
        summary: attendance
          ? attendance.status === "seated"
            ? `Seated ${reservationNumber}${attendance.guests !== undefined ? ` (${attendance.guests} of ${existing.guestCount})` : ""}.`
            : `Marked ${reservationNumber} as a no-show.`
          : `Cleared the attendance mark on ${reservationNumber}.`,
      });

      return NextResponse.json({ reservation: updated });
    }

    /* ---- plates going out: operational, not audited ---- */
    const courseId = parsed.data.courseId!;
    const at = parsed.data.served ? new Date().toISOString() : null;

    /**
     * One guest's plate. The tap that answers "guest 2's main is out" — which
     * is the tap an allergy note makes necessary, since guest 2 is the one
     * whose dish came from a different pan.
     */
    if (parsed.data.guestIndex !== undefined) {
      const updated = await setReservationGuestServed(reservationNumber, courseId, parsed.data.guestIndex, at);
      return updated
        ? NextResponse.json({ reservation: updated })
        : NextResponse.json({ error: "Reservation not found." }, { status: 404 });
    }

    /**
     * The whole course, in one update.
     *
     * Which guests it covers is worked out **here**, from the booking's own
     * selections, rather than taken from the request: a guest who declined this
     * course has no plate, and marking one for them would put a plate into the
     * outstanding count that nobody is carrying. Rule 2.6's habit — resolve it
     * from what is stored, not from what was posted.
     */
    const guestIndexes = [
      ...new Set(
        existing.selections
          .filter((selection) => selection.courseId === courseId && selection.optionId !== NONE_OPTION_ID)
          .map((selection) => selection.guestIndex ?? 0),
      ),
    ];

    const updated = await setReservationCourseServedForGuests(reservationNumber, courseId, guestIndexes, at);

    if (!updated) {
      return NextResponse.json({ error: "Reservation not found." }, { status: 404 });
    }

    return NextResponse.json({ reservation: updated });
  } catch (error) {
    console.error("[admin] failed to record a service mark", error);
    return NextResponse.json({ error: "Unable to record that." }, { status: 500 });
  }
}
