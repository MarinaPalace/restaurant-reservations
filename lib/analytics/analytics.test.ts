import { describe, expect, it } from "vitest";
import {
  bucketFor,
  bucketKeyOf,
  bucketsIn,
  countDays,
  formatBucket,
  isWithin,
  previousRange,
  resolvePreset,
  startOfWeek,
} from "@/lib/analytics/range";
import {
  buildTotals,
  cancellationLines,
  capacityTrend,
  coversTrend,
  dishPopularity,
  partySizes,
  passKeyFunnel,
  promotionLines,
} from "@/lib/analytics/metrics";
import { NONE_OPTION_ID, NONE_OPTION_NAME } from "@/lib/menu-selection";
import type { MenuCourse, ReservationRecord, RestaurantDateAvailability } from "@/types/booking";

/**
 * The numbers the restaurant will make decisions on.
 *
 * Rule 2.1 runs through all of it: every date here is a local calendar string,
 * and every `Date` is built with the local constructor. Nothing goes near
 * `toISOString().slice(0, 10)`, which is what silently moves covers between
 * weeks.
 */

function booking(overrides: Partial<ReservationRecord> = {}): ReservationRecord {
  return {
    reservationNumber: "VDM-AAA111",
    roomNumber: "402",
    guestCount: 2,
    date: "2026-08-10",
    selections: [],
    status: "confirmed",
    createdAt: "2026-08-01T10:00:00.000Z",
    ...overrides,
  };
}

function evening(date: string, overrides: Partial<RestaurantDateAvailability> = {}): RestaurantDateAvailability {
  return {
    date,
    isOpen: true,
    capacity: 40,
    reservedSeats: 0,
    remainingSeats: 40,
    ...overrides,
  };
}

const AUGUST = { from: "2026-08-01", to: "2026-08-31" };

describe("ranges", () => {
  it("resolves this month to its own calendar bounds", () => {
    expect(resolvePreset("this-month", "2026-08-21")).toEqual({ from: "2026-08-01", to: "2026-08-31" });
  });

  it("resolves last month, including a short one", () => {
    expect(resolvePreset("last-month", "2026-03-15")).toEqual({ from: "2026-02-01", to: "2026-02-28" });
  });

  /** 89 back, not 90: the range includes today, or it would be 91 days long. */
  it("makes last-90 exactly ninety days", () => {
    const range = resolvePreset("last-90", "2026-08-21");
    expect(countDays(range)).toBe(90);
    expect(range.to).toBe("2026-08-21");
  });

  it("compares against the previous period of the same length", () => {
    // August is 31 days, so the comparison period is the 31 days ending the
    // day before it — all of July, as it happens.
    expect(previousRange({ from: "2026-08-01", to: "2026-08-31" })).toEqual({
      from: "2026-07-01",
      to: "2026-07-31",
    });
    expect(countDays(previousRange(AUGUST))).toBe(countDays(AUGUST));
  });

  it("counts a single day as one", () => {
    expect(countDays({ from: "2026-08-21", to: "2026-08-21" })).toBe(1);
  });

  /**
   * The boundary that would break silently. A range built through UTC drops or
   * duplicates a day when the clocks change; both ends are built at midday so
   * the arithmetic cannot land on a 23- or 25-hour day.
   */
  it("counts across a spring DST boundary correctly", () => {
    // Europe/Sofia moves on the last Sunday of March.
    expect(countDays({ from: "2026-03-28", to: "2026-03-30" })).toBe(3);
  });

  it("counts across an autumn DST boundary correctly", () => {
    expect(countDays({ from: "2026-10-24", to: "2026-10-26" })).toBe(3);
  });

  it("treats both ends of a range as inside it", () => {
    expect(isWithin("2026-08-01", AUGUST)).toBe(true);
    expect(isWithin("2026-08-31", AUGUST)).toBe(true);
    expect(isWithin("2026-07-31", AUGUST)).toBe(false);
    expect(isWithin("2026-09-01", AUGUST)).toBe(false);
  });
});

