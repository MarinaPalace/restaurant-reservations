import { NONE_OPTION_ID } from "@/lib/menu-selection";
import { sumFinalPrices, sumListPrices, toCents } from "@/lib/money";
import { leadTimeHours } from "@/lib/reservation-order";
import {
  bucketFor,
  bucketKeyOf,
  bucketsIn,
  formatBucket,
  isWithin,
  type Bucket,
  type DateRange,
} from "@/lib/analytics/range";
import type { MenuCourse, ReservationRecord, RestaurantDateAvailability } from "@/types/booking";

/**
 * What the numbers on the analytics page mean.
 *
 * Pure functions over arrays, the same shape as `lib/kitchen-report.ts`, and
 * deliberately free of Mongoose or the filesystem — the service layer fetches,
 * this decides what the data says.
 *
 * ## Aggregate on read
 *
 * One restaurant at ~40 covers a night is on the order of 15,000 reservations a
 * decade. Folding that in memory is far cheaper than keeping a rollup table
 * honest, and unlike a rollup it cannot drift from the source or go stale when
 * a booking is cancelled, restored or edited afterwards.
 *
 * ## Two rules that decide several answers below
 *
 * - **Cancelled bookings are loaded, never filtered at the source.** The
 *   cancellation rate is one of the questions; a query that drops them makes it
 *   unanswerable. Every function here decides for itself whether to count them.
 * - **Unknown is not zero.** A booking with no `createdAt` has no lead time; a
 *   day with no date row was never opened rather than opened with no seats.
 *   Counting either as zero drags an average toward a number nobody chose.
 */

export type Trend = { key: string; value: number };

export type Totals = {
  /** Guests on confirmed bookings. The headline number. */
  covers: number;
  bookings: number;
  cancelled: number;
  /** Seats offered on evenings that were actually open. The occupancy denominator. */
  seatsOffered: number;
  eveningsOpen: number;
  /** 0–100, or null when nothing was open — which is not the same as 0% full. */
  occupancy: number | null;
  /** 0–100 of all bookings taken, or null when there were none. */
  cancellationRate: number | null;
  averageParty: number | null;
  /** Median hours between a booking being taken and its sitting. */
  medianLeadHours: number | null;
  promotionRevenue: number;
  promotionDiscount: number;
  /** 0–100 of confirmed bookings that took at least one promotion. */
  promotionTakeUp: number | null;

  /* ---- attendance. See `docs/service-tracking.md` §7. ---- */

  /** Confirmed bookings whose attendance was actually recorded, either way. */
  attendanceRecorded: number;
  /** Bookings marked seated. */
  seated: number;
  /** Bookings marked as not turning up. */
  noShows: number;
  /**
   * Guests who actually sat down, on bookings where somebody said.
   *
   * Not comparable with `covers` — that counts every confirmed booking,
   * recorded or not. The pair is only meaningful beside `attendanceCoverage`.
   */
  seatedCovers: number;
  /**
   * 0–100 of confirmed bookings that carry any attendance mark.
   *
   * **The number that stops the no-show rate being quoted.** A rate computed
   * over a night nobody marked is a confident figure about nothing, so every
   * screen showing `noShowRate` must show this beside it.
   */
  attendanceCoverage: number | null;
  /**
   * 0–100 of *recorded* bookings that did not turn up, or null when nothing was
   * recorded.
   *
   * The denominator is deliberately the recorded ones, not every booking.
   * Dividing by all of them would quietly report a night nobody marked as
   * having no no-shows, which is the exact failure this design exists to
   * prevent — silence is not attendance.
   */
  noShowRate: number | null;
};

function isConfirmed(reservation: ReservationRecord): boolean {
  return reservation.status === "confirmed";
}

/** Bookings whose *dinner* falls in the range — not those taken in it. */
export function reservationsIn(reservations: readonly ReservationRecord[], range: DateRange): ReservationRecord[] {
  return reservations.filter((reservation) => isWithin(reservation.date, range));
}

export function datesIn(
  dates: readonly RestaurantDateAvailability[],
  range: DateRange,
): RestaurantDateAvailability[] {
  return dates.filter((date) => isWithin(date.date, range));
}

