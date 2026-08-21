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

/** Whether the guest may still change or cancel this booking themselves. */
export function canGuestModify(
  reservation: Pick<ReservationRecord, "date" | "time" | "endTime" | "status">,
  now = new Date(),
): ModificationCheck {
  const deadline = getModificationDeadline(reservation);

  if (reservation.status === "cancelled") {
    return { allowed: false, deadline, reason: "This reservation has already been cancelled." };
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
