import { NextResponse } from "next/server";
import { cancelReservation, getReservationByPassKey } from "@/lib/services/reservations";
import { getPassKeyByCode, releasePassKey } from "@/lib/services/pass-keys";
import { recordAuditEntry } from "@/lib/services/audit-log";
import { canGuestModify } from "@/lib/reservation-policy";
import { manageReservationSchema } from "@/lib/validation/booking";

const NOT_FOUND = { error: "We could not find a reservation for that pass-key." };

/**
 * A guest cancelling their own dinner.
 *
 * The key is handed back afterwards, so a guest who cancels can book again
 * rather than losing their dinner for the whole stay over one mistaken tap.
 * If reception has to undo the cancellation instead, the restore takes the key
 * back — see `/api/admin/reservations/[reservationNumber]/restore`.
 */
export async function POST(request: Request) {
  try {
    const parsed = manageReservationSchema.safeParse(await request.json());

    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Please enter your pass-key." },
        { status: 400 },
      );
    }

    const passKey = await getPassKeyByCode(parsed.data.passKey);
    if (!passKey || passKey.status === "revoked") {
      return NextResponse.json(NOT_FOUND, { status: 404 });
    }

    const reservation = await getReservationByPassKey(passKey.id);
    if (!reservation) {
      return NextResponse.json(NOT_FOUND, { status: 404 });
    }

    const check = canGuestModify(reservation);
    if (!check.allowed) {
      return NextResponse.json({ error: check.reason, code: "CHANGES_CLOSED" }, { status: 409 });
    }

    const cancelled = await cancelReservation(reservation.reservationNumber, {
      at: new Date().toISOString(),
      actorKind: "guest",
      actorId: passKey.id,
      actorName: `Guest in room ${reservation.roomNumber}`,
    });

    if (!cancelled) {
      return NextResponse.json(NOT_FOUND, { status: 404 });
    }

    // Give the key back so the guest can rebook; the audit log keeps the
    // cancellation either way.
    await releasePassKey(passKey.id, reservation.reservationNumber).catch((error) => {
      console.error("[booking] failed to release pass-key after a guest cancellation", error);
    });

    await recordAuditEntry({
      action: "reservation:cancel",
      actor: { kind: "guest", id: passKey.id, name: `Guest in room ${reservation.roomNumber}` },
      reservationNumber: reservation.reservationNumber,
      summary: `Guest cancelled their reservation for ${reservation.date}.`,
    });

    return NextResponse.json({ reservation: cancelled });
  } catch (error) {
    console.error("[booking] failed to cancel reservation", error);
    return NextResponse.json({ error: "Unable to cancel reservation." }, { status: 500 });
  }
}