/**
 * The middle value, not the mean.
 *
 * Lead time has a long tail — somebody always books three months out — and a
 * mean would report a typical guest booking far earlier than any of them do.
 */
function median(values: number[]): number | null {
  if (values.length === 0) {
    return null;
  }

  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);

  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

function percent(part: number, whole: number): number | null {
  return whole > 0 ? Math.round((part / whole) * 1000) / 10 : null;
}

export function buildTotals(
  reservations: readonly ReservationRecord[],
  dates: readonly RestaurantDateAvailability[],
  /** Resolves a booking's sitting to an instant, for lead time. Absent = skip it. */
  sittingOf?: (reservation: ReservationRecord) => Date | null,
): Totals {
  const confirmed = reservations.filter(isConfirmed);
  const cancelled = reservations.filter((reservation) => reservation.status === "cancelled");

  /**
   * Only evenings that were **open**. A day with no row was never offered, and
   * a closed one offered nothing; averaging either into occupancy answers a
   * question nobody asked.
   */
  const open = dates.filter((date) => date.isOpen);
  const seatsOffered = open.reduce((sum, date) => sum + Math.max(0, date.capacity), 0);
  const covers = confirmed.reduce((sum, reservation) => sum + Math.max(0, reservation.guestCount), 0);

  const promotions = confirmed.flatMap((reservation) => reservation.addOns ?? []);
  const withPromotions = confirmed.filter((reservation) => (reservation.addOns?.length ?? 0) > 0);

  const leadTimes = sittingOf
    ? confirmed
        .map((reservation) => leadTimeHours(reservation.createdAt, sittingOf(reservation)))
        .filter((hours): hours is number => hours !== null)
    : [];

  /**
   * Only bookings somebody actually marked. Absent attendance is **unknown**,
   * never "seated" and never "no-show" — on a busy night nobody taps, and
   * reading silence either way would invent the answer.
   */
  const recorded = confirmed.filter((reservation) => reservation.attendance);
  const seated = recorded.filter((reservation) => reservation.attendance?.status === "seated");
  const noShows = recorded.filter((reservation) => reservation.attendance?.status === "no-show");

  return {
    covers,
    bookings: confirmed.length,
    cancelled: cancelled.length,
    seatsOffered,
    eveningsOpen: open.length,
    occupancy: percent(covers, seatsOffered),
    cancellationRate: percent(cancelled.length, confirmed.length + cancelled.length),
    averageParty: confirmed.length > 0 ? Math.round((covers / confirmed.length) * 10) / 10 : null,
    medianLeadHours: median(leadTimes),
    promotionRevenue: sumFinalPrices(promotions),
    promotionDiscount: toCents(sumListPrices(promotions) - sumFinalPrices(promotions)),
    promotionTakeUp: percent(withPromotions.length, confirmed.length),

    attendanceRecorded: recorded.length,
    seated: seated.length,
    noShows: noShows.length,
    seatedCovers: seated.reduce(
      // A booking for four where three came records three; one that did not say
      // counts the whole party, which is what "seated" means without a number.
      (sum, reservation) => sum + (reservation.attendance?.guests ?? Math.max(0, reservation.guestCount)),
      0,
    ),
    attendanceCoverage: percent(recorded.length, confirmed.length),
    noShowRate: percent(noShows.length, recorded.length),
  };
}

/**
 * Covers per bucket, including the empty ones.
 *
 * The empty buckets are deliberate: a quiet Tuesday is data, and closing the
 * gap would draw a restaurant that never had a quiet night.
 */
export function coversTrend(
  reservations: readonly ReservationRecord[],
  range: DateRange,
  bucket: Bucket = bucketFor(range),
): Trend[] {
  const totals = new Map<string, number>();
  for (const key of bucketsIn(range, bucket)) {
    totals.set(key, 0);
  }

  for (const reservation of reservations) {
    if (!isConfirmed(reservation) || !isWithin(reservation.date, range)) {
      continue;
    }

    const key = bucketKeyOf(reservation.date, bucket);
    totals.set(key, (totals.get(key) ?? 0) + Math.max(0, reservation.guestCount));
  }

  return [...totals].map(([key, value]) => ({ key, value }));
}

