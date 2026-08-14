import { describe, expect, it } from "vitest";
import { validateReservationRequest } from "@/lib/services/booking-rules";
import { NONE_OPTION_ID, NONE_OPTION_NAME } from "@/lib/menu-selection";
import type { MenuCourse, ReservationSelection, RestaurantDateAvailability } from "@/types/booking";

const NOW = new Date(2026, 7, 14, 12);
const DINNER_DATE = "2026-08-18";

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
      name: optionId,
      description: "",
      allergens: [],
      active: true,
    })),
    ...overrides,
  };
}

const menu: MenuCourse[] = [
  course("course-1", "Amuse Bouche", ["opt-1"]),
  course("course-2", "Starter", ["opt-2", "opt-3"]),
  course("course-3", "Main Course", ["opt-4", "opt-5"]),
];

function selectionsForGuest(guestIndex: number, optionIds: [string, string, string]): ReservationSelection[] {
  return [
    { guestIndex, courseId: "course-1", courseName: "Amuse Bouche", optionId: optionIds[0], optionName: "A" },
    { guestIndex, courseId: "course-2", courseName: "Starter", optionId: optionIds[1], optionName: "B" },
    { guestIndex, courseId: "course-3", courseName: "Main Course", optionId: optionIds[2], optionName: "C" },
  ];
}

const validSelections = [
  ...selectionsForGuest(0, ["opt-1", "opt-2", "opt-4"]),
  ...selectionsForGuest(1, ["opt-1", "opt-3", "opt-5"]),
];

function availability(overrides: Partial<RestaurantDateAvailability> = {}): RestaurantDateAvailability {
  return { date: DINNER_DATE, isOpen: true, capacity: 40, reservedSeats: 10, remainingSeats: 30, ...overrides };
}

function validate(overrides: Partial<Parameters<typeof validateReservationRequest>[0]> = {}) {
  return validateReservationRequest({
    roomNumber: 402,
    guestCount: 2,
    date: DINNER_DATE,
    selections: validSelections,
    restaurantDate: availability(),
    menu,
    now: NOW,
    ...overrides,
  });
}

describe("reservation validation", () => {
  it("allows a complete reservation", () => {
    expect(validate().ok).toBe(true);
  });

  it("rejects an invalid room number", () => {
    expect(validate({ roomNumber: 0 }).error).toContain("valid room number");
    expect(validate({ roomNumber: -3 }).error).toContain("valid room number");
  });

  it("rejects a party larger than the restaurant accepts", () => {
    expect(validate({ guestCount: 7 }).error).toContain("valid guest count");
    expect(validate({ guestCount: 0 }).error).toContain("valid guest count");
  });

  it("rejects a date in the past", () => {
    expect(validate({ date: "2026-08-13", restaurantDate: availability({ date: "2026-08-13" }) }).error).toContain(
      "already passed",
    );
  });

  it("rejects a closed date", () => {
    expect(validate({ restaurantDate: availability({ isOpen: false }) }).error).toContain("no longer available");
  });

  it("rejects a date that is not configured at all", () => {
    expect(validate({ restaurantDate: null }).error).toContain("no longer available");
  });

  it("rejects a fully booked date", () => {
    expect(validate({ restaurantDate: availability({ reservedSeats: 40, remainingSeats: 0 }) }).error).toContain(
      "fully booked",
    );
  });

  it("rejects a party larger than the seats left", () => {
    expect(
      validate({ guestCount: 4, restaurantDate: availability({ reservedSeats: 38, remainingSeats: 2 }) }).error,
    ).toContain("fully booked");
  });

  it("rejects missing required courses", () => {
    expect(validate({ selections: validSelections.slice(0, 5) }).error).toContain("Please choose an option");
  });

  it("rejects an unknown menu option", () => {
    const tampered = [{ ...validSelections[0], optionId: "opt-not-real" }, ...validSelections.slice(1)];
    expect(validate({ selections: tampered }).error).toContain("Invalid menu option");
  });

  it("rejects an option that staff have switched off", () => {
    const menuWithInactiveOption: MenuCourse[] = [
      menu[0],
      {
        ...menu[1],
        options: menu[1].options.map((option) => (option.id === "opt-2" ? { ...option, active: false } : option)),
      },
      menu[2],
    ];

    expect(validate({ menu: menuWithInactiveOption }).error).toContain("Invalid menu option");
  });

  it("rejects two choices for the same course", () => {
    const doubled = [
      ...validSelections,
      { guestIndex: 0, courseId: "course-2", courseName: "Starter", optionId: "opt-3", optionName: "B" },
    ];

    expect(validate({ selections: doubled }).error).toContain("only one option");
  });

  it("rejects choices for a guest who is not on the booking", () => {
    const extraGuest = [...validSelections, ...selectionsForGuest(4, ["opt-1", "opt-2", "opt-4"])];
    expect(validate({ selections: extraGuest }).error).toContain("valid guest count");
  });

  /**
   * Regression test: the route used to require an explicit guestIndex, so a
   * single-guest booking sent by an older client was rejected with "Please
   * choose an option for Amuse Bouche" even though every course was chosen.
   */
  it("accepts a single-guest booking sent without a guest index", () => {
    const legacySelections = selectionsForGuest(0, ["opt-1", "opt-2", "opt-4"]).map((entry) => ({
      courseId: entry.courseId,
      courseName: entry.courseName,
      optionId: entry.optionId,
      optionName: entry.optionName,
    }));

    const result = validate({ guestCount: 1, selections: legacySelections });

    expect(result.ok).toBe(true);
    expect(result.selections?.every((entry) => entry.guestIndex === 0)).toBe(true);
  });

  /**
   * A guest may decline any course. "None" is a real selection with a
   * reserved id, so it satisfies a required course without matching a dish.
   */
  it("accepts None for a required course", () => {
    const declining = [
      { guestIndex: 0, courseId: "course-1", courseName: "Amuse Bouche", optionId: NONE_OPTION_ID, optionName: NONE_OPTION_NAME },
      ...selectionsForGuest(0, ["opt-1", "opt-2", "opt-4"]).slice(1),
      ...selectionsForGuest(1, ["opt-1", "opt-3", "opt-5"]),
    ];

    expect(validate({ selections: declining }).ok).toBe(true);
  });

  it("accepts a guest declining every course", () => {
    const declineAll = menu.map((entry) => ({
      guestIndex: 0,
      courseId: entry.id,
      courseName: entry.name,
      optionId: NONE_OPTION_ID,
      optionName: NONE_OPTION_NAME,
    }));

    expect(validate({ guestCount: 1, selections: declineAll }).ok).toBe(true);
  });

  it("still rejects a course left out entirely", () => {
    // Declining must be explicit; a missing course is an incomplete booking.
    expect(validate({ guestCount: 1, selections: selectionsForGuest(0, ["opt-1", "opt-2", "opt-4"]).slice(1) }).error)
      .toContain("Please choose an option");
  });

  it("ignores courses that are not required", () => {
    const menuWithOptionalCourse = [...menu, course("course-4", "Cheese", ["opt-6"], { required: false })];
    expect(validate({ menu: menuWithOptionalCourse }).ok).toBe(true);
  });
});
