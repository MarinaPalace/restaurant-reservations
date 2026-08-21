import { describe, expect, it } from "vitest";
import {
  compareByBookedAt,
  formatBookedAt,
  formatBookedAtLong,
  isReservationOrder,
  leadTimeHours,
  sortReservationsBy,
} from "@/lib/reservation-order";

/**
 * Ordering a list by when the bookings came in.
 *
 * The awkward case throughout is a booking with **no** `createdAt` — records
 * that predate the field. It is not "the oldest", it is unknown, and the
 * difference decides where it lands.
 */

function booking(reservationNumber: string, createdAt?: string) {
  return { reservationNumber, createdAt };
}

const early = booking("VDM-AAA111", "2026-08-01T09:00:00.000Z");
const middle = booking("VDM-BBB222", "2026-08-10T18:30:00.000Z");
const late = booking("VDM-CCC333", "2026-08-20T07:15:00.000Z");
const unknown = booking("VDM-DDD444");

describe("ordering", () => {
  it("puts the newest first", () => {
    expect(sortReservationsBy([early, late, middle], "newest").map((b) => b.reservationNumber)).toEqual([
      "VDM-CCC333",
      "VDM-BBB222",
      "VDM-AAA111",
    ]);
  });

  it("puts the oldest first", () => {
    expect(sortReservationsBy([late, early, middle], "oldest").map((b) => b.reservationNumber)).toEqual([
      "VDM-AAA111",
      "VDM-BBB222",
      "VDM-CCC333",
    ]);
  });

  /**
   * The rule worth pinning: unknown sorts last **both ways**. A row that moves
   * to the top when the list is reversed is a row nobody can find twice.
   */
  it("sorts a booking with no timestamp last, in either direction", () => {
    expect(sortReservationsBy([unknown, middle, early], "newest").at(-1)?.reservationNumber).toBe("VDM-DDD444");
    expect(sortReservationsBy([unknown, middle, early], "oldest").at(-1)?.reservationNumber).toBe("VDM-DDD444");
  });

  it("keeps two unknowns in a stable, repeatable order", () => {
    const a = booking("VDM-ZZZ999");
    const b = booking("VDM-AAA000");

    expect(sortReservationsBy([a, b], "newest").map((x) => x.reservationNumber)).toEqual([
      "VDM-AAA000",
      "VDM-ZZZ999",
    ]);
  });

  /** Two bookings in the same second must not swap between renders. */
  it("breaks a tie on the reservation number", () => {
    const a = booking("VDM-BBB222", "2026-08-10T18:30:00.000Z");
    const b = booking("VDM-AAA111", "2026-08-10T18:30:00.000Z");

    expect(sortReservationsBy([a, b], "newest").map((x) => x.reservationNumber)).toEqual([
      "VDM-AAA111",
      "VDM-BBB222",
    ]);
    expect(sortReservationsBy([b, a], "newest").map((x) => x.reservationNumber)).toEqual([
      "VDM-AAA111",
      "VDM-BBB222",
    ]);
  });

  it("leaves service order to the sheet", () => {
    const input = [late, early, middle];
    expect(sortReservationsBy(input, "service").map((b) => b.reservationNumber)).toEqual(
      input.map((b) => b.reservationNumber),
    );
  });

  it("does not mutate its input", () => {
    const input = [late, early, middle];
    sortReservationsBy(input, "newest");
    expect(input.map((b) => b.reservationNumber)).toEqual(["VDM-CCC333", "VDM-AAA111", "VDM-BBB222"]);
  });

  it("copes with an empty list", () => {
    expect(sortReservationsBy([], "newest")).toEqual([]);
  });
});

describe("the comparator on its own", () => {
  it("is antisymmetric", () => {
    expect(Math.sign(compareByBookedAt(early, late, "newest"))).toBe(
      -Math.sign(compareByBookedAt(late, early, "newest")),
    );
  });

  it("reverses with the direction", () => {
    expect(Math.sign(compareByBookedAt(early, late, "newest"))).toBe(
      -Math.sign(compareByBookedAt(early, late, "oldest")),
    );
  });
});

describe("formatting", () => {
  it("shows the day and the time, without the year", () => {
    const formatted = formatBookedAt("2026-08-10T18:30:00.000Z");

    expect(formatted).toBeTruthy();
    expect(formatted).toMatch(/Aug/);
    expect(formatted).toMatch(/\d{2}:\d{2}/);
    expect(formatted).not.toMatch(/2026/);
  });

  it("shows the year on the long form", () => {
    expect(formatBookedAtLong("2026-08-10T18:30:00.000Z")).toMatch(/2026/);
  });

  /**
   * `new Date(undefined)` formats as the string "Invalid Date", which would
   * sit in a column looking like data. Both forms must refuse instead.
   */
  it("returns null rather than 'Invalid Date'", () => {
    expect(formatBookedAt(undefined)).toBeNull();
    expect(formatBookedAt("")).toBeNull();
    expect(formatBookedAt("not a date")).toBeNull();
    expect(formatBookedAtLong(undefined)).toBeNull();
    expect(formatBookedAtLong("nonsense")).toBeNull();
  });
});

describe("lead time", () => {
  it("counts whole hours from the booking to the sitting", () => {
    expect(leadTimeHours("2026-08-24T17:00:00.000Z", new Date("2026-08-25T17:00:00.000Z"))).toBe(24);
  });

  it("rounds down a part hour", () => {
    expect(leadTimeHours("2026-08-25T15:30:00.000Z", new Date("2026-08-25T17:00:00.000Z"))).toBe(1);
  });

  /**
   * Unknown is not zero. Counting a booking with no timestamp as "taken at the
   * last moment" would drag every average down and make the cutoff look
   * riskier than it is.
   */
  it("is null when the booking has no timestamp", () => {
    expect(leadTimeHours(undefined, new Date("2026-08-25T17:00:00.000Z"))).toBeNull();
  });

  it("is null when the sitting is unknown or unparseable", () => {
    expect(leadTimeHours("2026-08-24T17:00:00.000Z", null)).toBeNull();
    expect(leadTimeHours("2026-08-24T17:00:00.000Z", new Date("nonsense"))).toBeNull();
  });

  /** A booking taken after the sitting started is negative, not clamped. */
  it("goes negative rather than pretending", () => {
    expect(leadTimeHours("2026-08-25T20:00:00.000Z", new Date("2026-08-25T17:00:00.000Z"))).toBe(-3);
  });
});

describe("the stored order value", () => {
  it("recognises the three orders", () => {
    expect(isReservationOrder("service")).toBe(true);
    expect(isReservationOrder("newest")).toBe(true);
    expect(isReservationOrder("oldest")).toBe(true);
  });

  it("rejects anything else", () => {
    expect(isReservationOrder("sideways")).toBe(false);
    expect(isReservationOrder(undefined)).toBe(false);
  });
});