/** Seats offered per bucket, so the covers chart can carry a capacity line on the same axis. */
export function capacityTrend(
  dates: readonly RestaurantDateAvailability[],
  range: DateRange,
  bucket: Bucket = bucketFor(range),
): Trend[] {
  const totals = new Map<string, number>();
  for (const key of bucketsIn(range, bucket)) {
    totals.set(key, 0);
  }

  for (const date of dates) {
    if (!date.isOpen || !isWithin(date.date, range)) {
      continue;
    }

    const key = bucketKeyOf(date.date, bucket);
    totals.set(key, (totals.get(key) ?? 0) + Math.max(0, date.capacity));
  }

  return [...totals].map(([key, value]) => ({ key, value }));
}

export type Popularity = {
  courseId: string;
  courseName: string;
  optionId: string;
  optionName: string;
  count: number;
};

/**
 * How often each dish was chosen, resolved by id against the master catalogue.
 *
 * By id because a booking taken in Bulgarian stores canonical English but the
 * menu may have been renamed since; grouping on the stored name would split one
 * dish into two rows the day somebody fixes a typo (rule 2.6).
 *
 * Declines are counted separately rather than as a dish — `NONE_OPTION_ID` is a
 * real selection, and "eleven guests wanted no starter" is a fact the kitchen
 * wants, but it is not a plate.
 */
export function dishPopularity(
  reservations: readonly ReservationRecord[],
  menu: readonly MenuCourse[],
): { dishes: Popularity[]; declines: { courseId: string; courseName: string; count: number }[] } {
  const names = new Map<string, { courseName: string; optionName: string; courseId: string }>();
  const courseNames = new Map<string, string>();
  const courseOrder = new Map<string, number>();

  for (const course of menu) {
    courseNames.set(course.id, course.name);
    courseOrder.set(course.id, course.order);
    for (const option of course.options) {
      names.set(option.id, { courseId: course.id, courseName: course.name, optionName: option.name });
    }
  }

  const counts = new Map<string, Popularity>();
  const declines = new Map<string, { courseId: string; courseName: string; count: number }>();

  for (const reservation of reservations) {
    if (!isConfirmed(reservation)) {
      continue;
    }

    for (const selection of reservation.selections) {
      if (selection.optionId === NONE_OPTION_ID) {
        const courseName = courseNames.get(selection.courseId) ?? selection.courseName;
        const existing = declines.get(selection.courseId);
        if (existing) {
          existing.count += 1;
        } else {
          declines.set(selection.courseId, { courseId: selection.courseId, courseName, count: 1 });
        }
        continue;
      }

      const existing = counts.get(selection.optionId);
      if (existing) {
        existing.count += 1;
        continue;
      }

      // A dish withdrawn since keeps the name the booking recorded, so a
      // retired lamb dish still reads as itself rather than as an id.
      const resolved = names.get(selection.optionId);
      counts.set(selection.optionId, {
        courseId: resolved?.courseId ?? selection.courseId,
        courseName: resolved?.courseName ?? selection.courseName,
        optionId: selection.optionId,
        optionName: resolved?.optionName ?? selection.optionName,
        count: 1,
      });
    }
  }

  const dishes = [...counts.values()].sort(
    (a, b) =>
      (courseOrder.get(a.courseId) ?? 99) - (courseOrder.get(b.courseId) ?? 99) ||
      b.count - a.count ||
      a.optionName.localeCompare(b.optionName),
  );

  return { dishes, declines: [...declines.values()].sort((a, b) => b.count - a.count) };
}

export type PromotionLine = {
  optionId: string;
  optionName: string;
  courseName: string;
  count: number;
  revenue: number;
  discount: number;
};

