import { describe, expect, it } from "vitest";
import { buildCalendarGrid, isValidDateKey, isPastDateKey, startOfMonth, toDateKey, fromDateKey } from "@/lib/date";

describe("date keys", () => {
  /**
   * Regression test for the calendar being a day out. `toISOString()` on a
   * local midnight Date returns the previous day in any timezone east of UTC,
   * so the cell labelled 18 carried the key 2026-08-17 and guests booked the
   * wrong evening.
   */
  it("uses local calendar fields, not UTC", () => {
    const localMidnight = new Date(2026, 7, 18, 0, 0, 0);
    expect(toDateKey(localMidnight)).toBe("2026-08-18");
  });

  it("survives a round trip through a key", () => {
    expect(toDateKey(fromDateKey("2026-08-18"))).toBe("2026-08-18");
    expect(toDateKey(fromDateKey("2026-01-01"))).toBe("2026-01-01");
    expect(toDateKey(fromDateKey("2026-12-31"))).toBe("2026-12-31");
  });

  it("holds up across a DST transition", () => {
    // Europe/Sofia moves the clock forward on the last Sunday of March.
    expect(toDateKey(fromDateKey("2026-03-29"))).toBe("2026-03-29");
    expect(toDateKey(fromDateKey("2026-10-25"))).toBe("2026-10-25");
  });

  it("rejects dates that do not exist", () => {
    expect(isValidDateKey("2026-08-18")).toBe(true);
    expect(isValidDateKey("2026-02-31")).toBe(false);
    expect(isValidDateKey("2026-13-01")).toBe(false);
    expect(isValidDateKey("not-a-date")).toBe(false);
    expect(isValidDateKey("")).toBe(false);
  });

  it("identifies past dates against a fixed today", () => {
    const now = new Date(2026, 7, 18, 12);
    expect(isPastDateKey("2026-08-17", now)).toBe(true);
    expect(isPastDateKey("2026-08-18", now)).toBe(false);
    expect(isPastDateKey("2026-08-19", now)).toBe(false);
  });
});

describe("calendar grid", () => {
  it("always renders six Monday-first weeks", () => {
    const grid = buildCalendarGrid(startOfMonth(new Date(2026, 7, 1)));

    expect(grid).toHaveLength(42);
    expect(grid[0].getDay()).toBe(1); // Monday
    expect(grid.some((date) => toDateKey(date) === "2026-08-01")).toBe(true);
    expect(grid.some((date) => toDateKey(date) === "2026-08-31")).toBe(true);
  });

  it("starts on the Monday on or before the first of the month", () => {
    // 1 August 2026 is a Saturday, so the grid opens on Monday 27 July.
    const grid = buildCalendarGrid(startOfMonth(new Date(2026, 7, 1)));
    expect(toDateKey(grid[0])).toBe("2026-07-27");
  });
});
