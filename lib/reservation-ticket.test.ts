import { describe, expect, it } from "vitest";
import {
  adjustCourseQuantity,
  clearCourse,
  countCourseQuantities,
  expandCourseQuantities,
  fillCourseWithOption,
  findMissingCourses,
  replaceCourseQuantities,
  summarizeSelections,
  tallyCourses,
} from "@/lib/reservation-ticket";
import { NONE_OPTION_ID, NONE_OPTION_NAME } from "@/lib/menu-selection";
import type { MenuCourse, ReservationSelection } from "@/types/booking";

function course(id: string, name: string, optionIds: string[], overrides: Partial<MenuCourse> = {}): MenuCourse {
  return {
    id,
    order: 1,
    name,
    description: "",
    required: true,
    active: true,
    options: optionIds.map((optionId) => ({
      id: optionId,
      courseId: id,
      name: optionId.toUpperCase(),
      description: "",
      allergens: [],
      active: true,
    })),
    ...overrides,
  };
}

const starter = course("course-starter", "Starter", ["soup", "salad"]);
const main = course("course-main", "Main Course", ["bass", "beef"]);
const menu = [starter, main];

describe("expandCourseQuantities", () => {
  it("hands guest indexes out from zero in menu order", () => {
    const selections = expandCourseQuantities(starter, { soup: 2, salad: 1 }, 3);

    expect(selections).toEqual([
      { guestIndex: 0, courseId: "course-starter", courseName: "Starter", optionId: "soup", optionName: "SOUP" },
      { guestIndex: 1, courseId: "course-starter", courseName: "Starter", optionId: "soup", optionName: "SOUP" },
      { guestIndex: 2, courseId: "course-starter", courseName: "Starter", optionId: "salad", optionName: "SALAD" },
    ]);
  });

  it("names a decline rather than leaving the course unanswered", () => {
    const selections = expandCourseQuantities(starter, { soup: 1, [NONE_OPTION_ID]: 1 }, 2);

    expect(selections.map((entry) => entry.optionName)).toEqual(["SOUP", NONE_OPTION_NAME]);
  });

  /**
   * A miscounted ticket must not produce a choice for a guest who is not
   * coming: the server rejects the whole booking for it.
   */
  it("never writes more choices than there are guests", () => {
    const selections = expandCourseQuantities(starter, { soup: 4, salad: 4 }, 3);

    expect(selections).toHaveLength(3);
    expect(selections.map((entry) => entry.guestIndex)).toEqual([0, 1, 2]);
  });

  it("ignores negative and fractional quantities", () => {
    expect(expandCourseQuantities(starter, { soup: -2, salad: 1.7 }, 4)).toHaveLength(1);
  });

  it("keeps a dish that has since been withdrawn from the menu", () => {
    const selections = expandCourseQuantities(starter, { "old-dish": 1 }, 2);

    expect(selections).toHaveLength(1);
    expect(selections[0].optionId).toBe("old-dish");
  });
});

describe("replaceCourseQuantities", () => {
  it("leaves the other courses alone", () => {
    const existing = [
      ...expandCourseQuantities(starter, { soup: 2 }, 2),
      ...expandCourseQuantities(main, { bass: 2 }, 2),
    ];

    const next = replaceCourseQuantities(existing, starter, { salad: 2 }, 2);

    expect(countCourseQuantities(next, "course-starter")).toEqual({ salad: 2 });
    expect(countCourseQuantities(next, "course-main")).toEqual({ bass: 2 });
  });
});

describe("adjustCourseQuantity", () => {
  const empty: ReservationSelection[] = [];

  it("adds a plate", () => {
    const next = adjustCourseQuantity(empty, starter, "soup", 1, 4);
    expect(countCourseQuantities(next, "course-starter")).toEqual({ soup: 1 });
  });

  it("stops at the party size", () => {
    let selections = empty;
    for (let index = 0; index < 6; index += 1) {
      selections = adjustCourseQuantity(selections, starter, "soup", 1, 3);
    }

    expect(countCourseQuantities(selections, "course-starter")).toEqual({ soup: 3 });
  });

  it("counts the whole course against the party, not one dish", () => {
    const withSoup = expandCourseQuantities(starter, { soup: 3 }, 3);
    const next = adjustCourseQuantity(withSoup, starter, "salad", 1, 3);

    expect(next).toBe(withSoup);
  });

  it("takes a plate away and never goes below zero", () => {
    const one = adjustCourseQuantity(empty, starter, "soup", 1, 3);
    const none = adjustCourseQuantity(one, starter, "soup", -1, 3);
    const stillNone = adjustCourseQuantity(none, starter, "soup", -1, 3);

    expect(countCourseQuantities(none, "course-starter")).toEqual({});
    expect(stillNone).toEqual([]);
  });

  /**
   * Removing a plate must not leave a hole in the guest indexes: guest 2 with
   * no starter and guest 3 with one reads as an unfinished booking.
   */
  it("repacks the guests after a plate is removed", () => {
    let selections = expandCourseQuantities(starter, { soup: 2, salad: 1 }, 3);
    selections = adjustCourseQuantity(selections, starter, "soup", -1, 3);

    expect(selections.map((entry) => entry.guestIndex)).toEqual([0, 1]);
    expect(selections.map((entry) => entry.optionId)).toEqual(["soup", "salad"]);
  });
});

