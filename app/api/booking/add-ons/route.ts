import { NextResponse } from "next/server";
import { getPassKeyByCode } from "@/lib/services/pass-keys";
import { getReservationByNumber, updateReservationAddOns } from "@/lib/services/reservations";
import { getMenuCatalog } from "@/lib/services/restaurant";
import { updateAddOnsSchema } from "@/lib/validation/booking";
import { checkRateLimit, clientKeyFrom } from "@/lib/rate-limit";
import type { ReservationAddOn } from "@/types/booking";

export async function POST(request: Request) {
  const limit = checkRateLimit(clientKeyFrom(request, "add-ons"), { limit: 12, windowMs: 60_000 });

  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many attempts. Please wait a moment and try again." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }

  try {
    const parsed = updateAddOnsSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid add-on selection." }, { status: 400 });
    }

    const passKey = await getPassKeyByCode(parsed.data.passKey);
    if (!passKey || passKey.status === "revoked") {
      return NextResponse.json({ error: "We could not find that reservation." }, { status: 404 });
    }

    const reservation = await getReservationByNumber(parsed.data.reservationNumber ?? "");
    if (!reservation || reservation.passKeyId !== passKey.id || reservation.status !== "confirmed") {
      return NextResponse.json({ error: "We could not find that reservation." }, { status: 404 });
    }

    const menu = await getMenuCatalog();
    const addOnCourses = menu.filter((course) => course.addOn);
    const seenCourses = new Set<string>();
    const addOns: ReservationAddOn[] = [];

    for (const requested of parsed.data.addOns) {
      if (seenCourses.has(requested.courseId)) {
        return NextResponse.json({ error: "Choose at most one product from each group." }, { status: 400 });
      }

      const course = addOnCourses.find((entry) => entry.id === requested.courseId);
      const option = course?.options.find((entry) => entry.id === requested.optionId);
      if (!course || !option) {
        return NextResponse.json({ error: "That product is no longer available." }, { status: 409 });
      }

      const price = Math.max(0, Number(option.price ?? 0));
      const discountPercent = Math.min(100, Math.max(0, Number(option.discountPercent ?? 0)));
      const finalPrice = Math.round(price * (1 - discountPercent / 100) * 100) / 100;
      seenCourses.add(requested.courseId);
      addOns.push({
        courseId: course.id,
        courseName: course.name,
        optionId: option.id,
        optionName: option.name,
        price,
        discountPercent,
        finalPrice,
      });
    }

    const updated = await updateReservationAddOns(reservation.reservationNumber, addOns);
    return updated
      ? NextResponse.json({ reservation: updated })
      : NextResponse.json({ error: "We could not find that reservation." }, { status: 404 });
  } catch (error) {
    console.error("[booking] failed to update add-ons", error);
    return NextResponse.json({ error: "Unable to save your product choices." }, { status: 500 });
  }
}
