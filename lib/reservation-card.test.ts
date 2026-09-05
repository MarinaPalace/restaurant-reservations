import { describe, expect, it } from "vitest";
import { buildReservationCard, reservationCardFileName } from "@/lib/reservation-card";
import type { ReservationRecord } from "@/types/booking";

/**
 * What goes on the card a guest shows at the door.
 *
 * The screen and the saved image render from this one description, so what is
 * asserted here is what both of them show. A row that appears only in the HTML
 * is a card that says something the guest was never shown.
 */

const LABELS = {
  numberLabel: "Reservation",
  room: "Room",
  date: "Date",
  arrivalTime: "Arrival",
  guests: "Guests",
  table: "Table",
  footnote: "Show this at the restaurant.",
};

function reservation(extra: Partial<ReservationRecord> = {}): ReservationRecord {
  return {
    reservationNumber: "VDM-3E94B8",
    roomNumber: "402",
    guestCount: 4,
    date: "2026-09-18",
    selections: [],
    status: "confirmed",
    ...extra,
  } as ReservationRecord;
}

describe("the confirmation card", () => {
  it("puts the reservation number where it can be read across a room", () => {
    const card = buildReservationCard(reservation(), LABELS);

    expect(card.reservationNumber).toBe("VDM-3E94B8");
    expect(card.numberLabel).toBe("Reservation");
  });

  /**
   * The number, and *only* the number. Not the pass-key: this card is made to
   * be shown to people and photographed by them, and the key is what changes
   * and cancels bookings. The number authorises nothing on its own.
   */
  it("encodes the reservation number in the code and nothing else", () => {
    const card = buildReservationCard(reservation(), LABELS);

    expect(card.qrValue).toBe("VDM-3E94B8");
  });

  it("carries the evening, the party and the room", () => {
    const card = buildReservationCard(reservation(), LABELS, { locale: "en-GB" });
    const values = Object.fromEntries(card.rows.map((row) => [row.label, row.value]));

    expect(values.Guests).toBe("4");
    expect(values.Room).toBe("402");
    expect(values.Date).toContain("2026");
  });

  /**
   * A booking the restaurant will seat on the night has no table yet, and a row
   * reading "Table —" promises one. Five honest rows beat six with a lie in it.
   */
  it("leaves the table off when there is not one", () => {
    const card = buildReservationCard(reservation(), LABELS);

    expect(card.rows.some((row) => row.label === "Table")).toBe(false);
  });

  it("shows the table when there is one", () => {
    const card = buildReservationCard(reservation({ tableNumber: "11 + 12" }), LABELS);
    const table = card.rows.find((row) => row.label === "Table");

    expect(table?.value).toBe("11 + 12");
  });

  /**
   * Which 19:00 (rule 2.16). A guest reading this on a phone still set to home
   * has no other way to know, and the offset moves with the seasons so it
   * cannot be written into the wording.
   */
  it("names the clock under the arrival time", () => {
    const card = buildReservationCard(reservation({ time: "19:00" }), LABELS, {
      timeZoneLabel: "Sofia time (UTC+3)",
    });

    const arrival = card.rows.find((row) => row.label === "Arrival");
    expect(arrival?.value).toBe("19:00");
    expect(arrival?.note).toBe("Sofia time (UTC+3)");
  });

  it("has no arrival row when the evening has no set time", () => {
    const card = buildReservationCard(reservation(), LABELS);

    expect(card.rows.some((row) => row.label === "Arrival")).toBe(false);
  });

  /** A guest with two dinners booked ends up with two of these in their photos. */
  it("names the file after the booking", () => {
    expect(reservationCardFileName("VDM-3E94B8", "png")).toBe("vista-del-mar-VDM-3E94B8.png");
  });
});
