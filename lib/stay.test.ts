import { describe, expect, it } from "vitest";
import { MAX_USES_CAP, MINIMUM_STAY_NIGHTS, nightsBetween, suggestedUsesForNights } from "@/types/booking";

/**
 * Nights, and the dinners they earn.
 *
 * Reception types two dates and nothing else — the night count and the number
 * of dinners are both derived, so the two can never disagree with the dates on
 * the card.
 */
describe("nightsBetween", () => {
  it("counts the nights between check-in and check-out", () => {
    expect(nightsBetween("2026-08-01", "2026-08-06")).toBe(5);
    expect(nightsBetween("2026-08-01", "2026-08-02")).toBe(1);
    expect(nightsBetween("2026-08-01", "2026-08-16")).toBe(15);
  });

  it("counts across a month and a year boundary", () => {
    expect(nightsBetween("2026-08-28", "2026-09-04")).toBe(7);
    expect(nightsBetween("2026-12-28", "2027-01-04")).toBe(7);
  });

  /**
   * Parsed at midday, so the hour a clock change removes cannot round a stay
   * down to one night short — the same trap `lib/date.ts` exists to avoid.
   */
  it("is unaffected by a daylight-saving change", () => {
    expect(nightsBetween("2026-03-27", "2026-04-01")).toBe(5);
    expect(nightsBetween("2026-10-23", "2026-10-28")).toBe(5);
  });

  it("returns nothing when a date is missing or the range is backwards", () => {
    expect(nightsBetween(undefined, "2026-08-06")).toBeUndefined();
    expect(nightsBetween("2026-08-01", undefined)).toBeUndefined();
    expect(nightsBetween("2026-08-06", "2026-08-01")).toBeUndefined();
    // Checking out the day you arrive is not a night.
    expect(nightsBetween("2026-08-01", "2026-08-01")).toBeUndefined();
    expect(nightsBetween("nonsense", "2026-08-06")).toBeUndefined();
  });
});

describe("suggestedUsesForNights", () => {
  it("earns one dinner per five nights", () => {
    expect(suggestedUsesForNights(5)).toBe(1);
    expect(suggestedUsesForNights(9)).toBe(1);
    expect(suggestedUsesForNights(10)).toBe(2);
    expect(suggestedUsesForNights(14)).toBe(2);
    expect(suggestedUsesForNights(15)).toBe(3);
  });

  it("caps at three however long the stay", () => {
    expect(suggestedUsesForNights(40)).toBe(MAX_USES_CAP);
    expect(suggestedUsesForNights(365)).toBe(MAX_USES_CAP);
  });

  /**
   * A short stay is not entitled to dinner at all — that is refused when the
   * key is issued — but if one is deliberately allowed it carries a single
   * dinner rather than none, which would be a key that cannot book.
   */
  it("never suggests zero", () => {
    expect(suggestedUsesForNights(1)).toBe(1);
    expect(suggestedUsesForNights(MINIMUM_STAY_NIGHTS - 1)).toBe(1);
    expect(suggestedUsesForNights(undefined)).toBe(1);
    expect(suggestedUsesForNights(0)).toBe(1);
  });

  it("agrees with the dates a stay is typed as", () => {
    expect(suggestedUsesForNights(nightsBetween("2026-08-01", "2026-08-11"))).toBe(2);
    expect(suggestedUsesForNights(nightsBetween("2026-08-01", "2026-08-16"))).toBe(3);
  });
});