describe("fillCourseWithOption", () => {
  it("gives every remaining guest the same dish", () => {
    const selections = fillCourseWithOption([], main, "beef", 4);
    expect(countCourseQuantities(selections, "course-main")).toEqual({ beef: 4 });
  });

  it("only fills what is left", () => {
    const withBass = expandCourseQuantities(main, { bass: 1 }, 4);
    const filled = fillCourseWithOption(withBass, main, "beef", 4);

    expect(countCourseQuantities(filled, "course-main")).toEqual({ bass: 1, beef: 3 });
  });

  it("does nothing once the course is complete", () => {
    const full = expandCourseQuantities(main, { bass: 2 }, 2);
    expect(fillCourseWithOption(full, main, "beef", 2)).toBe(full);
  });
});

describe("clearCourse", () => {
  it("removes only that course", () => {
    const selections = [
      ...expandCourseQuantities(starter, { soup: 1 }, 1),
      ...expandCourseQuantities(main, { bass: 1 }, 1),
    ];

    expect(clearCourse(selections, "course-starter")).toHaveLength(1);
  });
});

describe("tallyCourses", () => {
  it("reports what each course has, in menu order", () => {
    const selections = [
      ...expandCourseQuantities(starter, { soup: 2 }, 3),
      ...expandCourseQuantities(main, { bass: 1, beef: 2 }, 3),
    ];

    expect(tallyCourses(selections, menu)).toEqual([
      {
        courseId: "course-starter",
        courseName: "Starter",
        required: true,
        quantities: { soup: 2 },
        chosen: 2,
      },
      {
        courseId: "course-main",
        courseName: "Main Course",
        required: true,
        quantities: { bass: 1, beef: 2 },
        chosen: 3,
      },
    ]);
  });
});

describe("findMissingCourses", () => {
  it("says which courses are short, and by how many", () => {
    const selections = [
      ...expandCourseQuantities(starter, { soup: 2 }, 4),
      ...expandCourseQuantities(main, { bass: 4 }, 4),
    ];

    expect(findMissingCourses(selections, menu, 4)).toEqual([
      { courseId: "course-starter", courseName: "Starter", missing: 2 },
    ]);
  });

  it("is happy when every guest has every required course", () => {
    const selections = [
      ...expandCourseQuantities(starter, { soup: 1, [NONE_OPTION_ID]: 1 }, 2),
      ...expandCourseQuantities(main, { beef: 2 }, 2),
    ];

    expect(findMissingCourses(selections, menu, 2)).toEqual([]);
  });

  it("reports an empty booking rather than accepting it", () => {
    expect(findMissingCourses([], menu, 2)).toEqual([
      { courseId: "course-starter", courseName: "Starter", missing: 2 },
      { courseId: "course-main", courseName: "Main Course", missing: 2 },
    ]);
  });

  it("ignores optional and switched-off courses", () => {
    const extended = [
      ...menu,
      course("course-cheese", "Cheese", ["brie"], { required: false }),
      course("course-old", "Sorbet", ["lemon"], { active: false }),
    ];

    const selections = [
      ...expandCourseQuantities(starter, { soup: 1 }, 1),
      ...expandCourseQuantities(main, { bass: 1 }, 1),
    ];

    expect(findMissingCourses(selections, extended, 1)).toEqual([]);
  });

  /**
   * Two choices for one guest and none for another adds up to the right total
   * and is still an unfinished booking, which is why this counts per guest.
   */
  it("catches a course answered twice for one guest and not at all for another", () => {
    const selections: ReservationSelection[] = [
      { guestIndex: 0, courseId: "course-starter", courseName: "Starter", optionId: "soup", optionName: "SOUP" },
      { guestIndex: 0, courseId: "course-starter", courseName: "Starter", optionId: "salad", optionName: "SALAD" },
      ...expandCourseQuantities(main, { bass: 2 }, 2),
    ];

    expect(findMissingCourses(selections, menu, 2)).toEqual([
      { courseId: "course-starter", courseName: "Starter", missing: 1 },
    ]);
  });
});

describe("summarizeSelections", () => {
  it("counts each dish once, in menu order, most-ordered first", () => {
    const selections = [
      ...expandCourseQuantities(starter, { soup: 1, salad: 3 }, 4),
      ...expandCourseQuantities(main, { bass: 4 }, 4),
    ];

    const summary = summarizeSelections(selections, menu);

    expect(summary.courses.map((entry) => entry.courseName)).toEqual(["Starter", "Main Course"]);
    expect(summary.courses[0].dishes).toEqual([
      { optionId: "salad", optionName: "SALAD", quantity: 3 },
      { optionId: "soup", optionName: "SOUP", quantity: 1 },
    ]);
    expect(summary.plates).toBe(8);
  });

  it("keeps declines out of the plate count and reports them separately", () => {
    const selections = [
      ...expandCourseQuantities(starter, { soup: 1, [NONE_OPTION_ID]: 2 }, 3),
      ...expandCourseQuantities(main, { beef: 3 }, 3),
    ];

    const summary = summarizeSelections(selections, menu);

    expect(summary.courses[0].declined).toBe(2);
    expect(summary.courses[0].dishes).toEqual([{ optionId: "soup", optionName: "SOUP", quantity: 1 }]);
    expect(summary.plates).toBe(4);
    expect(summary.declined).toBe(2);
  });

  it("lists a course that is no longer on the menu after the ones that are", () => {
    const selections = [
      {
        guestIndex: 0,
        courseId: "course-gone",
        courseName: "Sorbet",
        optionId: "lemon",
        optionName: "Lemon sorbet",
      },
      ...expandCourseQuantities(starter, { soup: 1 }, 1),
    ];

    const summary = summarizeSelections(selections, menu);

    expect(summary.courses.map((entry) => entry.courseName)).toEqual(["Starter", "Sorbet"]);
  });

  it("has nothing to say about an empty booking", () => {
    expect(summarizeSelections([], menu)).toEqual({ courses: [], plates: 0, declined: 0 });
  });
});
