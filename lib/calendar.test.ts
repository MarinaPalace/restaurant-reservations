import { afterEach, describe, expect, it } from "vitest";
import {
  ARRIVE_EARLY_MINUTES,
  buildGoogleCalendarUrl,
  buildIcsFile,
  getReservationWindow,
} from "@/lib/calendar";
import type { ReservationRecord } from "@/types/booking";

/** Turns a YYYYMMDDTHHMMSSZ stamp back into a Date. */
function stampToDate(stamp: string) {
  const [, y, mo, d, h, mi, sec] = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(stamp)!;
  return new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +sec));
}


const reservation: ReservationRecord = {
  reservationNumber: "ALC-ABC123",
  roomNumber: "402",
  guestCount: 2,
  date: "2026-08-18",
  status: "confirmed",
  selections: [
    { guestIndex: 0, courseId: "c1", courseName: "Starter", optionId: "o1", optionName: "Salmon" },
    { guestIndex: 1, courseId: "c1", courseName: "Starter", optionId: "o2", optionName: "Velouté" },
  ],
};

afterEach(() => {
  delete process.env.NEXT_PUBLIC_DINNER_TIME;
  delete process.env.NEXT_PUBLIC_DINNER_DURATION_MINUTES;
});

describe("reservation window", () => {
  it("defaults to a two-hour sitting at 19:00 local time", () => {
    const { start, end } = getReservationWindow("2026-08-18");

    expect(start.getFullYear()).toBe(2026);
    expect(start.getMonth()).toBe(7);
    expect(start.getDate()).toBe(18);
    expect(start.getHours()).toBe(19);
    expect(end.getHours()).toBe(21);
  });

  it("honours the configured service time and duration", () => {
    process.env.NEXT_PUBLIC_DINNER_TIME = "18:30";
    process.env.NEXT_PUBLIC_DINNER_DURATION_MINUTES = "90";

    const { start, end } = getReservationWindow("2026-08-18");

    expect([start.getHours(), start.getMinutes()]).toEqual([18, 30]);
    expect([end.getHours(), end.getMinutes()]).toEqual([20, 0]);
  });

  it("ignores a malformed time rather than producing an invalid date", () => {
    process.env.NEXT_PUBLIC_DINNER_TIME = "not-a-time";
    expect(getReservationWindow("2026-08-18").start.getHours()).toBe(19);
  });
});

describe("explicit end time", () => {
  /**
   * Regression test: an arrival time of 19:30 produced a 19:00-21:00 event,
   * because the stored time was being dropped before the link was built.
   */
  it("runs from the arrival time to the end time staff set", () => {
    const { start, end } = getReservationWindow("2026-08-18", "19:30", "21:00");

    expect([start.getHours(), start.getMinutes()]).toEqual([19, 30]);
    expect([end.getHours(), end.getMinutes()]).toEqual([21, 0]);
  });

  it("uses the booking's own times in the calendar link", () => {
    const url = new URL(buildGoogleCalendarUrl({ ...reservation, time: "19:30", endTime: "21:00" }));
    const [from, to] = (url.searchParams.get("dates") ?? "").split("/");

    // Compared as local wall-clock times, since the stamps are UTC.
    expect(new Date(reservation.date + "T19:30").getTime()).toBe(stampToDate(from).getTime());
    expect(new Date(reservation.date + "T21:00").getTime()).toBe(stampToDate(to).getTime());
  });

  it("carries the sitting past midnight when the end is earlier than the start", () => {
    const { start, end } = getReservationWindow("2026-08-18", "22:00", "00:30");

    expect(end.getTime()).toBeGreaterThan(start.getTime());
    expect(end.getDate()).toBe(19);
  });

  it("falls back to the fixed length when no end time is set", () => {
    const { start, end } = getReservationWindow("2026-08-18", "19:30");
    expect(end.getTime() - start.getTime()).toBe(120 * 60 * 1000);
  });
});

describe("arriving on time", () => {
  it("tells the guest to arrive early in the reminder itself", () => {
    const details = new URL(buildGoogleCalendarUrl({ ...reservation, time: "19:30" })).searchParams.get("details");

    expect(details).toContain("seated at 19:30");
    expect(details).toContain("minutes early");
  });

  it("adds a short-notice alarm as well as the evening reminder", () => {
    const ics = buildIcsFile({ ...reservation, time: "19:30" });

    expect(ics).toContain("TRIGGER:-PT3H");
    expect(ics).toContain(`TRIGGER:-PT${ARRIVE_EARLY_MINUTES + 5}M`);
  });
});

describe("Google Calendar link", () => {
  it("carries the reservation details", () => {
    const url = new URL(buildGoogleCalendarUrl(reservation));

    expect(url.origin + url.pathname).toBe("https://calendar.google.com/calendar/render");
    expect(url.searchParams.get("action")).toBe("TEMPLATE");
    expect(url.searchParams.get("text")).toContain("ALC-ABC123");
    expect(url.searchParams.get("details")).toContain("Room 402");
    expect(url.searchParams.get("details")).toContain("Starter: Salmon");
    // Per-guest choices stay grouped in the reminder.
    expect(url.searchParams.get("details")).toContain("Guest 2");
  });

  it("uses the UTC basic format Google expects", () => {
    const dates = new URL(buildGoogleCalendarUrl(reservation)).searchParams.get("dates") ?? "";
    expect(dates).toMatch(/^\d{8}T\d{6}Z\/\d{8}T\d{6}Z$/);
  });
});

describe("ics file", () => {
  it("is a well-formed single-event calendar", () => {
    const ics = buildIcsFile(reservation);

    expect(ics.startsWith("BEGIN:VCALENDAR")).toBe(true);
    expect(ics.trimEnd().endsWith("END:VCALENDAR")).toBe(true);
    expect(ics).toContain("BEGIN:VEVENT");
    expect(ics).toContain("UID:ALC-ABC123@reservations");
    expect(ics).toContain("TRIGGER:-PT3H");
    // CRLF line endings are required by RFC 5545.
    expect(ics).toContain("\r\n");
  });

  it("escapes characters that would otherwise break the format", () => {
    const ics = buildIcsFile(
      {
        ...reservation,
        selections: [
          { guestIndex: 0, courseId: "c1", courseName: "Salad; greens", optionId: "o1", optionName: "Oil, salt" },
        ],
      },
      "Main hall, level 2",
    );

    expect(ics).toContain("Salad\\; greens");
    expect(ics).toContain("Oil\\, salt");
    expect(ics).toContain("LOCATION:Main hall\\, level 2");
  });
});
