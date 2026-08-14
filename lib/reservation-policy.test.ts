import { describe, expect, it } from "vitest";
import { canGuestModify, getModificationDeadline, MODIFICATION_CUTOFF_HOURS } from "@/lib/reservation-policy";

const reservation = { date: "2026-08-18", time: "19:30", endTime: "21:00", status: "confirmed" as const };

describe("modification deadline", () => {
  it("closes twelve hours before the sitting starts", () => {
    const deadline = getModificationDeadline(reservation);

    // 19:30 on the 18th, less 12 hours, is 07:30 the same morning.
    expect(deadline.getDate()).toBe(18);
    expect(deadline.getHours()).toBe(7);
    expect(deadline.getMinutes()).toBe(30);
  });

  it("follows the arrival time rather than a fixed sitting", () => {
    const early = getModificationDeadline({ ...reservation, time: "18:00" });
    expect(early.getHours()).toBe(6);
  });

  it("falls back to the default sitting when no time was recorded", () => {
    const deadline = getModificationDeadline({ date: "2026-08-18", time: undefined, endTime: undefined });
    expect(deadline.getHours()).toBe(19 - MODIFICATION_CUTOFF_HOURS);
  });
});

describe("guest changes", () => {
  it("allows a change comfortably before the cutoff", () => {
    const check = canGuestModify(reservation, new Date(2026, 7, 17, 20, 0));
    expect(check.allowed).toBe(true);
    expect(check.reason).toBeUndefined();
  });

  it("allows a change a minute before the cutoff", () => {
    expect(canGuestModify(reservation, new Date(2026, 7, 18, 7, 29)).allowed).toBe(true);
  });

  it("refuses once the cutoff has passed, pointing the guest at reception", () => {
    const check = canGuestModify(reservation, new Date(2026, 7, 18, 7, 31));

    expect(check.allowed).toBe(false);
    expect(check.reason).toContain("reception");
    expect(check.reason).toContain(`${MODIFICATION_CUTOFF_HOURS} hours`);
  });

  it("refuses exactly on the cutoff", () => {
    expect(canGuestModify(reservation, new Date(2026, 7, 18, 7, 30)).allowed).toBe(false);
  });

  it("refuses a booking that is already cancelled", () => {
    const check = canGuestModify({ ...reservation, status: "cancelled" }, new Date(2026, 7, 17, 12, 0));

    expect(check.allowed).toBe(false);
    expect(check.reason).toContain("already been cancelled");
  });
});
