import { getReservationWindow } from "@/lib/calendar";
import type { ReservationRecord, RestaurantDateAvailability } from "@/types/booking";

/**
 * How late a guest may change their own booking.
 *
 * Inside this window the kitchen is already ordering and prepping against the
 * numbers, so changes have to go through reception. Staff are not bound by it.
 */
export const MODIFICATION_CUTOFF_HOURS = 12;

export type ModificationCheck = {
  allowed: boolean;
  /** The moment self-service closes. */
  deadline: Date;
  /** Set when the change is refused, worded for the guest. */
  reason?: string;
};

export function getModificationDeadline(reservation: Pick<ReservationRecord, "date" | "time" | "endTime">) {
  const { start } = getReservationWindow(reservation.date, reservation.time, reservation.endTime);
  const deadline = new Date(start);
  deadline.setHours(deadline.getHours() - MODIFICATION_CUTOFF_HOURS);
  return deadline;
}

/**
 * Whether the guest may still change or cancel this booking themselves.
 *
 * `selfService` is the evening's own switch (`lib/evening-features.ts`), and it
 * is checked **before the deadline** on purpose: an evening that sends its
 * guests to reception is a standing arrangement, not a thing that runs out at
 * a particular hour, and telling somebody "changes close four hours before"
 * when they were never going to be able to change it online is a wrong answer
 * dressed as a helpful one.
 *
 * It defaults to on, which is what the app has always done — and is why the
 * deadline tests below did not need touching when this was added.
 */
export function canGuestModify(
  reservation: Pick<ReservationRecord, "date" | "time" | "endTime" | "status">,
  now = new Date(),
  selfService = true,
): ModificationCheck {
  const deadline = getModificationDeadline(reservation);

  if (reservation.status === "cancelled") {
    return { allowed: false, deadline, reason: "This reservation has already been cancelled." };
  }

  if (!selfService) {
    return {
      allowed: false,
      deadline,
      reason:
        "Changes to this evening are arranged by reception. Please give them a call and they will " +
        "take care of it for you.",
    };
  }

  if (now >= deadline) {
    return {
      allowed: false,
      deadline,
      reason:
        `Changes close ${MODIFICATION_CUTOFF_HOURS} hours before the sitting because the kitchen is already ` +
        "preparing. Please speak to reception and they will arrange it for you.",
    };
  }

  return { allowed: true, deadline };
}

export function formatDeadline(deadline: Date, locale = "en-GB") {
  return new Intl.DateTimeFormat(locale, {
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(deadline);
}

/* ------------------------------------------------------------------ *
 * How late a guest may take a table
 * ------------------------------------------------------------------ */

/**
 * The moment guest bookings close for an evening.
 *
 * `bookingCutoffHours` is set per date by staff, because it is not one number:
 * a quiet Tuesday can take a booking an hour before service, and a full
 * Saturday with a set menu cannot. Absent reads as 0 — bookings close when the
 * sitting starts, which is what every evening did before this existed, so no
 * date needs touching.
 *
 * Separate from `MODIFICATION_CUTOFF_HOURS`, which is about *changing* a
 * booking the kitchen has already counted. These answer different questions
 * and there is no reason they should move together.
 */
export function getBookingDeadline(
  date: Pick<RestaurantDateAvailability, "date" | "serviceTime" | "serviceEndTime" | "bookingCutoffHours">,
): Date {
  const { start } = getReservationWindow(date.date, date.serviceTime, date.serviceEndTime);
  const hours = Math.max(0, Number(date.bookingCutoffHours ?? 0));
  const deadline = new Date(start);

  deadline.setMinutes(deadline.getMinutes() - Math.round(hours * 60));
  return deadline;
}

export type BookingWindowCheck = {
  allowed: boolean;
  deadline: Date;
  /** How many hours before the sitting this evening closes. 0 = at the sitting. */
  cutoffHours: number;
};

/**
 * Whether a **guest** may still book this evening themselves.
 *
 * Staff never call this. Reception can take a booking at any time, including
 * for a table standing at the desk, and the staff routes deliberately do not
 * consult it.
 */
export function canGuestBookDate(
  date: Pick<RestaurantDateAvailability, "date" | "serviceTime" | "serviceEndTime" | "bookingCutoffHours">,
  now = new Date(),
): BookingWindowCheck {
  const deadline = getBookingDeadline(date);

  return {
    allowed: now < deadline,
    deadline,
    cutoffHours: Math.max(0, Number(date.bookingCutoffHours ?? 0)),
  };
}

/* ------------------------------------------------------------------ *
 * How late a guest may choose their table
 * ------------------------------------------------------------------ */

/**
 * When guests stop choosing tables for an evening.
 *
 * A third deadline, and deliberately not one of the two that already exist.
 * Bookings close when the kitchen can take no more covers (`bookingCutoffHours`).
 * Changes close when the kitchen has counted (`MODIFICATION_CUTOFF_HOURS`).
 * Tables close when **the floor is laid out** — which is usually earlier than
 * either, because a table moving at 18:55 is a table nobody has told the waiter
 * about, and the plan on the wall is already wrong.
 *
 * `tableCutoffHours` absent or 0 means **off**: no separate deadline, tables
 * stay choosable for as long as the booking rules allow. That is what every
 * evening did before this existed, so no date needs touching and a restaurant
 * that does not care never has to think about it.
 */
export function getTableSelectionDeadline(
  date: Pick<RestaurantDateAvailability, "date" | "serviceTime" | "serviceEndTime" | "tableCutoffHours">,
): Date | null {
  const hours = Math.max(0, Number(date.tableCutoffHours ?? 0));

  if (hours <= 0) {
    return null;
  }

  const { start } = getReservationWindow(date.date, date.serviceTime, date.serviceEndTime);
  const deadline = new Date(start);

  deadline.setMinutes(deadline.getMinutes() - Math.round(hours * 60));
  return deadline;
}

export type TableSelectionCheck = {
  allowed: boolean;
  /** Absent when this evening has no table cutoff at all. */
  deadline: Date | null;
  /** How many hours before the sitting tables stop being chosen. 0 = never. */
  cutoffHours: number;
};

/**
 * Whether a **guest** may still choose or change a table on this evening.
 *
 * Staff never call this. Reception seats a party that has walked up to the
 * desk, and a rule that stopped them would only be worked around on paper.
 *
 * Note what this does *not* check: whether the booking may be changed at all.
 * That is `canGuestModify`, and both have to pass — the table cutoff can only
 * ever close the door earlier, never hold it open after the booking itself has
 * closed.
 */
export function canGuestChooseTable(
  date: Pick<RestaurantDateAvailability, "date" | "serviceTime" | "serviceEndTime" | "tableCutoffHours"> | null,
  now = new Date(),
): TableSelectionCheck {
  const cutoffHours = Math.max(0, Number(date?.tableCutoffHours ?? 0));

  if (!date || cutoffHours <= 0) {
    return { allowed: true, deadline: null, cutoffHours: 0 };
  }

  const deadline = getTableSelectionDeadline(date);

  return { allowed: deadline === null || now < deadline, deadline, cutoffHours };
}
