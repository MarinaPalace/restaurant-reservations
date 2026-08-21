import type { ReservationRecord } from "@/types/booking";

/**
 * When a booking came in, and how to order a list by it.
 *
 * ## Why this exists
 *
 * `ReservationRecord.createdAt` has been written on every booking since the
 * field existed, and both stores already sort by it — `getReservationsList`
 * uses `{ createdAt: -1 }`, `listLocalReservations` sorts the same way. It was
 * then displayed **nowhere**, and the dashboard re-sorted the evening by room
 * before showing it, so "when did this come in?" was answered by guessing.
 *
 * Room order is right for a *service sheet*, which is read by walking the
 * room. It is wrong for "what arrived today?". So the order becomes a choice
 * rather than a constant, and the choosing lives here — pure, so it can be
 * tested without a browser.
 *
 * ## Two kinds of time, and this module touches both
 *
 * `date` is a local calendar string; `createdAt` is an ISO instant. They are
 * not the same kind of value and must never be bucketed by the same code
 * (see `docs/timezones.md` §1). This is the one place they meet, and the
 * conversion is confined to `formatBookedAt`.
 */

export const RESERVATION_ORDERS = ["service", "newest", "oldest"] as const;

export type ReservationOrder = (typeof RESERVATION_ORDERS)[number];

/** What each order is for, in the words the dashboard uses. */
export const RESERVATION_ORDER_LABELS: Record<ReservationOrder, string> = {
  service: "Room order (for service)",
  newest: "Newest booking first",
  oldest: "Oldest booking first",
};

export function isReservationOrder(value: unknown): value is ReservationOrder {
  return typeof value === "string" && (RESERVATION_ORDERS as readonly string[]).includes(value);
}

/**
 * Compares two bookings by when they were taken.
 *
 * **A booking with no `createdAt` always sorts last**, in either direction —
 * not first in one and last in the other. Records that predate the field are
 * exactly the ones somebody scrolls to the end looking for, and a row whose
 * position depends on which way the list happens to be pointing is a row
 * nobody can find twice. Absent is "unknown", and unknown goes at the bottom.
 *
 * Ties break on the reservation number so the order is **total**: two bookings
 * taken in the same second must not swap places between renders.
 */
export function compareByBookedAt(
  a: Pick<ReservationRecord, "createdAt" | "reservationNumber">,
  b: Pick<ReservationRecord, "createdAt" | "reservationNumber">,
  direction: "newest" | "oldest",
): number {
  const left = a.createdAt ?? "";
  const right = b.createdAt ?? "";

  if (!left && !right) {
    return a.reservationNumber.localeCompare(b.reservationNumber);
  }
  if (!left) {
    return 1;
  }
  if (!right) {
    return -1;
  }

  // ISO instants are lexicographically ordered, so string comparison is the
  // whole of it — and it cannot be caught out by a bad `new Date()` parse.
  const compared = left.localeCompare(right);
  if (compared !== 0) {
    return direction === "newest" ? -compared : compared;
  }

  return a.reservationNumber.localeCompare(b.reservationNumber);
}

/**
 * A copy of the list in the chosen order.
 *
 * `service` returns the input untouched: room order is the sheet's own
 * business and belongs to `lib/kitchen-report.ts`, which knows about tables
 * and shared groups. This module does not duplicate that.
 */
export function sortReservationsBy<T extends Pick<ReservationRecord, "createdAt" | "reservationNumber">>(
  reservations: readonly T[],
  order: ReservationOrder,
): T[] {
  if (order === "service") {
    return [...reservations];
  }

  return [...reservations].sort((a, b) => compareByBookedAt(a, b, order));
}

/**
 * When the booking was taken, for a staff screen: `25 Aug, 14:32`.
 *
 * Returns `null` when there is nothing to show, so the caller renders its own
 * placeholder rather than being handed the string "Invalid Date" — which is
 * what `new Date(undefined)` produces, and which would sit in a column looking
 * like data.
 *
 * The year is omitted deliberately: staff read this against evenings weeks
 * away at most, and a four-digit year in every row is noise. `formatBookedAtLong`
 * is for the reservation page, where there is room and the record is permanent.
 */
export function formatBookedAt(createdAt: string | undefined, locale = "en-GB"): string | null {
  const at = toDate(createdAt);
  if (!at) {
    return null;
  }

  return new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(at);
}

/** The same, with the year and the weekday, for a screen that has room. */
export function formatBookedAtLong(createdAt: string | undefined, locale = "en-GB"): string | null {
  const at = toDate(createdAt);
  if (!at) {
    return null;
  }

  return new Intl.DateTimeFormat(locale, {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(at);
}

/**
 * Parses the stored instant, refusing anything that is not one.
 *
 * `new Date("")` and `new Date("nonsense")` both yield an Invalid Date that
 * formats as the string "Invalid Date" rather than throwing, so it has to be
 * caught here or it reaches the screen.
 */
function toDate(createdAt: string | undefined): Date | null {
  if (!createdAt) {
    return null;
  }

  const at = new Date(createdAt);
  return Number.isNaN(at.getTime()) ? null : at;
}

/**
 * How long before the sitting the booking was taken, in whole hours.
 *
 * The lead-time figure the analytics page will want (see `docs/analytics.md`
 * §2), and the number that says whether a booking cutoff is safe. Returns
 * `null` when either end is unknown, rather than 0 — a booking with no
 * `createdAt` has no lead time, and counting it as "booked at the last moment"
 * would drag every average down.
 *
 * Takes the sitting as a `Date` rather than a date key, because turning a key
 * and a `"19:00"` into an instant is `getReservationWindow`'s job and depends
 * on the process clock (`docs/timezones.md`). This function stays pure.
 */
export function leadTimeHours(createdAt: string | undefined, sitting: Date | null): number | null {
  const at = toDate(createdAt);
  if (!at || !sitting || Number.isNaN(sitting.getTime())) {
    return null;
  }

  return Math.floor((sitting.getTime() - at.getTime()) / 3_600_000);
}
