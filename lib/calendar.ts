import { fromDateKey, formatLongDate } from "@/lib/date";
import type { ReservationRecord } from "@/types/booking";

/**
 * Calendar reminders for a confirmed reservation.
 *
 * A reservation stores a date but no time, so the sitting time comes from
 * configuration. Set NEXT_PUBLIC_DINNER_TIME (24-hour "HH:MM") and
 * NEXT_PUBLIC_DINNER_DURATION_MINUTES to match the restaurant's service.
 */

const DEFAULT_TIME = "19:00";
const DEFAULT_DURATION_MINUTES = 120;

function getServiceTime() {
  const configured = process.env.NEXT_PUBLIC_DINNER_TIME?.trim();
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

export function getReservationWindow(dateKey: string) {
  const { hour, minute } = getServiceTime();
  const start = fromDateKey(dateKey);
  start.setHours(hour, minute, 0, 0);

  const end = new Date(start);
  end.setMinutes(end.getMinutes() + getDurationMinutes());

  return { start, end };
}

/** Calendar links use UTC basic format: YYYYMMDDTHHMMSSZ. */
function toCalendarStamp(date: Date) {
  return `${date.toISOString().replace(/[-:]/g, "").split(".")[0]}Z`;
}

function buildDescription(reservation: ReservationRecord) {
  const lines = [
    `Reservation ${reservation.reservationNumber}`,
    `Room ${reservation.roomNumber} · ${reservation.guestCount} ${reservation.guestCount === 1 ? "guest" : "guests"}`,
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
  return `Dinner reservation · ${reservation.reservationNumber}`;
}

export function buildGoogleCalendarUrl(reservation: ReservationRecord, locationName = "À la carte restaurant") {
  const { start, end } = getReservationWindow(reservation.date);

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
export function buildIcsFile(reservation: ReservationRecord, locationName = "À la carte restaurant") {
  const { start, end } = getReservationWindow(reservation.date);

  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//A la carte restaurant//Reservations//EN",
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
    // Nudge the guest three hours before the sitting.
    "TRIGGER:-PT3H",
    "ACTION:DISPLAY",
    `DESCRIPTION:${escapeIcsText(buildEventTitle(reservation))}`,
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
}

export function describeReservationTime(dateKey: string) {
  const { start, end } = getReservationWindow(dateKey);
  const time = (date: Date) =>
    new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false }).format(date);

  return `${formatLongDate(dateKey)}, ${time(start)}–${time(end)}`;
}
