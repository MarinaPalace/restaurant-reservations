import { NextResponse } from "next/server";
import { cancelReservation, getReservationsByPassKey } from "@/lib/services/reservations";
import { getPassKeyByCode, releasePassKey } from "@/lib/services/pass-keys";
import { recordAuditEntry } from "@/lib/services/audit-log";
import { canGuestModify } from "@/lib/reservation-policy";
import { getRestaurantDate } from "@/lib/services/restaurant";
import { getEveningFeatures } from "@/lib/services/settings";
import { manageReservationSchema } from "@/lib/validation/booking";
import { toGuestReservation } from "@/lib/guest-reservation";
import { checkRateLimit, clientKeyFrom } from "@/lib/rate-limit";
import { reportError } from "@/lib/observability";

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
  /**
   * Rate limited like every other route the pass-key opens, and this one has
   * the strongest claim to it: the key is the only credential, so an
   * unthrottled endpoint is a place to try codes — and a correct guess here
   * does not read a booking, it **cancels somebody's dinner**.
   *
   * Its siblings — the lookup, the table change, the key check — were all
   * limited. This one was missed, which is the ordinary way a gap appears:
   * nothing about it looks different from the outside.
   */
  const limit = checkRateLimit(clientKeyFrom(request, "manage-cancel"), {
    limit: 12,
    windowMs: 60_000,
  });

  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many attempts. Please wait a moment and try again." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }

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

    const reservations = await getReservationsByPassKey(passKey.id);

    /**
     * A key can hold several dinners, so the guest names the one they mean.
     * Omitting the number is only allowed when there is exactly one, which
     * keeps the ordinary case a single tap.
     */
    const reservation = parsed.data.reservationNumber
      ? reservations.find(
          (entry) => entry.reservationNumber === parsed.data.reservationNumber!.trim().toUpperCase(),
        )
      : reservations.length === 1
        ? reservations[0]
        : undefined;

    if (!reservation) {
      return NextResponse.json(
        reservations.length ? { error: "Please say which reservation you mean." } : NOT_FOUND,
        { status: reservations.length ? 400 : 404 },
      );
    }

    // The evening may send its guests to reception instead — checked here and
    // not only by hiding the button (rule 2.5).
    const evening = await getEveningFeatures(await getRestaurantDate(reservation.date));

    const check = canGuestModify(reservation, new Date(), evening.selfService);
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
      reportError({
        scope: "booking",
        // The cancellation itself succeeded; the guest keeps a key they cannot
        // rebook with until somebody notices. Worth its own name in the log.
        event: "passkey:release-after-cancel",
        error,
      });
    });

    await recordAuditEntry({
      action: "reservation:cancel",
      actor: { kind: "guest", id: passKey.id, name: `Guest in room ${reservation.roomNumber}` },
      reservationNumber: reservation.reservationNumber,
      summary: `Guest cancelled their reservation for ${reservation.date}.`,
      version: cancelled.version,
    });

    return NextResponse.json({ reservation: toGuestReservation(cancelled) });
  } catch (error) {
    reportError({ scope: "booking", event: "reservation:cancel", error });
    return NextResponse.json({ error: "Unable to cancel reservation." }, { status: 500 });
  }
}
