import { describe, expect, it } from "vitest";
import {
  SEAT_HOLD_MINUTES,
  SEAT_HOLD_MS,
  SEAT_HOLD_STRAND_MS,
  formatSeatHoldClock,
  isSeatHoldLive,
  seatHoldExpiry,
  seatHoldSecondsLeft,
} from "@/lib/seat-hold";

const NOW = new Date("2026-09-04T18:00:00.000Z");

describe("how long seats are held", () => {
  it("is a quarter of an hour", () => {
    expect(SEAT_HOLD_MINUTES).toBe(15);
    expect(SEAT_HOLD_MS).toBe(15 * 60_000);
  });

  it("stamps the expiry that far ahead", () => {
    expect(seatHoldExpiry(NOW).toISOString()).toBe("2026-09-04T18:15:00.000Z");
  });

  /**
   * The safety net has to be longer than the hold itself, or it would sweep
   * seats out from under a guest who is still choosing.
   */
  it("waits longer than a hold before calling seats stranded", () => {
    expect(SEAT_HOLD_STRAND_MS).toBeGreaterThan(SEAT_HOLD_MS);
  });
});

describe("whether a hold is still good", () => {
  it("is live until the moment it is not", () => {
    expect(isSeatHoldLive("2026-09-04T18:00:01.000Z", NOW)).toBe(true);
    expect(isSeatHoldLive("2026-09-04T18:00:00.000Z", NOW)).toBe(false);
    expect(isSeatHoldLive("2026-09-04T17:59:59.000Z", NOW)).toBe(false);
  });

  /**
   * Nothing, or nonsense, reads as expired rather than live. A hold that cannot
   * be understood must not be allowed to hold seats: the failure that costs
   * somebody a table is the one where the answer defaults to yes.
   */
  it("treats a missing or unreadable expiry as expired", () => {
    expect(isSeatHoldLive(undefined, NOW)).toBe(false);
    expect(isSeatHoldLive("", NOW)).toBe(false);
    expect(isSeatHoldLive("not a date", NOW)).toBe(false);
  });

  it("accepts a Date as readily as a string", () => {
    expect(isSeatHoldLive(new Date("2026-09-04T18:10:00.000Z"), NOW)).toBe(true);
  });
});

describe("the countdown", () => {
  it("counts whole seconds left", () => {
    expect(seatHoldSecondsLeft("2026-09-04T18:14:30.000Z", NOW)).toBe(870);
  });

  /**
   * Floored, not rounded. A countdown showing 1 while the server has already
   * let the seats go is the same lie this feature exists to stop, in miniature.
   */
  it("floors rather than rounds", () => {
    expect(seatHoldSecondsLeft("2026-09-04T18:00:01.900Z", NOW)).toBe(1);
    expect(seatHoldSecondsLeft("2026-09-04T18:00:00.900Z", NOW)).toBe(0);
  });

  it("never goes below zero", () => {
    expect(seatHoldSecondsLeft("2026-09-04T17:00:00.000Z", NOW)).toBe(0);
    expect(seatHoldSecondsLeft(undefined, NOW)).toBe(0);
  });

  it("reads as a clock", () => {
    expect(formatSeatHoldClock(900)).toBe("15:00");
    expect(formatSeatHoldClock(65)).toBe("1:05");
    expect(formatSeatHoldClock(9)).toBe("0:09");
    expect(formatSeatHoldClock(0)).toBe("0:00");
    expect(formatSeatHoldClock(-5)).toBe("0:00");
  });
});
