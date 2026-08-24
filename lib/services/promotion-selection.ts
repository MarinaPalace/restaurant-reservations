import { priceOfPromoOption } from "@/lib/services/restaurant";
import type { MenuCourse, ReservationAddOn } from "@/types/booking";

/**
 * Turning "the guest wants these two products" into lines on a booking.
 *
 * Both routes that write promotions — the guest's and reception's — used to
 * carry their own copy of this loop, and both had the same bug in it: **every
 * line was re-resolved against the live catalogue, including the ones already
 * agreed.** Two things followed from that, and the second is the expensive one.
 *
 * A product withdrawn since the guest took it made the whole request fail, so a
 * booking holding a discontinued wine could never have anything else added to
 * it — asking for a dessert meant re-sending the wine, and the wine was gone.
 *
 * Worse: a product whose *price* had changed was silently repriced on the
 * booking. Reception adding a dessert to a booking, touching nothing about the
 * wine, moved that wine from the 30 the guest agreed to to whatever the bar
 * charges today. Nothing on screen said so.
 *
 * So the rule is the one the rest of the app already follows: **an agreed line
 * is a record, not a query.** A line the booking already holds is carried
 * through exactly as it was stored, and only genuinely new choices are resolved
 * against the catalogue and priced from it.
 *
 * Repricing is still possible and still deliberate: take the product off and
 * put it back, which is two decisions rather than an accident.
 */

export type PromotionSelectionRequest = { courseId: string; optionId: string };

export type PromotionSelectionResult =
  | { ok: true; addOns: ReservationAddOn[] }
  | { ok: false; status: 400 | 409; error: string };

/** The same line, unchanged — matched on the product, not just the group. */
function alreadyAgreed(held: readonly ReservationAddOn[], requested: PromotionSelectionRequest) {
  return held.find(
    (line) => line.courseId === requested.courseId && line.optionId === requested.optionId,
  );
}

export function resolvePromotionSelection(input: {
  requested: readonly PromotionSelectionRequest[];
  /** What the booking holds now. Empty when it holds nothing. */
  held: readonly ReservationAddOn[];
  /** The promotions on offer, in English — what is stored is what staff read. */
  catalog: readonly MenuCourse[];
}): PromotionSelectionResult {
  const chosenGroups = new Set<string>();
  const addOns: ReservationAddOn[] = [];

  for (const requested of input.requested) {
    if (chosenGroups.has(requested.courseId)) {
      return { ok: false, status: 400, error: "Choose at most one product from each group." };
    }

    chosenGroups.add(requested.courseId);

    /**
     * Kept first, and kept whole. A line already on the booking is not looked
     * up at all — not for its price, not for its name, and not to find out
     * whether the bar still sells it.
     */
    const existing = alreadyAgreed(input.held, requested);

    if (existing) {
      addOns.push(existing);
      continue;
    }

    const course = input.catalog.find((entry) => entry.id === requested.courseId);
    const option = course?.options.find((entry) => entry.id === requested.optionId);

    /**
     * 409, not 400: the request was well formed and was true when the screen
     * rendered it. The product has since been withdrawn, and the screen has to
     * reload to find out what is on offer now.
     */
    if (!course || !option) {
      return { ok: false, status: 409, error: "That product is no longer available." };
    }

    addOns.push({
      courseId: course.id,
      courseName: course.name,
      optionId: option.id,
      optionName: option.name,
      ...priceOfPromoOption(option),
    });
  }

  return { ok: true, addOns };
}