/** Which promotions sold, and what they earned. Prices are the booking's, not today's. */
export function promotionLines(reservations: readonly ReservationRecord[]): PromotionLine[] {
  const lines = new Map<string, PromotionLine>();

  for (const reservation of reservations) {
    if (!isConfirmed(reservation)) {
      continue;
    }

    for (const addOn of reservation.addOns ?? []) {
      const existing = lines.get(addOn.optionId);
      if (existing) {
        existing.count += 1;
        existing.revenue = toCents(existing.revenue + addOn.finalPrice);
        existing.discount = toCents(existing.discount + (addOn.price - addOn.finalPrice));
        continue;
      }

      lines.set(addOn.optionId, {
        optionId: addOn.optionId,
        optionName: addOn.optionName,
        courseName: addOn.courseName,
        count: 1,
        revenue: toCents(addOn.finalPrice),
        discount: toCents(addOn.price - addOn.finalPrice),
      });
    }
  }

  return [...lines.values()].sort((a, b) => b.revenue - a.revenue || a.optionName.localeCompare(b.optionName));
}

export type PartySize = { guests: number; bookings: number };

export function partySizes(reservations: readonly ReservationRecord[]): PartySize[] {
  const counts = new Map<number, number>();

  for (const reservation of reservations) {
    if (!isConfirmed(reservation)) {
      continue;
    }
    const guests = Math.max(1, reservation.guestCount);
    counts.set(guests, (counts.get(guests) ?? 0) + 1);
  }

  return [...counts]
    .map(([guests, bookings]) => ({ guests, bookings }))
    .sort((a, b) => a.guests - b.guests);
}

export type CancellationLine = {
  reservationNumber: string;
  room: string;
  date: string;
  at: string;
  actorName: string;
  reason?: string;
  /** Hours before the sitting. Negative means after it had started. */
  noticeHours: number | null;
};

/**
 * Cancellations, most recent first, with how much notice each gave.
 *
 * Notice is the number that matters: ten cancellations a month is fine if they
 * come a week out and expensive if they come at six o'clock.
 */
export function cancellationLines(
  reservations: readonly ReservationRecord[],
  sittingOf?: (reservation: ReservationRecord) => Date | null,
): CancellationLine[] {
  return reservations
    .filter((reservation) => reservation.status === "cancelled" && reservation.cancellation)
    .map((reservation) => {
      const cancellation = reservation.cancellation!;
      return {
        reservationNumber: reservation.reservationNumber,
        room: reservation.roomNumber,
        date: reservation.date,
        at: cancellation.at,
        actorName: cancellation.actorName,
        reason: cancellation.reason,
        noticeHours: sittingOf ? leadTimeHours(cancellation.at, sittingOf(reservation)) : null,
      };
    })
    .sort((a, b) => b.at.localeCompare(a.at));
}

export type FunnelStage = { label: string; value: number; hint: string };

/**
 * Pass-keys: issued → used at least once → dinners actually booked.
 *
 * The most actionable number on the page and the least obvious. A key issued
 * and never spent is a guest who was offered dinner and did not take it, and
 * until now nobody knew how many of those there were.
 *
 * Counted over keys **issued** in the range, so the three stages describe one
 * cohort. Counting dinners by their own date instead would mix a key issued in
 * March with a dinner booked in April and make the funnel say nothing.
 */
export function passKeyFunnel(
  keys: readonly { issuedAt?: string; usedCount?: number; reservationNumbers?: string[] }[],
  range: DateRange,
): FunnelStage[] {
  const issued = keys.filter((key) => key.issuedAt && isWithin(key.issuedAt.slice(0, 10), range));
  const used = issued.filter((key) => (key.usedCount ?? 0) > 0);
  const dinners = issued.reduce((sum, key) => sum + (key.reservationNumbers?.length ?? 0), 0);

  return [
    { label: "Keys issued", value: issued.length, hint: "Guests offered dinner" },
    { label: "Keys used", value: used.length, hint: "Booked at least once" },
    { label: "Dinners booked", value: dinners, hint: "Tables actually taken" },
  ];
}

/* ------------------------------------------------------------------ *
 * Coefficients: what the system does that staff would otherwise do
 * ------------------------------------------------------------------ */

/**
 * A ratio, with the two numbers it came out of.
 *
 * The counts are not decoration. "68%" over four bookings and "68%" over four
 * hundred are different facts, and a screen showing only the percentage cannot
 * tell them apart — the same argument `attendanceCoverage` already makes for
 * never quoting a no-show rate on its own.
 */
