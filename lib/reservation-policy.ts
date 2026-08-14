import { getReservationWindow } from "@/lib/calendar";
import type { ReservationRecord } from "@/types/booking";

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

export function formatDeadline(deadline: Date) {
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(deadline);
}
