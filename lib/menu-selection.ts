import type { MenuCourse, ReservationSelection } from "@/types/booking";

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

/**
 * Rewrites the course and option names on a set of selections to the master
 * (English) menu wording.
 *
 * A guest booking in Bulgarian sends the Bulgarian labels, which would then be
 * what the kitchen reads. Names are therefore resolved from the catalogue by
 * id rather than trusted from the client — which also means a tampered request
 * cannot invent a dish name. Anything whose id is no longer on the menu keeps
 * the name it was booked with, so historical bookings still read sensibly.
 */
export function canonicalizeSelections(
  selections: ReservationSelection[],
  menu: MenuCourse[],
): ReservationSelection[] {
  const courses = new Map(menu.map((course) => [course.id, course]));

  return selections.map((selection) => {
    const course = courses.get(selection.courseId);
    const option = course?.options.find((entry) => entry.id === selection.optionId);

    return {
      ...selection,
      courseName: course?.name || selection.courseName,
      optionName: isNoneSelection(selection) ? NONE_OPTION_NAME : option?.name || selection.optionName,
    };
  });
}

/** Applies {@link canonicalizeSelections} across a set of reservations. */
export function canonicalizeReservations<T extends { selections: ReservationSelection[] }>(
  reservations: T[],
  menu: MenuCourse[],
): T[] {
  return reservations.map((reservation) => ({
    ...reservation,
    selections: canonicalizeSelections(reservation.selections, menu),
  }));
}
