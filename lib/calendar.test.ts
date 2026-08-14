import { afterEach, describe, expect, it } from "vitest";
import { buildGoogleCalendarUrl, buildIcsFile, getReservationWindow } from "@/lib/calendar";
import type { ReservationRecord } from "@/types/booking";

const reservation: ReservationRecord = {
  reservationNumber: "ALC-ABC123",
  roomNumber: 402,
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
