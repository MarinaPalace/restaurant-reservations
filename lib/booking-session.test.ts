import { describe, expect, it } from "vitest";
import {
  BOOKING_STORAGE_KEYS,
  EMPTY_BOOKING_SESSION,
  findMissingRequirement,
  normalizeSelections,
  parseGuestCount,
  pruneSelectionsToGuestCount,
  readBookingSession,
  readStoredConfirmation,
} from "@/lib/booking-session";

function fakeStorage(values: Record<string, string>): Storage {
  return {
    getItem: (key: string) => values[key] ?? null,
  } as unknown as Storage;
}

describe("guest count parsing", () => {
  it("accepts a valid party size", () => {
    expect(parseGuestCount("2")).toBe(2);
    expect(parseGuestCount("6")).toBe(6);
  });

  it("rejects values outside the bookable range", () => {
    expect(parseGuestCount(null)).toBe(0);
    expect(parseGuestCount("0")).toBe(0);
    expect(parseGuestCount("7")).toBe(0);
    expect(parseGuestCount("2.5")).toBe(0);
    expect(parseGuestCount("nonsense")).toBe(0);
  });
});

describe("selection normalisation", () => {
  const selection = {
    guestIndex: 1,
    courseId: "course-1",
    courseName: "Starter",
    optionId: "option-1",
    optionName: "Salmon",
  };

  it("reads the array format", () => {
    expect(normalizeSelections([selection])).toEqual([selection]);
  });

  it("reads the legacy object-keyed format written by earlier builds", () => {
    expect(normalizeSelections({ "0-course-1": selection })).toEqual([selection]);
  });

  it("defaults a missing guest index to the first guest", () => {
    const withoutIndex = {
      courseId: selection.courseId,
      courseName: selection.courseName,
      optionId: selection.optionId,
      optionName: selection.optionName,
    };

    expect(normalizeSelections([withoutIndex])[0].guestIndex).toBe(0);
  });

  it("drops entries that are not usable selections", () => {
    expect(normalizeSelections([{ courseId: "", optionId: "" }, null, "nope"])).toEqual([]);
    expect(normalizeSelections(undefined)).toEqual([]);
  });

  it("removes choices for guests who left the party", () => {
    const selections = [
      { ...selection, guestIndex: 0 },
      { ...selection, guestIndex: 1 },
      { ...selection, guestIndex: 2 },
    ];

    expect(pruneSelectionsToGuestCount(selections, 2)).toHaveLength(2);
  });
});

describe("reading the booking session", () => {
  it("returns empty defaults when there is no storage (server render)", () => {
    expect(readBookingSession(null)).toEqual(EMPTY_BOOKING_SESSION);
  });

  it("reads a complete session", () => {
    const session = readBookingSession(
      fakeStorage({
        [BOOKING_STORAGE_KEYS.roomNumber]: "402",
        [BOOKING_STORAGE_KEYS.guestCount]: "2",
        [BOOKING_STORAGE_KEYS.date]: "2026-08-18",
        [BOOKING_STORAGE_KEYS.language]: "fr",
        [BOOKING_STORAGE_KEYS.selections]: JSON.stringify([
          { guestIndex: 0, courseId: "c1", courseName: "Starter", optionId: "o1", optionName: "Salmon" },
        ]),
      }),
    );

    expect(session.roomNumber).toBe("402");
    expect(session.guestCount).toBe(2);
    expect(session.date).toBe("2026-08-18");
    expect(session.language).toBe("fr");
    expect(session.selections).toHaveLength(1);
  });

  it("discards tampered or corrupt values instead of trusting them", () => {
    const session = readBookingSession(
      fakeStorage({
        [BOOKING_STORAGE_KEYS.roomNumber]: "'; DROP TABLE--",
        [BOOKING_STORAGE_KEYS.date]: "2026-02-31",
        [BOOKING_STORAGE_KEYS.selections]: "{not json",
      }),
    );

    expect(session.roomNumber).toBe("");
    expect(session.date).toBe("");
    expect(session.selections).toEqual([]);
  });
});

describe("step guards", () => {
  const complete = {
    roomNumber: "402",
    guestCount: 2,
    date: "2026-08-18",
    selections: [{ guestIndex: 0, courseId: "c1", courseName: "S", optionId: "o1", optionName: "O" }],
    language: "en",
  };

  it("passes a complete session", () => {
    expect(findMissingRequirement(complete, ["room", "guests", "date", "selections"])).toBeNull();
  });

  it("reports the first missing prerequisite", () => {
    expect(findMissingRequirement({ ...complete, roomNumber: "" }, ["room", "guests"])).toBe("room");
    expect(findMissingRequirement({ ...complete, guestCount: 0 }, ["room", "guests"])).toBe("guests");
    expect(findMissingRequirement({ ...complete, date: "" }, ["room", "guests", "date"])).toBe("date");
  });
});

describe("stored confirmation", () => {
  it("returns null when nothing was stored", () => {
    expect(readStoredConfirmation(fakeStorage({}))).toBeNull();
  });

  it("reads back a confirmed reservation", () => {
    const confirmation = readStoredConfirmation(
      fakeStorage({
        [BOOKING_STORAGE_KEYS.confirmation]: JSON.stringify({
          reservationNumber: "ALC-ABC123",
          roomNumber: "402",
          guestCount: 2,
          date: "2026-08-18",
          selections: [],
          status: "confirmed",
        }),
      }),
    );

    expect(confirmation?.reservationNumber).toBe("ALC-ABC123");
    expect(confirmation?.roomNumber).toBe("402");
  });
});