describe("buckets", () => {
  it("picks a grain from the length of the range", () => {
    expect(bucketFor({ from: "2026-08-01", to: "2026-08-31" })).toBe("day");
    expect(bucketFor({ from: "2026-06-01", to: "2026-08-31" })).toBe("week");
    expect(bucketFor({ from: "2026-01-01", to: "2026-12-31" })).toBe("month");
  });

  /** The calendar renders Monday-first; bucketing must agree or a Sunday lands in a different week. */
  it("starts a week on Monday", () => {
    expect(startOfWeek("2026-08-21")).toBe("2026-08-17");
    expect(startOfWeek("2026-08-17")).toBe("2026-08-17");
    // A Sunday belongs to the week that began six days earlier.
    expect(startOfWeek("2026-08-23")).toBe("2026-08-17");
  });

  it("buckets a date to its day, week or month", () => {
    expect(bucketKeyOf("2026-08-21", "day")).toBe("2026-08-21");
    expect(bucketKeyOf("2026-08-21", "week")).toBe("2026-08-17");
    expect(bucketKeyOf("2026-08-21", "month")).toBe("2026-08-01");
  });

  /** Empty buckets stay: a quiet night is data, and closing the gap draws a lie. */
  it("includes every bucket in the range, not only the busy ones", () => {
    expect(bucketsIn({ from: "2026-08-01", to: "2026-08-05" }, "day")).toHaveLength(5);
    expect(bucketsIn({ from: "2026-01-01", to: "2026-12-31" }, "month")).toHaveLength(12);
  });

  it("labels a bucket by its grain", () => {
    expect(formatBucket("2026-08-21", "day")).toMatch(/21 Aug/);
    expect(formatBucket("2026-08-17", "week")).toMatch(/^w\/c/);
    expect(formatBucket("2026-08-01", "month")).toMatch(/Aug 2026/);
  });
});

describe("totals", () => {
  it("counts covers from confirmed bookings only", () => {
    const totals = buildTotals(
      [booking({ guestCount: 2 }), booking({ reservationNumber: "B", guestCount: 4 }), booking({ reservationNumber: "C", guestCount: 6, status: "cancelled" })],
      [evening("2026-08-10")],
    );

    expect(totals.covers).toBe(6);
    expect(totals.bookings).toBe(2);
    expect(totals.cancelled).toBe(1);
  });

  it("works out occupancy against seats actually offered", () => {
    const totals = buildTotals([booking({ guestCount: 10 })], [evening("2026-08-10", { capacity: 40 })]);
    expect(totals.occupancy).toBe(25);
  });

  /**
   * A closed evening offered nothing. Counting its capacity would make every
   * quiet week look emptier than it was.
   */
  it("leaves a closed evening out of the denominator", () => {
    const totals = buildTotals(
      [booking({ guestCount: 20 })],
      [evening("2026-08-10", { capacity: 40 }), evening("2026-08-11", { capacity: 40, isOpen: false })],
    );

    expect(totals.seatsOffered).toBe(40);
    expect(totals.eveningsOpen).toBe(1);
    expect(totals.occupancy).toBe(50);
  });

  /** Nothing open is not "0% full" — it is a question with no answer. */
  it("reports occupancy as null rather than zero when nothing was open", () => {
    expect(buildTotals([], []).occupancy).toBeNull();
    expect(buildTotals([], []).cancellationRate).toBeNull();
    expect(buildTotals([], []).averageParty).toBeNull();
  });

  it("rates cancellations against every booking taken, not only the live ones", () => {
    const totals = buildTotals(
      [booking(), booking({ reservationNumber: "B" }), booking({ reservationNumber: "C", status: "cancelled" })],
      [evening("2026-08-10")],
    );

    // One cancelled out of three taken.
    expect(totals.cancellationRate).toBe(33.3);
  });

  it("adds up promotion revenue and what was given away", () => {
    const wine = { courseId: "p1", courseName: "Wines", optionId: "w1", optionName: "Chardonnay", price: 40, discountPercent: 25, finalPrice: 30 };
    const totals = buildTotals([booking({ addOns: [wine] })], [evening("2026-08-10")]);

    expect(totals.promotionRevenue).toBe(30);
    expect(totals.promotionDiscount).toBe(10);
    expect(totals.promotionTakeUp).toBe(100);
  });

  /** The median, not the mean: somebody always books three months out. */
  it("uses the median for lead time", () => {
    const sitting = () => new Date(2026, 7, 10, 19);
    const totals = buildTotals(
      [
        booking({ createdAt: new Date(2026, 7, 10, 17).toISOString() }),
        booking({ reservationNumber: "B", createdAt: new Date(2026, 7, 9, 19).toISOString() }),
        booking({ reservationNumber: "C", createdAt: new Date(2026, 4, 1, 19).toISOString() }),
      ],
      [evening("2026-08-10")],
      sitting,
    );

    // 2h, 24h, ~2400h — the median is 24, the mean would be far higher.
    expect(totals.medianLeadHours).toBe(24);
  });

  /** Unknown is not "booked at the last moment". */
  it("leaves a booking with no timestamp out of lead time", () => {
    const sitting = () => new Date(2026, 7, 10, 19);
    const totals = buildTotals([booking({ createdAt: undefined })], [evening("2026-08-10")], sitting);

    expect(totals.medianLeadHours).toBeNull();
  });
});