export type Coefficient = {
  key: string;
  label: string;
  /** The ratio, or **null when there is nothing to divide by** — never 0. */
  value: number | null;
  /** How to read `value`: a percentage, a multiple, a rate, or hours. */
  unit: "percent" | "ratio" | "per-key" | "hours";
  part: number;
  whole: number;
  /** What the two numbers are, for the line under the figure. */
  partLabel: string;
  wholeLabel: string;
  hint: string;
};

export type KeyCohort = {
  /** Keys issued inside the range. Everything below is a slice of these. */
  issued: number;
  /** Spent at least once. */
  used: number;
  /** Expired without ever being spent — the guest was offered dinner and let it lapse. */
  wastedExpired: number;
  /**
   * Never spent, and their stay has not ended yet.
   *
   * **Excluded from the waste denominator**, and this is the whole reason this
   * field exists. A key issued yesterday with a week to run has not been
   * wasted; counting it as one would make waste look worst on the most recent
   * range and best on the oldest, which is an artefact of the calendar rather
   * than anything about the restaurant.
   */
  stillOpen: number;
  /** Withdrawn by staff. Neither used nor wasted; somebody decided. */
  revoked: number;
  /** Dinners booked by the cohort, however many each key was worth. */
  dinners: number;
};

/**
 * Pass-keys issued in the range, sorted into what became of them.
 *
 * Counted over keys **issued** in the range rather than dinners eaten in it, so
 * the numbers describe one cohort — the same choice `passKeyFunnel` makes, and
 * for the same reason: a key issued in March against a dinner booked in April
 * is a ratio of two unrelated things.
 */
export function keyCohort(
  keys: readonly {
    issuedAt?: string;
    usedCount?: number;
    expiresOn?: string;
    status?: string;
    reservationNumbers?: string[];
  }[],
  range: DateRange,
  today: string,
): KeyCohort {
  const issued = keys.filter((key) => key.issuedAt && isWithin(key.issuedAt.slice(0, 10), range));
  const unused = issued.filter((key) => (key.usedCount ?? 0) === 0);
  const revoked = unused.filter((key) => key.status === "revoked");
  const live = unused.filter((key) => key.status !== "revoked");

  return {
    issued: issued.length,
    used: issued.filter((key) => (key.usedCount ?? 0) > 0).length,
    // A key with no expiry never lapses, so it is never waste — it is still
    // open, indefinitely, which is what "no expiry" means.
    wastedExpired: live.filter((key) => key.expiresOn !== undefined && key.expiresOn < today).length,
    stillOpen: live.filter((key) => key.expiresOn === undefined || key.expiresOn >= today).length,
    revoked: revoked.length,
    dinners: issued.reduce((sum, key) => sum + (key.reservationNumbers?.length ?? 0), 0),
  };
}

/** How long a booking taken by hand is assumed to occupy somebody. */
export const DEFAULT_MINUTES_PER_MANUAL_BOOKING = 6;

/**
 * How much of the work the system is actually taking off the desk.
 *
 * Every one of these is a ratio between something that happened by itself and
 * something a member of staff would otherwise have done. They answer one
 * question — *is this thing earning its keep?* — which no single count on this
 * page does.
 *
 * Two rules from the top of this module decide the arithmetic:
 *
 * - **Unknown is not zero.** A range with no bookings has no self-service rate;
 *   a cohort of keys that has not expired yet has no waste rate. Both come back
 *   null and the screen says so, rather than reporting a confident 0%.
 * - **Cancelled bookings count as bookings.** Somebody was booked in, and the
 *   work of taking that booking happened whether or not they later cancelled.
 *   Filtering them out would flatter the guest side, because a guest who books
 *   and cancels online has saved reception *two* jobs, not none.
 */
