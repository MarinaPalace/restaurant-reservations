import { NextResponse } from "next/server";
import { isDenied, requireStaff } from "@/lib/auth/guard";
import { RestoreError, getReservationByNumber, restoreReservation } from "@/lib/services/reservations";
import { reclaimPassKey } from "@/lib/services/pass-keys";
import { recordAuditEntry } from "@/lib/services/audit-log";

/**
 * Undoes a cancellation.
 *
 * This can genuinely fail. Cancelling gave the seats back to the evening, and
 * somebody may have taken them since, or the evening may have been closed —
 * so a restore is a fresh claim on the seats, not a flip of the status flag.
 * The error says which of the two happened, because the fix differs.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ reservationNumber: string }> }) {
  const auth = await requireStaff("reservations:restore");
  if (isDenied(auth)) {
    return auth;
  }

  try {
    const { reservationNumber } = await params;

    const existing = await getReservationByNumber(reservationNumber);
    if (!existing) {
      return NextResponse.json({ error: "Reservation not found." }, { status: 404 });
    }

    const restored = await restoreReservation(reservationNumber);
    if (!restored) {
      return NextResponse.json({ error: "Reservation not found." }, { status: 404 });
    }

    /**
     * The key was handed back when this was cancelled, so take it again. If
     * the guest has already spent it on another dinner this quietly does
     * nothing — the booking is still restored, but the newer one keeps the
     * key, which is the honest outcome.
     */
    if (existing.passKeyId) {
      await reclaimPassKey(existing.passKeyId, existing.reservationNumber).catch((error) => {
        console.error("[admin] failed to reclaim pass-key after restoring", error);
      });
    }

    await recordAuditEntry({
      action: "reservation:restore",
      actor: auth.actor,
      reservationNumber: restored.reservationNumber,
      summary: `Restored the cancelled reservation for ${restored.date}.`,
    });

    return NextResponse.json({ reservation: restored });
  } catch (error) {
    if (error instanceof RestoreError) {
      const messages = {
        NOT_CANCELLED: "That reservation is not cancelled, so there is nothing to restore.",
        DATE_CLOSED: "That evening is closed. Open it first, then restore the booking.",
        DATE_FULL:
          "That evening no longer has enough seats — they were released when this booking was cancelled. " +
          "Raise its capacity or move the booking to another evening.",
      } as const;

      return NextResponse.json(
        { error: messages[error.code], code: error.code },
        { status: error.code === "NOT_CANCELLED" ? 400 : 409 },
      );
    }

    console.error("[admin] failed to restore reservation", error);
    return NextResponse.json({ error: "Unable to restore this reservation." }, { status: 500 });
  }
}