describe("trends", () => {
  it("puts covers in their buckets and keeps the empty ones", () => {
    const trend = coversTrend(
      [booking({ date: "2026-08-01", guestCount: 2 }), booking({ reservationNumber: "B", date: "2026-08-03", guestCount: 4 })],
      { from: "2026-08-01", to: "2026-08-04" },
      "day",
    );

    expect(trend).toEqual([
      { key: "2026-08-01", value: 2 },
      { key: "2026-08-02", value: 0 },
      { key: "2026-08-03", value: 4 },
      { key: "2026-08-04", value: 0 },
    ]);
  });

  it("leaves a cancelled booking out of the trend", () => {
    const trend = coversTrend([booking({ date: "2026-08-01", guestCount: 6, status: "cancelled" })], { from: "2026-08-01", to: "2026-08-01" }, "day");
    expect(trend[0].value).toBe(0);
  });

  it("tracks capacity on the same buckets, so both share one axis", () => {
    const range = { from: "2026-08-01", to: "2026-08-02" };
    const covers = coversTrend([booking({ date: "2026-08-01", guestCount: 5 })], range, "day");
    const capacity = capacityTrend([evening("2026-08-01"), evening("2026-08-02", { isOpen: false })], range, "day");

    expect(covers.map((p) => p.key)).toEqual(capacity.map((p) => p.key));
    expect(capacity).toEqual([
      { key: "2026-08-01", value: 40 },
      { key: "2026-08-02", value: 0 },
    ]);
  });
});