export function coefficients(
  reservations: readonly ReservationRecord[],
  keys: readonly {
    issuedAt?: string;
    usedCount?: number;
    expiresOn?: string;
    status?: string;
    reservationNumbers?: string[];
  }[],
  range: DateRange,
  options: { today: string; minutesPerManualBooking?: number },
): { coefficients: Coefficient[]; cohort: KeyCohort } {
  const cohort = keyCohort(keys, range, options.today);
  const minutes = Math.max(0, options.minutesPerManualBooking ?? DEFAULT_MINUTES_PER_MANUAL_BOOKING);

  /**
   * A booking a guest made for themselves carries the key it was made with.
   * One taken at the desk or over the telephone does not — which makes this the
   * one field that already separates the two, with nothing new to record.
   */
  const byGuest = reservations.filter((reservation) => Boolean(reservation.passKeyId));
  const byStaff = reservations.filter((reservation) => !reservation.passKeyId);

  const cancellations = reservations.filter((reservation) => reservation.cancellation);
  const cancelledByGuest = cancellations.filter((reservation) => reservation.cancellation?.actorKind === "guest");

  /** Keys whose story has finished: spent, or lapsed. */
  const settled = cohort.used + cohort.wastedExpired;

  /**
   * One guest action is one interaction reception did not have — a booking
   * taken, or a cancellation processed. Deliberately not covers or seats: the
   * work is per conversation, not per person at the table.
   */
  const savedActions = byGuest.length + cancelledByGuest.length;

  const list: Coefficient[] = [
    {
      key: "self-service",
      label: "Booked by guests",
      value: percent(byGuest.length, reservations.length),
      unit: "percent",
      part: byGuest.length,
      whole: reservations.length,
      partLabel: "with a pass-key",
      wholeLabel: "bookings taken",
      hint: "The share of the evening's bookings that nobody at the desk had to type in.",
    },
    {
      key: "guest-per-staff",
      label: "Guest bookings per staff booking",
      // A ratio, not a percentage: "three guests book themselves in for every
      // one reception takes" is the sentence a manager actually says.
      value: byStaff.length > 0 ? Math.round((byGuest.length / byStaff.length) * 100) / 100 : null,
      unit: "ratio",
      part: byGuest.length,
      whole: byStaff.length,
      partLabel: "by guests",
      wholeLabel: "by staff",
      hint: "How many bookings arrive on their own for each one taken by hand. Null when staff took none.",
    },
    {
      key: "key-waste",
      label: "Keys that lapsed unused",
      value: percent(cohort.wastedExpired, settled),
      unit: "percent",
      part: cohort.wastedExpired,
      whole: settled,
      partLabel: "expired with no booking",
      wholeLabel: "keys whose stay has ended",
      hint:
        `Of the keys issued in this period that are now settled. ` +
        `${cohort.stillOpen} more ${cohort.stillOpen === 1 ? "is" : "are"} still open and not counted either way — ` +
        "a key with time left on it has not been wasted yet.",
    },
    {
      key: "dinners-per-key",
      label: "Dinners per key issued",
      value:
        cohort.issued > 0 ? Math.round((cohort.dinners / cohort.issued) * 100) / 100 : null,
      unit: "per-key",
      part: cohort.dinners,
      whole: cohort.issued,
      partLabel: "dinners booked",
      wholeLabel: "keys issued",
      hint: "What a key is worth on average. A multi-use key can be worth more than one.",
    },
    {
      key: "guest-cancellations",
      label: "Cancelled by the guest",
      value: percent(cancelledByGuest.length, cancellations.length),
      unit: "percent",
      part: cancelledByGuest.length,
      whole: cancellations.length,
      partLabel: "cancelled themselves",
      wholeLabel: "cancellations",
      hint: "The share of cancellations that did not arrive as a telephone call to the desk.",
    },
    {
      key: "time-saved",
      label: "Desk time not spent",
      /**
       * The one figure on this page that is an **estimate rather than a
       * measurement**, and it is labelled as one everywhere it appears. The
       * count of guest actions is real; the minutes each would have taken is an
       * assumption, and it is the caller's to set.
       */
      value: Math.round((savedActions * minutes) / 6) / 10,
      unit: "hours",
      part: savedActions,
      whole: minutes,
      partLabel: "guest bookings and cancellations",
      wholeLabel: "minutes assumed for each",
      hint: `An estimate, not a measurement: ${savedActions} guest actions at ${minutes} minutes of somebody's time each.`,
    },
  ];

  return { coefficients: list, cohort };
}

