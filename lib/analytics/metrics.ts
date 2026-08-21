import { NONE_OPTION_ID } from "@/lib/menu-selection";
import { sumFinalPrices, sumListPrices, toCents } from "@/lib/money";
import { leadTimeHours } from "@/lib/reservation-order";
import { bucketFor, bucketKeyOf, bucketsIn, isWithin, type Bucket, type DateRange } from "@/lib/analytics/range";
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
