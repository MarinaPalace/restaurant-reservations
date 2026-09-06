import { describe, expect, it } from "vitest";
import { MAX_GUESTS_PER_RESERVATION } from "@/lib/validation/booking";
import {
  BOOKING_STORAGE_KEYS,
  EMPTY_BOOKING_SESSION,
  allowedGuestCount,
  findMissingRequirement,
  normalizeSelections,
  parseGuestCount,
  pruneSelectionsToGuestCount,
  readBookingSession,
  readStoredConfirmation,
  seatHoldStanding,
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
    passKey: "K7QP3M2XR4",
    passKeyExpiresOn: "2026-08-25",
    passKeyBookedDates: [],
    passKeyMaxGuests: 4,
    roomNumber: "402",
    guestCount: 2,
    date: "2026-08-18",
    tableId: "",
    joinNumber: "",
    selections: [{ guestIndex: 0, courseId: "c1", courseName: "S", optionId: "o1", optionName: "O" }],
    language: "en",
    holdId: "",
    holdExpiresAt: "",
    holdDate: "",
    holdGuests: 0,
  };

  it("passes a complete session", () => {
    expect(findMissingRequirement(complete, ["room", "guests", "date", "selections"])).toBeNull();
  });

  it("reports the first missing prerequisite", () => {
    expect(findMissingRequirement({ ...complete, roomNumber: "" }, ["room", "guests"])).toBe("room");
    expect(findMissingRequirement({ ...complete, guestCount: 0 }, ["room", "guests"])).toBe("guests");
    expect(findMissingRequirement({ ...complete, date: "" }, ["room", "guests", "date"])).toBe("date");
  });

  /**
   * The pass-key and the room are the same step, and the booking is refused
   * without both — so a session carrying only one of them has to go back
   * rather than reaching a summary page it can never submit.
   */
  it("sends the guest back when the pass-key is missing", () => {
    expect(findMissingRequirement({ ...complete, passKey: "" }, ["room", "guests", "date"])).toBe("room");
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

/**
 * The pass-key carries the party size from the hotel booking. The guests step
 * offers no more than that, and the server refuses more regardless.
 */
describe("allowedGuestCount", () => {
  it("caps at the number recorded on the key", () => {
    expect(allowedGuestCount({ passKeyMaxGuests: 2 })).toBe(2);
    expect(allowedGuestCount({ passKeyMaxGuests: 4 })).toBe(4);
  });

  it("falls back to the house maximum when the key records nothing", () => {
    expect(allowedGuestCount({ passKeyMaxGuests: 0 })).toBe(MAX_GUESTS_PER_RESERVATION);
  });

  /** A stored number can never let a party exceed the restaurant's own limit. */
  it("never exceeds the house maximum", () => {
    expect(allowedGuestCount({ passKeyMaxGuests: 99 })).toBe(MAX_GUESTS_PER_RESERVATION);
  });
});

describe("reading the party size back", () => {
  it("reads the limit the entry step stored", () => {
    const session = readBookingSession(fakeStorage({ [BOOKING_STORAGE_KEYS.passKeyMaxGuests]: "2" }));
    expect(session.passKeyMaxGuests).toBe(2);
    expect(allowedGuestCount(session)).toBe(2);
  });

  it("ignores a tampered or nonsensical limit rather than trusting it", () => {
    for (const value of ["0", "-3", "99", "two", ""]) {
      const session = readBookingSession(fakeStorage({ [BOOKING_STORAGE_KEYS.passKeyMaxGuests]: value }));
      expect(session.passKeyMaxGuests).toBe(0);
      // Which leaves the house maximum, never something larger.
      expect(allowedGuestCount(session)).toBe(MAX_GUESTS_PER_RESERVATION);
    }
  });
});

describe("what the seats a booking is holding are worth", () => {
  const NOW = new Date("2026-09-04T18:00:00.000Z");

  const holding = {
    date: "2026-09-18",
    guestCount: 4,
    holdId: "hold-1",
    holdExpiresAt: "2026-09-04T18:10:00.000Z",
    holdDate: "2026-09-18",
    holdGuests: 4,
  };

  it("is nothing before a hold has been taken", () => {
    expect(seatHoldStanding({ ...holding, holdId: "", holdExpiresAt: "" }, NOW)).toEqual({
      state: "none",
    });
  });

  it("counts down while it is live", () => {
    expect(seatHoldStanding(holding, NOW)).toEqual({ state: "held", secondsLeft: 600 });
  });

  it("is expired once the time has passed", () => {
    expect(seatHoldStanding({ ...holding, holdExpiresAt: "2026-09-04T17:59:59.000Z" }, NOW)).toEqual({
      state: "expired",
    });
  });

  /**
   * Going back and changing the evening is the commonest thing a guest does on
   * this flow, and the hold left behind is for the wrong night. Its own state,
   * because nothing has been lost — the calendar moves the hold when the guest
   * comes forward again — and telling them their seats were gone would be both
   * alarming and untrue.
   */
  it("is stale when the evening has changed under it", () => {
    expect(seatHoldStanding({ ...holding, date: "2026-09-19" }, NOW)).toEqual({ state: "stale" });
  });

  it("is stale when the party has outgrown it", () => {
    expect(seatHoldStanding({ ...holding, guestCount: 5 }, NOW)).toEqual({ state: "stale" });
  });

  /**
   * Shrinking is fine, and has to be: the server spends the hold for what is
   * actually booked and hands the difference back to the room. Calling this
   * stale would send a guest who dropped a diner back to the calendar for no
   * reason.
   */
  it("still stands when the party has shrunk", () => {
    expect(seatHoldStanding({ ...holding, guestCount: 2 }, NOW)).toEqual({
      state: "held",
      secondsLeft: 600,
    });
  });

  /** Expiry is asked first: a hold that has run out is not merely stale. */
  it("reports an expired hold as expired even when it is also stale", () => {
    expect(
      seatHoldStanding({ ...holding, date: "2026-09-19", holdExpiresAt: "2026-09-04T17:00:00.000Z" }, NOW),
    ).toEqual({ state: "expired" });
  });

  it("treats an unreadable expiry as expired", () => {
    expect(seatHoldStanding({ ...holding, holdExpiresAt: "soon" }, NOW)).toEqual({ state: "expired" });
  });
});
