import { NextResponse } from "next/server";
import { isDenied, requireStaff } from "@/lib/auth/guard";
import { recordAuditEntry } from "@/lib/services/audit-log";
import { getReservationByNumber, updateReservationAddOns } from "@/lib/services/reservations";
import { getPromoCatalog, priceOfPromoOption } from "@/lib/services/restaurant";
import { staffAddOnsSchema } from "@/lib/validation/booking";
import type { ReservationAddOn } from "@/types/booking";

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

    const catalog = await getPromoCatalog("en");
    const chosenGroups = new Set<string>();
    const addOns: ReservationAddOn[] = [];

    for (const requested of parsed.data.addOns) {
      if (chosenGroups.has(requested.courseId)) {
        return NextResponse.json({ error: "Choose at most one product from each group." }, { status: 400 });
      }

      const course = catalog.find((entry) => entry.id === requested.courseId);
      const option = course?.options.find((entry) => entry.id === requested.optionId);

      if (!course || !option) {
        return NextResponse.json({ error: "That product is no longer in the promotions menu." }, { status: 409 });
      }

      chosenGroups.add(requested.courseId);
      addOns.push({
        courseId: course.id,
        courseName: course.name,
        optionId: option.id,
        optionName: option.name,
        ...priceOfPromoOption(option),
      });
    }

    const updated = await updateReservationAddOns(reservationNumber, addOns);
    if (!updated) {
      return NextResponse.json({ error: "Reservation not found." }, { status: 404 });
    }

    /**
     * Logged, because it changes what a guest is charged. "Who put the
     * Chardonnay on room 402's bill?" is exactly the question the audit log
     * exists to answer.
     */
    await recordAuditEntry({
      action: "reservation:update",
      actor: auth.actor,
      reservationNumber,
      summary: addOns.length
        ? `Set promotions on ${reservationNumber}: ${addOns.map((addOn) => addOn.optionName).join(", ")}.`
        : `Removed all promotions from ${reservationNumber}.`,
    });

    return NextResponse.json({ reservation: updated });
  } catch (error) {
    console.error("[admin] failed to save promotions", error);
    return NextResponse.json({ error: "Unable to save the promotions." }, { status: 500 });
  }
}
