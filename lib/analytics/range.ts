import { addMonths, fromDateKey, isValidDateKey, startOfMonth, toDateKey, todayKey } from "@/lib/date";

/**
 * Date ranges and buckets for the analytics page.
 *
 * ## Rule 2.1 lives here
 *
 * Every boundary in this module is a **local calendar date key**, built with
 * `lib/date.ts` and never with `toISOString().slice(0, 10)`. That conversion
 * goes through UTC, and in Europe/Sofia it turns an 18 August dinner into
 * 17 August — which in analytics does not fail loudly, it silently moves
 * covers between weeks and months.
 *
 * ## Weeks start on Monday
 *
 * `buildCalendarGrid` already assumes it and the calendar renders it that way.
 * Bucketing on a different convention would put a Sunday in a different week
 * from the one the dashboard shows it in, and nobody would ever reconcile the
 * two.
 */

export const RANGE_PRESETS = ["this-month", "last-month", "last-90", "this-year"] as const;

export type RangePreset = (typeof RANGE_PRESETS)[number];

export const RANGE_PRESET_LABELS: Record<RangePreset, string> = {
  "this-month": "This month",
  "last-month": "Last month",
  "last-90": "Last 90 days",
  "this-year": "This year",
};

/** Inclusive at both ends, because a range that excludes its last evening reads wrong. */
export type DateRange = {
  from: string;
  to: string;
};

export type Bucket = "day" | "week" | "month";

export function isRangePreset(value: unknown): value is RangePreset {
  return typeof value === "string" && (RANGE_PRESETS as readonly string[]).includes(value);
}

function shiftDays(key: string, days: number): string {
  const date = fromDateKey(key);
  date.setDate(date.getDate() + days);
  return toDateKey(date);
}

/** The last day of the month a key falls in. */
function endOfMonth(key: string): string {
  const date = fromDateKey(key);
  const next = startOfMonth(addMonths(date, 1));
  next.setDate(next.getDate() - 1);
  return toDateKey(next);
}

export function resolvePreset(preset: RangePreset, today = todayKey()): DateRange {
  const start = startOfMonth(fromDateKey(today));

  switch (preset) {
    case "this-month":
      return { from: toDateKey(start), to: endOfMonth(today) };
    case "last-month": {
      const previous = startOfMonth(addMonths(start, -1));
      return { from: toDateKey(previous), to: endOfMonth(toDateKey(previous)) };
    }
    case "last-90":
      // 89, not 90: the range includes today, so 90 days back would be 91 days.
      return { from: shiftDays(today, -89), to: today };
    case "this-year": {
      const year = fromDateKey(today).getFullYear();
      return { from: `${year}-01-01`, to: `${year}-12-31` };
    }
  }
}

/**
 * The period immediately before this one, of the same length.
 *
 * Every headline number is shown against its previous period, because a number
 * with nothing to compare it to is decoration. Same length rather than "the
 * previous calendar month" so a 90-day range compares against 90 days.
 */
export function previousRange(range: DateRange): DateRange {
  const days = countDays(range);
  return { from: shiftDays(range.from, -days), to: shiftDays(range.from, -1) };
}

export function countDays(range: DateRange): number {
  const from = fromDateKey(range.from).getTime();
  const to = fromDateKey(range.to).getTime();
  // Both ends are built at midday, so DST never lands a boundary on 23 or 25
  // hours and rounds this to the wrong integer.
  return Math.round((to - from) / 86_400_000) + 1;
}

export function isWithin(key: string, range: DateRange): boolean {
  // Date keys are zero-padded, so lexical comparison is calendar comparison.
  return key >= range.from && key <= range.to;
}

export function isValidRange(range: DateRange): boolean {
  return isValidDateKey(range.from) && isValidDateKey(range.to) && range.from <= range.to;
}

/**
 * How finely to bucket a range.
 *
 * Chosen from the length rather than offered as a control: nobody wants to see
 * a year as 365 columns, and nobody wants a fortnight as two. One fewer thing
 * to get wrong on screen.
 */
export function bucketFor(range: DateRange): Bucket {
  const days = countDays(range);
  if (days <= 45) return "day";
  if (days <= 200) return "week";
  return "month";
}

/** The Monday of the week a key falls in. */
export function startOfWeek(key: string): string {
  const date = fromDateKey(key);
  // getDay() is 0 for Sunday; shift so Monday is 0.
  const offset = (date.getDay() + 6) % 7;
  date.setDate(date.getDate() - offset);
  return toDateKey(date);
}

/** Which bucket a date key belongs to, as the key of that bucket's first day. */
export function bucketKeyOf(key: string, bucket: Bucket): string {
  if (bucket === "day") return key;
  if (bucket === "week") return startOfWeek(key);
  return `${key.slice(0, 7)}-01`;
}

/**
 * Every bucket in the range, in order, **including empty ones**.
 *
 * The empty ones are the point. A quiet Tuesday is data; dropping it would
 * close the gap and draw a chart in which the restaurant never had a quiet
 * night, which is a lie told by omission.
 */
export function bucketsIn(range: DateRange, bucket = bucketFor(range)): string[] {
  const keys: string[] = [];
  const seen = new Set<string>();

  for (let key = range.from; key <= range.to; key = shiftDays(key, 1)) {
    const bucketKey = bucketKeyOf(key, bucket);
    if (!seen.has(bucketKey)) {
      seen.add(bucketKey);
      keys.push(bucketKey);
    }
  }

  return keys;
}

/** How a bucket is labelled on an axis: `25 Aug`, `w/c 24 Aug`, `Aug 2026`. */
export function formatBucket(key: string, bucket: Bucket, locale = "en-GB"): string {
  const date = fromDateKey(key);

  if (bucket === "month") {
    return new Intl.DateTimeFormat(locale, { month: "short", year: "numeric" }).format(date);
  }

  const short = new Intl.DateTimeFormat(locale, { day: "numeric", month: "short" }).format(date);
  return bucket === "week" ? `w/c ${short}` : short;
}

/** How the range itself is named, above the charts. */
export function formatRange(range: DateRange, locale = "en-GB"): string {
  const from = fromDateKey(range.from);
  const to = fromDateKey(range.to);
  const sameYear = from.getFullYear() === to.getFullYear();

  const start = new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "short",
    ...(sameYear ? {} : { year: "numeric" }),
  }).format(from);

  const end = new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", year: "numeric" }).format(to);

  return `${start} – ${end}`;
}
