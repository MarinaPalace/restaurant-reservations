import { describe, expect, it } from "vitest";
import {
  canGuestChooseTable,
  canGuestModify,
  getModificationDeadline,
  getTableSelectionDeadline,
  MODIFICATION_CUTOFF_HOURS,
} from "@/lib/reservation-policy";

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

/**
 * The third deadline. Bookings close when the kitchen can take no more covers;
 * changes close when it has counted; tables close when the floor is laid out —
 * which is usually earlier than either, and off entirely on an evening that
 * does not care.
 */
describe("when guests stop choosing tables", () => {
  const evening = { date: "2026-08-18", serviceTime: "19:30", serviceEndTime: "21:00" };

  it("is off unless somebody set it, which is what every evening did before", () => {
    expect(getTableSelectionDeadline(evening)).toBeNull();

    const check = canGuestChooseTable(evening, new Date("2026-08-18T19:29:00"));
    expect(check.allowed).toBe(true);
    expect(check.cutoffHours).toBe(0);
    expect(check.deadline).toBeNull();
  });

  it("closes the given number of hours before the sitting", () => {
    const deadline = getTableSelectionDeadline({ ...evening, tableCutoffHours: 4 });

    // 19:30 less four hours is 15:30 the same afternoon.
    expect(deadline?.getHours()).toBe(15);
    expect(deadline?.getMinutes()).toBe(30);
  });

  it("allows a choice before the deadline and refuses one after it", () => {
    const closing = { ...evening, tableCutoffHours: 4 };

    expect(canGuestChooseTable(closing, new Date("2026-08-18T15:29:00")).allowed).toBe(true);
    expect(canGuestChooseTable(closing, new Date("2026-08-18T15:31:00")).allowed).toBe(false);
  });

  it("follows the evening's own arrival time, not a fixed sitting", () => {
    const early = getTableSelectionDeadline({ ...evening, serviceTime: "18:00", tableCutoffHours: 2 });

    expect(early?.getHours()).toBe(16);
  });

  it("says yes for an evening that is not in the calendar at all", () => {
    // A date with no record cannot have a cutoff, and refusing on the strength
    // of a missing row would close the door on a room nobody has set up yet.
    expect(canGuestChooseTable(null).allowed).toBe(true);
  });

  it("treats a day-long cutoff as a day", () => {
    const deadline = getTableSelectionDeadline({ ...evening, tableCutoffHours: 24 });

    expect(deadline?.getDate()).toBe(17);
    expect(deadline?.getHours()).toBe(19);
  });
});
