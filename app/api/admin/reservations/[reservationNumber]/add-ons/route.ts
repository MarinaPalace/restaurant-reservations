import { NextResponse } from "next/server";
import { isDenied, requireStaff } from "@/lib/auth/guard";
import { recordAuditEntry } from "@/lib/services/audit-log";
import { describeReservationChanges } from "@/lib/reservation-changes";
import { getReservationByNumber, updateReservationAddOns } from "@/lib/services/reservations";
import { getPromoCatalog } from "@/lib/services/restaurant";
import { resolvePromotionSelection } from "@/lib/services/promotion-selection";
import { staffAddOnsSchema } from "@/lib/validation/booking";
import { reportError } from "@/lib/observability";

/**
 * Promotions on a booking, set by staff.
 *
 * Separate from the guest route, and deliberately wider than it. A guest may
 * only change or give back what they took on the confirmation screen; **staff
 * may do anything** — add a bottle a guest asks for at the table, correct one
 * ordered by mistake, take one off a bill. Reception is the fallback for every
 * rule in this app, and a rule they cannot override is a rule that gets
 * written on paper instead.
 *
 * Separate from the reservation PATCH too, because that route is about seats,
 * dates and dishes, and moving seats is the most delicate code here (rule
 * 2.7). Promotions touch none of it.
 *
 * What is stored is still resolved from the catalogue by id (rule 2.6): staff
 * pick from a list, and the price on the bill is the restaurant's, not
 * whatever the browser posted.
 */
export async function POST(request: Request, { params }: { params: Promise<{ reservationNumber: string }> }) {
  const auth = await requireStaff("reservations:edit");
  if (isDenied(auth)) {
    return auth;
  }

  try {
    const { reservationNumber } = await params;
    const parsed = staffAddOnsSchema.safeParse(await request.json());

    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Please check the selection." },
        { status: 400 },
      );
    }

    const existing = await getReservationByNumber(reservationNumber);
    if (!existing) {
      return NextResponse.json({ error: "Reservation not found." }, { status: 404 });
    }

    /**
     * A cancelled booking is not a bill, so nothing may be added to it.
     *
     * This used to answer 200 and write the line, which then vanished from
     * every report — they all exclude cancelled bookings. Nobody was
     * over-charged, which is why it survived: it failed in the safe direction
     * and silently. Reception put a bottle on a bill, was told it worked, and
     * the money never appeared.
     *
     * Refused rather than warned about, because the useful thing reception can
     * do is restore the booking first — and then the line is real. The message
     * says so, since "no" without "instead, do this" is how a rule ends up
     * worked around on paper.
     */
    if (existing.status !== "confirmed") {
      return NextResponse.json(
        {
          error: "That booking is cancelled. Restore it first, then add the promotion.",
          code: "RESERVATION_NOT_CONFIRMED",
        },
        { status: 409 },
      );
    }

    const selection = resolvePromotionSelection({
      requested: parsed.data.addOns,
      // Lines the booking already holds are carried through as they were
      // agreed: adding a dessert must not reprice the wine beside it, and a
      // product the bar has stopped selling must not freeze the whole booking.
      held: existing.addOns ?? [],
      catalog: await getPromoCatalog("en"),
    });

    if (!selection.ok) {
      return NextResponse.json(
        {
          error:
            selection.status === 409
              ? "That product is no longer in the promotions menu."
              : selection.error,
        },
        { status: selection.status },
      );
    }

    const addOns = selection.addOns;

    const updated = await updateReservationAddOns(reservationNumber, addOns);
    if (!updated) {
      return NextResponse.json({ error: "Reservation not found." }, { status: 404 });
    }

    /**
     * Logged, because it changes what a guest is charged. "Who put the
     * Chardonnay on room 402's bill?" is exactly the question the audit log
     * exists to answer.
     */
    const changes = describeReservationChanges(existing ?? {}, updated);

    await recordAuditEntry({
      action: "reservation:update",
      actor: auth.actor,
      reservationNumber,
      summary: addOns.length
        ? `Set promotions on ${reservationNumber}: ${addOns.map((addOn) => addOn.optionName).join(", ")}.`
        : `Removed all promotions from ${reservationNumber}.`,
      // Beside the sentence: what was there before, which the sentence cannot
      // say and which is the half that answers "who took the wine off?".
      ...(changes.length ? { changes } : {}),
      version: updated.version,
    });

    return NextResponse.json({ reservation: updated });
  } catch (error) {
    reportError({ scope: "admin", event: "promotions:save", error });
    return NextResponse.json({ error: "Unable to save the promotions." }, { status: 500 });
  }
}