/* ------------------------------------------------------------------ *
 * Shape over time, and shape over the week
 * ------------------------------------------------------------------ */

export type WeekdayLine = {
  /** 0 = Monday, the week as a restaurant counts it. */
  weekday: number;
  name: string;
  eveningsOpen: number;
  covers: number;
  seatsOffered: number;
  /** Covers per evening open, or null when it never opened on that day. */
  averageCovers: number | null;
  occupancy: number | null;
};

const WEEKDAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

/**
 * The week's own shape — the pattern a date-ordered chart cannot show.
 *
 * "Covers fell in March" and "Tuesdays are always empty" are different facts
 * with different answers, and only the second one tells anybody which evening
 * to stop opening. A column per day of the month buries it: the same Tuesday
 * appears four times, thirty days apart.
 *
 * **Averaged per evening open, not totalled.** A month with five Saturdays and
 * four Mondays would otherwise report Saturday as busier by arithmetic alone.
 * Rule 2.1 throughout: the weekday comes from the local calendar string, never
 * from a UTC instant.
 */
export function weekdayPattern(
  reservations: readonly ReservationRecord[],
  dates: readonly RestaurantDateAvailability[],
): WeekdayLine[] {
  const lines = WEEKDAY_NAMES.map((name, weekday) => ({
    weekday,
    name,
    eveningsOpen: 0,
    covers: 0,
    seatsOffered: 0,
    averageCovers: null as number | null,
    occupancy: null as number | null,
  }));

  /** Monday-first, from a local date string. `getDay()` counts Sunday as 0. */
  const indexOf = (date: string) => {
    const [year, month, day] = date.split("-").map(Number);
    return (new Date(year, month - 1, day).getDay() + 6) % 7;
  };

  for (const date of dates) {
    if (!date.isOpen) {
      continue;
    }

    const line = lines[indexOf(date.date)];
    line.eveningsOpen += 1;
    line.seatsOffered += Math.max(0, date.capacity);
  }

  const open = new Set(dates.filter((date) => date.isOpen).map((date) => date.date));

  for (const reservation of reservations) {
    // Only evenings that were actually open, so covers and the seats they sat
    // in are counted over the same nights.
    if (isConfirmed(reservation) && open.has(reservation.date)) {
      lines[indexOf(reservation.date)].covers += Math.max(0, reservation.guestCount);
    }
  }

  for (const line of lines) {
    line.averageCovers =
      line.eveningsOpen > 0 ? Math.round((line.covers / line.eveningsOpen) * 10) / 10 : null;
    line.occupancy = percent(line.covers, line.seatsOffered);
  }

  return lines;
}

/**
 * How far ahead people actually book.
 *
 * `docs/analytics.md` §2 says the booking cutoff is currently set from a guess.
 * This is the number that replaces it: if nine in ten bookings arrive more than
 * a day out, a four-hour cutoff costs almost nothing, and if a third arrive on
 * the day it costs a third of the evening.
 *
 * Buckets rather than a mean, because the distribution is the point and has a
 * long tail — somebody always books three months ahead. A booking with no
 * `createdAt` has **no lead time and is not counted**: unknown is not zero, and
 * counting it as "same day" would invent the exact pressure this measures.
 */
export type LeadBucket = { key: string; label: string; bookings: number };

const LEAD_BUCKETS: { key: string; label: string; upToHours: number }[] = [
  { key: "same-day", label: "Same day", upToHours: 24 },
  { key: "1-day", label: "1 day ahead", upToHours: 48 },
  { key: "2-3-days", label: "2–3 days", upToHours: 24 * 4 },
  { key: "4-7-days", label: "4–7 days", upToHours: 24 * 8 },
  { key: "1-2-weeks", label: "1–2 weeks", upToHours: 24 * 15 },
  { key: "2-4-weeks", label: "2–4 weeks", upToHours: 24 * 29 },
  { key: "over-month", label: "A month or more", upToHours: Number.POSITIVE_INFINITY },
];

