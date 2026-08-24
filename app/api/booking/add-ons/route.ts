import { NextResponse } from "next/server";
import { getPassKeyByCode } from "@/lib/services/pass-keys";
import { getReservationByNumber, updateReservationAddOns } from "@/lib/services/reservations";
import { getPromoCatalog, getRestaurantDate } from "@/lib/services/restaurant";
import { resolvePromotionSelection } from "@/lib/services/promotion-selection";
import { getEveningFeatures } from "@/lib/services/settings";
import { updateAddOnsSchema } from "@/lib/validation/booking";
import { checkRateLimit, clientKeyFrom } from "@/lib/rate-limit";
import { toGuestReservation } from "@/lib/guest-reservation";
import { recordAuditEntry } from "@/lib/services/audit-log";
import { describeReservationChanges, summariseChanges } from "@/lib/reservation-changes";
import { reportError } from "@/lib/observability";

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
     * An evening may have promotions switched off — see
     * `lib/evening-features.ts`. Checked here and not only by hiding the
     * screen (rule 2.5), because the confirmation page may have been open
     * since before the switch was thrown.
     *
     * Giving one back is always allowed. The offer being closed is a reason
     * not to sell somebody a bottle of wine, never a reason to trap them with
     * one they have already decided against — and an empty list is the shape
     * both "I decline" and "remove it" arrive in.
     */
    if (parsed.data.addOns.length > 0) {
      const evening = await getEveningFeatures(await getRestaurantDate(reservation.date));

      if (!evening.promotions) {
        return NextResponse.json(
          {
            error: "Promotions are not being offered for that evening.",
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
    const selection = resolvePromotionSelection({
      requested: parsed.data.addOns,
      // What the guest already has is carried through untouched, so swapping
      // one product cannot reprice or invalidate the one beside it.
      held: reservation.addOns ?? [],
      catalog: await getPromoCatalog("en"),
    });

    if (!selection.ok) {
      return NextResponse.json({ error: selection.error }, { status: selection.status });
    }

    const addOns = selection.addOns;

    const updated = await updateReservationAddOns(reservation.reservationNumber, addOns);

    if (!updated) {
      return NextResponse.json({ error: "We could not find that reservation." }, { status: 404 });
    }

    /**
     * Logged, because a guest changing their own booking is still somebody
     * changing a booking. This route wrote to a reservation and left no trace,
     * so a bottle of wine appearing on a bill had no history behind it — and
     * the actor is the pass-key, which is the only name a guest has here.
     *
     * After the write and never awaited into it: a failed log write must not
     * fail the thing being logged.
     */
    const changes = describeReservationChanges(reservation, updated);

    if (changes.length > 0) {
      await recordAuditEntry({
        action: "reservation:update",
        actor: {
          kind: "guest",
          id: passKey.id,
          name: `Guest in room ${reservation.roomNumber}`,
        },
        reservationNumber: reservation.reservationNumber,
        summary: summariseChanges(changes),
        changes,
        version: updated.version,
      });
    }

    return NextResponse.json({ reservation: toGuestReservation(updated) });
  } catch (error) {
    reportError({ scope: "booking", event: "promotions:save", error });
    return NextResponse.json({ error: "Unable to save your choices." }, { status: 500 });
  }
}
