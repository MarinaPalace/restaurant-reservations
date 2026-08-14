import type { ReservationSelection } from "@/types/booking";

/**
 * A guest may decline any course. That is recorded as a real selection with a
 * reserved option id rather than a missing one, so the difference between
 * "does not want a starter" and "has not chosen yet" stays visible all the way
 * through to the kitchen.
 */
export const NONE_OPTION_ID = "__none__";
export const NONE_OPTION_NAME = "None";

export function isNoneSelection(selection: Pick<ReservationSelection, "optionId">) {
  return selection.optionId === NONE_OPTION_ID;
}

/** The courses this guest actually eats — what the kitchen has to prepare. */
export function countsTowardsKitchen(selection: Pick<ReservationSelection, "optionId">) {
  return !isNoneSelection(selection);
}
