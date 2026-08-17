import { isNoneSelection, NONE_OPTION_ID, NONE_OPTION_NAME } from "@/lib/menu-selection";
import type { MenuCourse, ReservationSelection } from "@/types/booking";

/**
 * The paper ticket, in code.
 *
 * Guests who cannot work the app are handed a card at reception: room number
 * (or two or three, if rooms want to sit together), how many are coming, and
 * how many of each dish the table wants — one number per dish, on one line.
 * Nowhere on that card does it say *which* guest is having the sea bass.
 *
 * The store, however, is per guest: `selections` carries a `guestIndex`,
 * because a guest booking online chooses for themselves and the plating list
 * needs to know whose plate is whose. Retyping a ticket into that shape by
 * hand — six guests times four courses, one tap each — is the thing that was
 * wasting reception's evening.
 *
 * So this module is a translation, not a new storage format: quantities are
 * *packed* into guest indexes, and counted back out again for display. Nothing
 * downstream — the kitchen sheet, the seat accounting, the audit log — needs to
 * know a ticket was involved.
 *
 * The packing is deliberately in course order, so two guests having the soup
 * become guests 1 and 2. Which guest gets which is arbitrary, and it has to be:
 * the ticket does not say. Staff who need a specific guest to have a specific
 * dish — an allergy — switch to per-guest entry, which is still there.
 */

/** Option id → how many guests at this table are having it. */
export type CourseQuantities = Record<string, number>;

/** Everything a course row needs to render, plus the "no thank you" count. */
export type CourseTally = {
  courseId: string;
  courseName: string;
  required: boolean;
  quantities: CourseQuantities;
  /** Choices made for this course, declines included. */
  chosen: number;
};

export function countCourseQuantities(selections: ReservationSelection[], courseId: string): CourseQuantities {
  const quantities: CourseQuantities = {};

  for (const selection of selections) {
    if (selection.courseId !== courseId) {
      continue;
    }
    quantities[selection.optionId] = (quantities[selection.optionId] ?? 0) + 1;
  }

  return quantities;
}

export function countChosen(quantities: CourseQuantities) {
  return Object.values(quantities).reduce((total, quantity) => total + Math.max(quantity, 0), 0);
}

export function tallyCourses(
  selections: ReservationSelection[],
  menu: MenuCourse[],
): CourseTally[] {
  return menu.map((course) => {
    const quantities = countCourseQuantities(selections, course.id);

    return {
      courseId: course.id,
      courseName: course.name,
      required: course.required,
      quantities,
      chosen: countChosen(quantities),
    };
  });
}

function optionNameFor(course: MenuCourse, optionId: string) {
  if (optionId === NONE_OPTION_ID) {
    return NONE_OPTION_NAME;
  }
  return course.options.find((option) => option.id === optionId)?.name ?? optionId;
}

/**
 * Turns "two of the soup, one of the salad" into per-guest selections.
 *
 * Guest indexes are handed out from zero in the order the options appear on the
 * menu, and the total is capped at the party size — a ticket that says four
 * mains for three guests is a miscount, and quietly writing a choice for a
 * fourth guest who does not exist would be rejected by the server anyway.
 */
export function expandCourseQuantities(
  course: MenuCourse,
  quantities: CourseQuantities,
  guestCount: number,
): ReservationSelection[] {
  const order = [...course.options.map((option) => option.id), NONE_OPTION_ID];
  // An option withdrawn from the menu since the booking was taken still has to
  // keep its place, or editing an old reservation would silently drop it.
  for (const optionId of Object.keys(quantities)) {
    if (!order.includes(optionId)) {
      order.push(optionId);
    }
  }

  const selections: ReservationSelection[] = [];
  let guestIndex = 0;

  for (const optionId of order) {
    const quantity = Math.max(Math.trunc(quantities[optionId] ?? 0), 0);

    for (let index = 0; index < quantity && guestIndex < guestCount; index += 1) {
      selections.push({
        guestIndex,
        courseId: course.id,
        courseName: course.name,
        optionId,
        optionName: optionNameFor(course, optionId),
      });
      guestIndex += 1;
    }
  }

  return selections;
}

/** Replaces one course's choices, leaving every other course untouched. */
export function replaceCourseQuantities(
  selections: ReservationSelection[],
  course: MenuCourse,
  quantities: CourseQuantities,
  guestCount: number,
): ReservationSelection[] {
  return [
    ...selections.filter((selection) => selection.courseId !== course.id),
    ...expandCourseQuantities(course, quantities, guestCount),
  ];
}

/**
 * Adds or removes one plate of a dish.
 *
 * Never overshoots the party: the table cannot want five starters for four
 * people, and a stepper that lets the number climb past the guest count only
 * produces a booking the server refuses.
 */