export function leadTimeBuckets(
  reservations: readonly ReservationRecord[],
  sittingOf: (reservation: ReservationRecord) => Date | null,
): { buckets: LeadBucket[]; counted: number; unknown: number } {
  const buckets = LEAD_BUCKETS.map((bucket) => ({ key: bucket.key, label: bucket.label, bookings: 0 }));
  let counted = 0;
  let unknown = 0;

  for (const reservation of reservations) {
    const hours = leadTimeHours(reservation.createdAt, sittingOf(reservation));

    if (hours === null) {
      unknown += 1;
      continue;
    }

    // Booked after the sitting began is a staff correction, not a lead time.
    const index = LEAD_BUCKETS.findIndex((bucket) => Math.max(0, hours) < bucket.upToHours);
    buckets[index === -1 ? buckets.length - 1 : index].bookings += 1;
    counted += 1;
  }

  return { buckets, counted, unknown };
}

/**
 * Each bucket split into who took the booking.
 *
 * The total is already on the covers chart; this says what it is *made of*. A
 * flat month that quietly moved from reception to self-service is a real change
 * and is invisible in the total.
 *
 * Every booking taken counts, cancelled or not — the work of taking it happened
 * either way, which is the same rule the coefficients follow.
 */
export function sourceTrend(
  reservations: readonly ReservationRecord[],
  range: DateRange,
  bucket: Bucket,
): Array<{ key: string; label: string; parts: number[] }> {
  const byGuest = new Map<string, number>();
  const byStaff = new Map<string, number>();

  for (const reservation of reservations) {
    const key = bucketKeyOf(reservation.date, bucket);
    const target = reservation.passKeyId ? byGuest : byStaff;
    target.set(key, (target.get(key) ?? 0) + 1);
  }

  return bucketsIn(range, bucket).map((key) => ({
    key,
    label: formatBucket(key, bucket),
    parts: [byGuest.get(key) ?? 0, byStaff.get(key) ?? 0],
  }));
}

/**
 * One line per evening, for opening a single date from a chart.
 *
 * Folded on the server beside everything else rather than fetched when a bar is
 * clicked: it is a few dozen rows for a month, the reservations are already in
 * memory, and a second round trip per click would make the chart feel like a
 * page rather than a chart.
 *
 * Only evenings that appear in the calendar. A date with bookings and no row
 * was never opened, which is a data problem rather than an evening to inspect.
 */
export type EveningLine = {
  date: string;
  isOpen: boolean;
  premium: boolean;
  capacity: number;
  covers: number;
  bookings: number;
  cancelled: number;
  occupancy: number | null;
  seated: number;
  noShows: number;
  /** Confirmed bookings carrying any attendance mark. Guards the no-show count. */
  attendanceRecorded: number;
  promotionRevenue: number;
  byGuest: number;
};

export function eveningLines(
  reservations: readonly ReservationRecord[],
  dates: readonly RestaurantDateAvailability[],
): EveningLine[] {
  const byDate = new Map<string, ReservationRecord[]>();

  for (const reservation of reservations) {
    byDate.set(reservation.date, [...(byDate.get(reservation.date) ?? []), reservation]);
  }

  return [...dates]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((date) => {
      const evening = byDate.get(date.date) ?? [];
      const confirmed = evening.filter(isConfirmed);
      const covers = confirmed.reduce((sum, reservation) => sum + Math.max(0, reservation.guestCount), 0);
      const marked = confirmed.filter((reservation) => reservation.attendance);

      return {
        date: date.date,
        isOpen: date.isOpen,
        premium: Boolean(date.premium),
        capacity: Math.max(0, date.capacity),
        covers,
        bookings: evening.length,
        cancelled: evening.filter((reservation) => reservation.status === "cancelled").length,
        occupancy: date.isOpen ? percent(covers, Math.max(0, date.capacity)) : null,
        seated: marked.filter((reservation) => reservation.attendance?.status === "seated").length,
        noShows: marked.filter((reservation) => reservation.attendance?.status === "no-show").length,
        attendanceRecorded: marked.length,
        promotionRevenue: confirmed.reduce(
          (sum, reservation) => sum + sumFinalPrices(reservation.addOns ?? []),
          0,
        ),
        byGuest: evening.filter((reservation) => Boolean(reservation.passKeyId)).length,
      };
    });
}