describe("dishes", () => {
  const menu: MenuCourse[] = [
    {
      id: "c1",
      order: 1,
      name: "Starter",
      description: "",
      required: true,
      active: true,
      options: [
        { id: "o1", courseId: "c1", name: "Salmon", description: "", allergens: [], active: true },
        { id: "o2", courseId: "c1", name: "Velouté", description: "", allergens: [], active: true },
      ],
    },
  ];

  function pick(courseId: string, courseName: string, optionId: string, optionName: string) {
    return { guestIndex: 0, courseId, courseName, optionId, optionName };
  }

  it("counts each dish by id", () => {
    const { dishes } = dishPopularity(
      [
        booking({ selections: [pick("c1", "Starter", "o1", "Salmon")] }),
        booking({ reservationNumber: "B", selections: [pick("c1", "Starter", "o1", "Salmon")] }),
        booking({ reservationNumber: "C", selections: [pick("c1", "Starter", "o2", "Velouté")] }),
      ],
      menu,
    );

    expect(dishes.map((d) => [d.optionName, d.count])).toEqual([
      ["Salmon", 2],
      ["Velouté", 1],
    ]);
  });

  /** Grouping on the stored name would split one dish in two the day it is renamed. */
  it("groups by id even when the stored name is stale", () => {
    const { dishes } = dishPopularity(
      [
        booking({ selections: [pick("c1", "Starter", "o1", "Old name")] }),
        booking({ reservationNumber: "B", selections: [pick("c1", "Starter", "o1", "Salmon")] }),
      ],
      menu,
    );

    expect(dishes).toHaveLength(1);
    // And it displays the catalogue's current name, not the stale one.
    expect(dishes[0].optionName).toBe("Salmon");
  });

  it("keeps the recorded name for a dish no longer on the menu", () => {
    const { dishes } = dishPopularity(
      [booking({ selections: [pick("c9", "Retired", "o9", "Retired lamb dish")] })],
      menu,
    );

    expect(dishes[0].optionName).toBe("Retired lamb dish");
  });

  /** A decline is a real selection but never a plate. */
  it("counts declines apart from dishes", () => {
    const { dishes, declines } = dishPopularity(
      [booking({ selections: [pick("c1", "Starter", NONE_OPTION_ID, NONE_OPTION_NAME)] })],
      menu,
    );

    expect(dishes).toHaveLength(0);
    expect(declines).toEqual([{ courseId: "c1", courseName: "Starter", count: 1 }]);
  });

  it("ignores a cancelled booking's choices", () => {
    const { dishes } = dishPopularity(
      [booking({ status: "cancelled", selections: [pick("c1", "Starter", "o1", "Salmon")] })],
      menu,
    );

    expect(dishes).toHaveLength(0);
  });
});

describe("promotions", () => {
  const wine = { courseId: "p1", courseName: "Wines", optionId: "w1", optionName: "Chardonnay", price: 40, discountPercent: 25, finalPrice: 30 };
  const fondant = { courseId: "p2", courseName: "Sweet", optionId: "d1", optionName: "Fondant", price: 12, discountPercent: 0, finalPrice: 12 };

  it("adds up each product's sales and revenue", () => {
    const lines = promotionLines([
      booking({ addOns: [wine] }),
      booking({ reservationNumber: "B", addOns: [wine, fondant] }),
    ]);

    expect(lines.map((l) => [l.optionName, l.count, l.revenue])).toEqual([
      ["Chardonnay", 2, 60],
      ["Fondant", 1, 12],
    ]);
  });

  it("records what each discount gave away", () => {
    expect(promotionLines([booking({ addOns: [wine] })])[0].discount).toBe(10);
  });

  it("ignores a cancelled booking's promotions", () => {
    expect(promotionLines([booking({ status: "cancelled", addOns: [wine] })])).toEqual([]);
  });
});

describe("party sizes", () => {
  it("counts bookings per party size, smallest first", () => {
    expect(
      partySizes([
        booking({ guestCount: 2 }),
        booking({ reservationNumber: "B", guestCount: 4 }),
        booking({ reservationNumber: "C", guestCount: 2 }),
      ]),
    ).toEqual([
      { guests: 2, bookings: 2 },
      { guests: 4, bookings: 1 },
    ]);
  });
});

describe("cancellations", () => {
  it("lists them newest first, with how much notice was given", () => {
    const sitting = () => new Date(2026, 7, 10, 19);
    const lines = cancellationLines(
      [
        booking({
          status: "cancelled",
          cancellation: { at: new Date(2026, 7, 10, 17).toISOString(), actorKind: "guest", actorName: "Room 402" },
        }),
      ],
      sitting,
    );

    expect(lines).toHaveLength(1);
    expect(lines[0].noticeHours).toBe(2);
  });

  it("leaves out a cancellation with no record of itself", () => {
    expect(cancellationLines([booking({ status: "cancelled" })])).toEqual([]);
  });
});

