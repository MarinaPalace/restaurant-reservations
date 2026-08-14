/**
 * Calendar dates in this app are plain `YYYY-MM-DD` strings in the
 * restaurant's local timezone — they are not instants.
 *
 * `Date#toISOString()` must never be used to derive them: it converts to UTC
 * first, which shifts the key to the previous day for every timezone east of
 * Greenwich (in Europe/Sofia, local 18 August became "2026-08-17").
 */

export const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** Formats a Date as a `YYYY-MM-DD` key using its local calendar fields. */
export function toDateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** Parses a `YYYY-MM-DD` key into a local Date at midday (DST-safe). */
export function fromDateKey(key: string) {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(year, month - 1, day, 12, 0, 0, 0);
}

export function isValidDateKey(key: string): boolean {
  if (!DATE_KEY_PATTERN.test(key)) {
    return false;
  }

  // Rejects impossible dates such as 2026-02-31, which the regex alone allows.
  return toDateKey(fromDateKey(key)) === key;
}

export function todayKey(now = new Date()) {
  return toDateKey(now);
}

export function isPastDateKey(key: string, now = new Date()) {
  return key < todayKey(now);
}

export function startOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1, 12, 0, 0, 0);
}

export function addMonths(date: Date, amount: number) {
  return new Date(date.getFullYear(), date.getMonth() + amount, 1, 12, 0, 0, 0);
}

export function isSameMonth(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth();
}

/**
 * Six Monday-first weeks covering the given month, so the grid never reflows
 * between months.
 */
export function buildCalendarGrid(month: Date) {
  const first = startOfMonth(month);
  const leadingDays = (first.getDay() + 6) % 7;
  const gridStart = new Date(first);
  gridStart.setDate(first.getDate() - leadingDays);

  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(gridStart);
    date.setDate(gridStart.getDate() + index);
    return date;
  });
}

export function formatLongDate(key: string, locale = "en-GB") {
  if (!isValidDateKey(key)) {
    return key;
  }
  return new Intl.DateTimeFormat(locale, { weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(
    fromDateKey(key),
  );
}

export function formatShortDate(key: string, locale = "en-GB") {
  if (!isValidDateKey(key)) {
    return key;
  }
  return new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", year: "numeric" }).format(fromDateKey(key));
}

export function formatMonthLabel(month: Date, locale = "en-GB") {
  return new Intl.DateTimeFormat(locale, { month: "long", year: "numeric" }).format(month);
}
