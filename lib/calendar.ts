import { fromDateKey, formatLongDate } from "@/lib/date";
import { RESTAURANT_NAME } from "@/lib/brand";
import type { ReservationRecord } from "@/types/booking";

/**
 * Calendar reminders for a confirmed reservation.
 *
 * The arrival and end times staff set for that evening are copied onto the
 * booking. NEXT_PUBLIC_DINNER_TIME / NEXT_PUBLIC_DINNER_DURATION_MINUTES are
 * only fallbacks for dates configured before those existed.
 */

const DEFAULT_TIME = "19:00";
const DEFAULT_DURATION_MINUTES = 120;

/** Guests should be seated a few minutes before service starts. */
export const ARRIVE_EARLY_MINUTES = 10;

function getServiceTime(preferred?: string) {
  // The time staff set for that evening wins; the env value is only a
  // fallback for dates configured before arrival times existed.
  const configured = (preferred || process.env.NEXT_PUBLIC_DINNER_TIME)?.trim();
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(configured ?? "");

  if (!match) {
    const [hour, minute] = DEFAULT_TIME.split(":").map(Number);
    return { hour, minute };
  }

  return { hour: Number(match[1]), minute: Number(match[2]) };
}

function getDurationMinutes() {
  const configured = Number(process.env.NEXT_PUBLIC_DINNER_DURATION_MINUTES);
  return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_DURATION_MINUTES;
}

function parseTime(value: string | undefined) {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value?.trim() ?? "");
  return match ? { hour: Number(match[1]), minute: Number(match[2]) } : null;
}

export function getReservationWindow(dateKey: string, serviceTime?: string, serviceEndTime?: string) {
  const { hour, minute } = getServiceTime(serviceTime);
  const start = fromDateKey(dateKey);
  start.setHours(hour, minute, 0, 0);

  const end = new Date(start);
  const explicitEnd = parseTime(serviceEndTime);

  if (explicitEnd) {
    end.setHours(explicitEnd.hour, explicitEnd.minute, 0, 0);
    // An end before the start means the sitting runs past midnight.
    if (end <= start) {
      end.setDate(end.getDate() + 1);
    }
  } else {
    end.setMinutes(end.getMinutes() + getDurationMinutes());
  }

  return { start, end };
}

/** Calendar links use UTC basic format: YYYYMMDDTHHMMSSZ. */
function toCalendarStamp(date: Date) {
  return `${date.toISOString().replace(/[-:]/g, "").split(".")[0]}Z`;
}

function buildDescription(reservation: ReservationRecord) {
  const { start } = getReservationWindow(reservation.date, reservation.time, reservation.endTime);
  const arrival = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false }).format(start);

  const lines = [
    `Reservation ${reservation.reservationNumber}`,
    `Room ${reservation.roomNumber} · ${reservation.guestCount} ${reservation.guestCount === 1 ? "guest" : "guests"}`,
    "",
    `Everyone is seated at ${arrival}. Please arrive ${ARRIVE_EARLY_MINUTES} minutes early so you can be shown to your table.`,
  ];

  const byGuest = new Map<number, string[]>();
  for (const selection of reservation.selections) {
    const guestIndex = selection.guestIndex ?? 0;
    byGuest.set(guestIndex, [...(byGuest.get(guestIndex) ?? []), `${selection.courseName}: ${selection.optionName}`]);
  }

  for (const [guestIndex, choices] of [...byGuest.entries()].sort(([a], [b]) => a - b)) {
    lines.push("", `Guest ${guestIndex + 1}`, ...choices);
  }

  return lines.join("\n");
}

export function buildEventTitle(reservation: ReservationRecord) {
  return `${RESTAURANT_NAME} · ${reservation.reservationNumber}`;
}

export function buildGoogleCalendarUrl(reservation: ReservationRecord, locationName = RESTAURANT_NAME) {
  const { start, end } = getReservationWindow(reservation.date, reservation.time, reservation.endTime);

  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: buildEventTitle(reservation),
    dates: `${toCalendarStamp(start)}/${toCalendarStamp(end)}`,
    details: buildDescription(reservation),
    location: locationName,
  });

  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

/** Escapes the characters that carry meaning in an iCalendar value. */
function escapeIcsText(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
}

/** An .ics file, for Apple Calendar, Outlook and everything that is not Google. */
export function buildIcsFile(reservation: ReservationRecord, locationName = RESTAURANT_NAME) {
  const { start, end } = getReservationWindow(reservation.date, reservation.time, reservation.endTime);

  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    `PRODID:-//${RESTAURANT_NAME}//Reservations//EN`,
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${reservation.reservationNumber}@reservations`,
    `DTSTAMP:${toCalendarStamp(new Date())}`,
    `DTSTART:${toCalendarStamp(start)}`,
    `DTEND:${toCalendarStamp(end)}`,
    `SUMMARY:${escapeIcsText(buildEventTitle(reservation))}`,
    `DESCRIPTION:${escapeIcsText(buildDescription(reservation))}`,
    `LOCATION:${escapeIcsText(locationName)}`,
    "BEGIN:VALARM",
    // A nudge the evening of, and again in time to walk down.
    "TRIGGER:-PT3H",
    "ACTION:DISPLAY",
    `DESCRIPTION:${escapeIcsText(buildEventTitle(reservation))}`,
    "END:VALARM",
    "BEGIN:VALARM",
    `TRIGGER:-PT${ARRIVE_EARLY_MINUTES + 5}M`,
    "ACTION:DISPLAY",
    `DESCRIPTION:${escapeIcsText(`Time to head down — please arrive a few minutes early.`)}`,
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
}

export function describeReservationTime(dateKey: string, serviceTime?: string, serviceEndTime?: string) {
  const { start, end } = getReservationWindow(dateKey, serviceTime, serviceEndTime);
  const time = (date: Date) =>
    new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false }).format(date);

  return `${formatLongDate(dateKey)}, ${time(start)}–${time(end)}`;
}
