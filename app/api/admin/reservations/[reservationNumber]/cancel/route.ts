import { NextResponse } from "next/server";
import { isDenied, requireStaff } from "@/lib/auth/guard";
import { cancelReservation, getReservationByNumber } from "@/lib/services/reservations";
import { releasePassKey } from "@/lib/services/pass-keys";
import { recordAuditEntry } from "@/lib/services/audit-log";
import { cancelReservationSchema } from "@/lib/validation/booking";

export async function POST(request: Request, { params }: { params: Promise<{ reservationNumber: string }> }) {
  const auth = await requireStaff("reservations:cancel");
  if (isDenied(auth)) {
    return auth;
  }

  try {
    const { reservationNumber } = await params;

    // A reason is optional; a cancel button that demanded one would just get
    // "x" typed into it.
    const parsed = cancelReservationSchema.safeParse(await request.json().catch(() => ({})));
    const reason = parsed.success ? parsed.data.reason : undefined;

    const existing = await getReservationByNumber(reservationNumber);
    if (!existing) {
      return NextResponse.json({ error: "Reservation not found." }, { status: 404 });
    }

    const cancelled = await cancelReservation(reservationNumber, {
      at: new Date().toISOString(),
      actorKind: "staff",
      actorId: auth.user.id,
      actorName: auth.user.name,
      reason,
    });

    if (!cancelled) {
      return NextResponse.json({ error: "Reservation not found." }, { status: 404 });
    }

    /**
     * Hand the guest's key back so they can rebook themselves rather than
     * having to come to the desk again. Only the key this booking was made
     * with is affected.
     */
    if (existing.passKeyId) {
      await releasePassKey(existing.passKeyId, existing.reservationNumber).catch((error) => {
        console.error("[admin] failed to release pass-key after cancelling", error);
      });
    }

    await recordAuditEntry({
      action: "reservation:cancel",
      actor: auth.actor,
      reservationNumber: cancelled.reservationNumber,
      summary:
        `Cancelled the reservation for ${cancelled.date}` +
        (reason ? ` — ${reason}` : "") +
        ".",
    });

    return NextResponse.json(cancelled);
  } catch (error) {
    console.error("[admin] failed to cancel reservation", error);
    return NextResponse.json({ error: "Unable to cancel reservation." }, { status: 500 });
  }
}
