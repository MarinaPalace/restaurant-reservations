import { describe, expect, it } from "vitest";
import { canGuestBookDate, getBookingDeadline } from "@/lib/reservation-policy";
import type { RestaurantDateAvailability } from "@/types/booking";

/**
 * How late a guest may take a table.
 *
 * Local calendar strings throughout, never UTC (rule 2.1): the dates here are
 * built with `new Date(year, month, day, hour)`, which is local, and never
 * from an ISO string with a `Z`.
 */

function evening(overrides: Partial<RestaurantDateAvailability> = {}): RestaurantDateAvailability {
  return {
    date: "2026-08-25",
    isOpen: true,
    capacity: 40,
    reservedSeats: 0,
    remainingSeats: 40,
    serviceTime: "19:00",
    ...overrides,
  };
}

/** 25 August 2026, at the given local hour. */
function at(hour: number, minute = 0) {
  return new Date(2026, 7, 25, hour, minute, 0, 0);
}

describe("the deadline", () => {
  it("is the sitting itself when no cutoff is set", () => {
    // Absent reads as 0, which is what every evening did before this existed.
    expect(getBookingDeadline(evening()).getHours()).toBe(19);
  });

  it("is the given number of hours before the sitting", () => {
    expect(getBookingDeadline(evening({ bookingCutoffHours: 4 })).getHours()).toBe(15);
  });

  it("can reach back into the previous day", () => {
    const deadline = getBookingDeadline(evening({ bookingCutoffHours: 24 }));

    expect(deadline.getDate()).toBe(24);
    expect(deadline.getHours()).toBe(19);
  });

  it("follows the arrival time staff set, not a fixed dinner hour", () => {
    expect(getBookingDeadline(evening({ serviceTime: "20:30", bookingCutoffHours: 2 })).getHours()).toBe(18);
    expect(getBookingDeadline(evening({ serviceTime: "20:30", bookingCutoffHours: 2 })).getMinutes()).toBe(30);
  });

  it("treats a negative cutoff as none rather than pushing the deadline out", () => {
    expect(getBookingDeadline(evening({ bookingCutoffHours: -6 })).getHours()).toBe(19);
  });
});

describe("whether a guest may still book", () => {
  it("allows it well before the cutoff", () => {
    expect(canGuestBookDate(evening({ bookingCutoffHours: 4 }), at(9)).allowed).toBe(true);
  });

  it("refuses it after the cutoff", () => {
    expect(canGuestBookDate(evening({ bookingCutoffHours: 4 }), at(16)).allowed).toBe(false);
  });

  /** On the boundary the evening is already closed: the deadline is the close. */
  it("refuses it exactly on the deadline", () => {
    expect(canGuestBookDate(evening({ bookingCutoffHours: 4 }), at(15)).allowed).toBe(false);
  });

  it("allows it one minute before", () => {
    expect(canGuestBookDate(evening({ bookingCutoffHours: 4 }), at(14, 59)).allowed).toBe(true);
  });

  /**
   * The gap this closed. Only *past dates* were blocked before, so tonight's
   * dinner stayed bookable at midnight — hours after everyone had eaten.
   */
  it("refuses tonight's dinner once the sitting has started", () => {
    expect(canGuestBookDate(evening(), at(21)).allowed).toBe(false);
  });

  it("still allows tomorrow's", () => {
    expect(canGuestBookDate(evening({ date: "2026-08-26" }), at(21)).allowed).toBe(true);
  });

  it("reports the cutoff back, so a screen can explain itself", () => {
    expect(canGuestBookDate(evening({ bookingCutoffHours: 6 }), at(9)).cutoffHours).toBe(6);
    expect(canGuestBookDate(evening(), at(9)).cutoffHours).toBe(0);
  });
});