export function adjustCourseQuantity(
  selections: ReservationSelection[],
  course: MenuCourse,
  optionId: string,
  delta: number,
  guestCount: number,
): ReservationSelection[] {
  const quantities = countCourseQuantities(selections, course.id);
  const current = quantities[optionId] ?? 0;
  const chosen = countChosen(quantities);
  const headroom = Math.max(guestCount - chosen, 0);

  const next = Math.min(Math.max(current + delta, 0), current + headroom);

  if (next === current) {
    return selections;
  }

  return replaceCourseQuantities(selections, course, { ...quantities, [optionId]: next }, guestCount);
}

/** Gives every remaining guest the same dish — the common ticket, in one tap. */
export function fillCourseWithOption(
  selections: ReservationSelection[],
  course: MenuCourse,
  optionId: string,
  guestCount: number,
): ReservationSelection[] {
  const quantities = countCourseQuantities(selections, course.id);
  const headroom = Math.max(guestCount - countChosen(quantities), 0);

  if (headroom === 0) {
    return selections;
  }

  return replaceCourseQuantities(
    selections,
    course,
    { ...quantities, [optionId]: (quantities[optionId] ?? 0) + headroom },
    guestCount,
  );
}

/** Clears a course, so a miscounted row can be started again. */
export function clearCourse(selections: ReservationSelection[], courseId: string) {
  return selections.filter((selection) => selection.courseId !== courseId);
}

/* ------------------------------------------------------------------ *
 * What is still missing
 * ------------------------------------------------------------------ */

export type MissingCourse = {
  courseId: string;
  courseName: string;
  /** How many guests still have no answer for this course. */
  missing: number;
};

/**
 * Required courses that do not yet cover every guest.
 *
 * The server already refuses an incomplete booking — this is the same rule,
 * said early and by name, because "Please choose an option for Starter" after
 * pressing Create does not tell reception *how many* are missing or which
 * guests they belong to.
 */
export function findMissingCourses(
  selections: ReservationSelection[],
  menu: MenuCourse[],
  guestCount: number,
): MissingCourse[] {
  return menu
    .filter((course) => course.required && course.active)
    .map((course) => {
      // Counted per guest rather than as a total: two choices for guest 1 and
      // none for guest 2 sums to the right number and is still wrong.
      const answered = new Set(
        selections
          .filter((selection) => selection.courseId === course.id)
          .map((selection) => selection.guestIndex ?? 0),
      );

      const missing = Array.from({ length: guestCount }, (_, guestIndex) => guestIndex).filter(
        (guestIndex) => !answered.has(guestIndex),
      ).length;

      return { courseId: course.id, courseName: course.name, missing };
    })
    .filter((entry) => entry.missing > 0);
}

/* ------------------------------------------------------------------ *
 * The overview
 * ------------------------------------------------------------------ */

export type DishTally = { optionId: string; optionName: string; quantity: number };

export type CourseSummary = {
  courseId: string;
  courseName: string;
  dishes: DishTally[];
  /** Guests who said no thank you to this course. */
  declined: number;
};

export type ReservationSummary = {
  courses: CourseSummary[];
  /** Plates the kitchen has to make for this table. Declines excluded. */
  plates: number;
  declined: number;
};

/**
 * How many of each dish this one booking needs.
 *
 * This is the number written on the ticket, and until now the only way to check
 * it was to read every guest's list and add the dishes up in your head. Course
 * order follows the menu; a dish since withdrawn keeps the name it was booked
 * with, and courses no longer on the menu are listed after the ones that are,
 * so an old booking still reads completely.
 */
export function summarizeSelections(
  selections: ReservationSelection[],
  menu: MenuCourse[],
): ReservationSummary {
  const order = new Map(menu.map((course, index) => [course.id, index]));
  const courses = new Map<string, CourseSummary>();

  for (const selection of selections) {
    let summary = courses.get(selection.courseId);

    if (!summary) {
      summary = {
        courseId: selection.courseId,
        courseName: selection.courseName,
        dishes: [],
        declined: 0,
      };
      courses.set(selection.courseId, summary);
    }

    if (isNoneSelection(selection)) {
      summary.declined += 1;
      continue;
    }

    const dish = summary.dishes.find((entry) => entry.optionId === selection.optionId);
    if (dish) {
      dish.quantity += 1;
    } else {
      summary.dishes.push({
        optionId: selection.optionId,
        optionName: selection.optionName,
        quantity: 1,
      });
    }
  }

  const ordered = Array.from(courses.values()).sort(
    (a, b) => (order.get(a.courseId) ?? Number.MAX_SAFE_INTEGER) - (order.get(b.courseId) ?? Number.MAX_SAFE_INTEGER),
  );

  for (const summary of ordered) {
    // Within a course, the dish the kitchen makes most of comes first.
    summary.dishes.sort((a, b) => b.quantity - a.quantity || a.optionName.localeCompare(b.optionName));
  }

  return {
    courses: ordered,
    plates: ordered.reduce(
      (total, summary) => total + summary.dishes.reduce((sum, dish) => sum + dish.quantity, 0),
      0,
    ),
    declined: ordered.reduce((total, summary) => total + summary.declined, 0),
  };
}
