import { RESTAURANT_NAME, RESTAURANT_TAGLINE } from "@/lib/brand";
import { formatLongDate } from "@/lib/date";
import type { ReservationRecord } from "@/types/booking";

/**
 * The card a guest shows us.
 *
 * ## What it is for
 *
 * The confirmation screen is a web page, and a web page is a poor thing to
 * hold up at a door: it needs signal, it needs the tab to still be open, and
 * it is laid out for reading rather than for being read *from* at arm's length.
 * The card is the same booking as an object — one image, saved to the phone,
 * with the reservation number large enough to read across a lectern and a QR
 * the desk can scan.
 *
 * ## One description, two renderers
 *
 * This module says *what is on the card* and nothing about how it is drawn.
 * The confirmation screen renders these rows as HTML, and the download renders
 * the same rows onto a canvas. Two renderers reading one description is what
 * keeps the saved image and the screen from drifting — the alternative is a
 * card that says something the guest was never shown.
 *
 * ## The QR carries the reservation number and nothing else
 *
 * Not the pass-key. The key is the guest's credential — it changes and cancels
 * bookings — and this card is made to be shown to people and photographed by
 * them. The number identifies the booking to staff, who are behind a login;
 * on its own it authorises nothing, which is exactly the property that makes
 * it safe to print large on a card left face-up on a table.
 */

export type ReservationCardRow = {
  /** Already translated by the caller — this module does no wording of its own. */
  label: string;
  value: string;
  /**
   * A second line under the value, smaller. The timezone under an arrival
   * time, which is meaningless to a guest reading a phone still set to home
   * without it (rule 2.16).
   */
  note?: string;
};

export type ReservationCard = {
  restaurantName: string;
  tagline: string;
  /** The eyebrow over the number, e.g. "Reservation". */
  numberLabel: string;
  reservationNumber: string;
  rows: ReservationCardRow[];
  /** The line along the bottom, telling staff and guest what the code is for. */
  footnote: string;
  /** What the QR encodes. The reservation number, always. */
  qrValue: string;
};

export type ReservationCardLabels = {
  numberLabel: string;
  room: string;
  date: string;
  arrivalTime: string;
  guests: string;
  table: string;
  footnote: string;
};

/**
 * The card for one booking.
 *
 * Rows appear only when the booking has them. A table is the clearest case: a
 * booking the restaurant will seat on the night has no table yet, and a row
 * reading "Table —" promises one. Better to have five rows than six with a lie
 * in it.
 */
export function buildReservationCard(
  reservation: ReservationRecord,
  labels: ReservationCardLabels,
  options: { locale?: string; timeZoneLabel?: string } = {},
): ReservationCard {
  const rows: ReservationCardRow[] = [
    { label: labels.date, value: formatLongDate(reservation.date, options.locale) },
  ];

  if (reservation.time) {
    rows.push({
      label: labels.arrivalTime,
      value: reservation.time,
      // Which 19:00. The offset moves with the seasons, so it cannot be
      // written into the copy (rule 2.16).
      note: options.timeZoneLabel,
    });
  }

  rows.push({ label: labels.guests, value: String(Math.max(reservation.guestCount, 1)) });
  rows.push({ label: labels.room, value: reservation.roomNumber });

  if (reservation.tableNumber) {
    rows.push({ label: labels.table, value: reservation.tableNumber });
  }

  return {
    restaurantName: RESTAURANT_NAME,
    tagline: RESTAURANT_TAGLINE,
    numberLabel: labels.numberLabel,
    reservationNumber: reservation.reservationNumber,
    rows,
    footnote: labels.footnote,
    qrValue: reservation.reservationNumber,
  };
}

/** The file a guest ends up with in their photos. */
export function reservationCardFileName(reservationNumber: string, extension: "png" | "ics") {
  // The number is in the name because a guest with two dinners booked has two
  // of these, and "reservation.png (1)" tells them nothing about which.
  return `${RESTAURANT_NAME.toLowerCase().replace(/\s+/g, "-")}-${reservationNumber}.${extension}`;
}