describe("the pass-key funnel", () => {
  it("counts one cohort: keys issued in the range", () => {
    const stages = passKeyFunnel(
      [
        { issuedAt: "2026-08-05T09:00:00.000Z", usedCount: 1, reservationNumbers: ["A"] },
        { issuedAt: "2026-08-06T09:00:00.000Z", usedCount: 2, reservationNumbers: ["B", "C"] },
        { issuedAt: "2026-08-07T09:00:00.000Z", usedCount: 0, reservationNumbers: [] },
        // Issued before the range: a different cohort, excluded.
        { issuedAt: "2026-07-01T09:00:00.000Z", usedCount: 1, reservationNumbers: ["D"] },
      ],
      AUGUST,
    );

    expect(stages.map((s) => [s.label, s.value])).toEqual([
      ["Keys issued", 3],
      ["Keys used", 2],
      ["Dinners booked", 3],
    ]);
  });

  it("copes with a key that has never been issued a timestamp", () => {
    expect(passKeyFunnel([{ usedCount: 1 }], AUGUST)[0].value).toBe(0);
  });
});

/**
 * No-shows.
 *
 * The rule the whole design turns on: **silence is not attendance.** On a busy
 * night nobody taps, and a system that read an unmarked booking either way
 * would invent the answer. See `docs/service-tracking.md` §7.
 */
describe("attendance", () => {
  const seated = { status: "seated" as const, at: "2026-08-10T17:00:00.000Z", byName: "Ivan" };
  const noShow = { status: "no-show" as const, at: "2026-08-10T19:30:00.000Z", byName: "Ivan" };

  it("counts nothing when nobody marked anything", () => {
    const totals = buildTotals([booking(), booking({ reservationNumber: "B" })], [evening("2026-08-10")]);

    expect(totals.attendanceRecorded).toBe(0);
    expect(totals.seated).toBe(0);
    expect(totals.noShows).toBe(0);
  });

  /** The one that matters: an unmarked night must not report "no no-shows". */
  it("reports the rate as null, not zero, when nothing was recorded", () => {
    const totals = buildTotals([booking()], [evening("2026-08-10")]);

    expect(totals.noShowRate).toBeNull();
    expect(totals.attendanceCoverage).toBe(0);
  });

  it("rates no-shows against the recorded bookings, not every booking", () => {
    const totals = buildTotals(
      [
        booking({ attendance: seated }),
        booking({ reservationNumber: "B", attendance: noShow }),
        // Unmarked: in neither the numerator nor the denominator.
        booking({ reservationNumber: "C" }),
        booking({ reservationNumber: "D" }),
      ],
      [evening("2026-08-10")],
    );

    expect(totals.attendanceRecorded).toBe(2);
    expect(totals.noShows).toBe(1);
    // One of the two recorded, not one of the four booked.
    expect(totals.noShowRate).toBe(50);
    expect(totals.attendanceCoverage).toBe(50);
  });

  it("counts the guests who actually sat down", () => {
    const totals = buildTotals(
      [
        // A booking for four where three came.
        booking({ guestCount: 4, attendance: { ...seated, guests: 3 } }),
        // One that did not say counts the whole party.
        booking({ reservationNumber: "B", guestCount: 2, attendance: seated }),
      ],
      [evening("2026-08-10")],
    );

    expect(totals.covers).toBe(6);
    expect(totals.seatedCovers).toBe(5);
  });

  it("leaves a no-show out of the seated covers", () => {
    const totals = buildTotals(
      [booking({ guestCount: 4, attendance: noShow })],
      [evening("2026-08-10")],
    );

    expect(totals.seatedCovers).toBe(0);
    // But the booking still counts as a cover booked — that is the point of
    // the pair: booked and served diverging is the interesting number.
    expect(totals.covers).toBe(4);
  });

  it("ignores a cancelled booking's attendance entirely", () => {
    const totals = buildTotals(
      [booking({ status: "cancelled", attendance: noShow })],
      [evening("2026-08-10")],
    );

    expect(totals.attendanceRecorded).toBe(0);
    expect(totals.noShows).toBe(0);
  });
});
