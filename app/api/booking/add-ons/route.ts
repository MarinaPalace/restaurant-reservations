import { NextResponse } from "next/server";
import { getPassKeyByCode } from "@/lib/services/pass-keys";
import { getReservationByNumber, updateReservationAddOns } from "@/lib/services/reservations";
import { getPromoCatalog, priceOfPromoOption } from "@/lib/services/restaurant";
import { updateAddOnsSchema } from "@/lib/validation/booking";
import { checkRateLimit, clientKeyFrom } from "@/lib/rate-limit";
import type { ReservationAddOn } from "@/types/booking";

/**
 * Takes, changes or drops the promotions on a confirmed booking.
 *
 * Three things this route insists on, each for a reason the rest of the app
 * already knows:
 *
 * - **The pass-key authorises it, not the reservation number** (rule 2.5).
 *   Guests read their number out to other rooms to share a table; a route that
 *   accepted it as proof would let those rooms order wine on their bill. A
 *   wrong or missing key answers `404`, identical to "no such booking", so it
 *   cannot be used to find out which keys exist.
 * - **Names and prices come from the catalogue, resolved by id** (rule 2.6).
 *   The browser sends two ids and nothing else; a request cannot invent a
 *   product, a name or a discount.
 * - **The whole set is replaced, never merged.** The screen sends what the
 *   guest has chosen in full, so unticking the last product sends `[]` and
 *   means it. A merge would make "none" unreachable.
 */
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
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid selection." },
        { status: 400 },
      );
    }

    const passKey = await getPassKeyByCode(parsed.data.passKey);
    if (!passKey || passKey.status === "revoked") {
      return NextResponse.json({ error: "We could not find that reservation." }, { status: 404 });
    }

    const reservation = await getReservationByNumber(parsed.data.reservationNumber);

    /**
     * Either link counts. A booking records the key it was made with, and the
     * key records the bookings it paid for — but a key issued before one of
     * those two fields existed has only the other, and both are the same claim.
     */
    const belongsToPassKey = Boolean(
      reservation &&
        (reservation.passKeyId === passKey.id ||
          passKey.reservationNumbers.includes(reservation.reservationNumber)),
    );

    if (!reservation || !belongsToPassKey || reservation.status !== "confirmed") {
      return NextResponse.json({ error: "We could not find that reservation." }, { status: 404 });
    }

    /**
     * Changes made from the manage screen may only touch groups the booking
     * already holds.
     *
     * Promotions are offered once, on the confirmation screen. A guest who
     * took a bottle of wine may swap it or give it back; a guest who declined
     * cannot come back later and take one, because the offer was the moment,
     * not the booking. Enforced here rather than only in the UI, so the two
     * screens cannot drift apart about what each allows.
     */
    if (parsed.data.mode === "manage") {
      const held = new Set((reservation.addOns ?? []).map((addOn) => addOn.courseId));
      const introduced = parsed.data.addOns.find((requested) => !held.has(requested.courseId));

      if (introduced) {
        return NextResponse.json(
          {
            error: "That can only be added on the confirmation screen, when the booking is made.",
            code: "PROMO_CLOSED",
          },
          { status: 409 },
        );
      }
    }

    /**
     * English, deliberately. The guest's screen shows the product in their
     * language, but what is stored is what staff read off the service sheet —
     * the same rule the dinner selections follow (rule 2.6).
     */
    const catalog = await getPromoCatalog("en");
    const chosenGroups = new Set<string>();
    const addOns: ReservationAddOn[] = [];

    for (const requested of parsed.data.addOns) {
      if (chosenGroups.has(requested.courseId)) {
        return NextResponse.json({ error: "Choose at most one product from each group." }, { status: 400 });
      }

      const course = catalog.find((entry) => entry.id === requested.courseId);
      const option = course?.options.find((entry) => entry.id === requested.optionId);

      /**
       * 409, not 400: the request was well formed and was true when the screen
       * rendered it. The product has since been withdrawn, and the screen has
       * to reload to find out what is on offer now.
       */
      if (!course || !option) {
        return NextResponse.json({ error: "That product is no longer available." }, { status: 409 });
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

    const updated = await updateReservationAddOns(reservation.reservationNumber, addOns);

    return updated
      ? NextResponse.json({ reservation: updated })
      : NextResponse.json({ error: "We could not find that reservation." }, { status: 404 });
  } catch (error) {
    console.error("[booking] failed to save promotions", error);
    return NextResponse.json({ error: "Unable to save your choices." }, { status: 500 });
  }
}
