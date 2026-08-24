import type { ReservationRecord } from "@/types/booking";

/**
 * A booking as a **guest** may see it.
 *
 * ## Why this exists at all
 *
 * Every guest-facing route hands back the whole reservation document. That was
 * harmless while every field on it was something the guest had told us or
 * something we had told them — and it stopped being harmless the moment a field
 * arrived that staff write *about* a guest.
 *
 * A note reading "difficult about the wine last time" is a legitimate thing for
 * reception to record and a catastrophic thing to send to the person it is
 * about. So it is not enough for the screens not to render it: the guest routes
 * must not put it on the wire, because a guest can open the network tab and a
 * screen is not a boundary.
 *
 * ## A named list, not a hand-rolled omission per route
 *
 * The failure this guards against is somebody adding the *next* staff-only
 * field and forgetting one of the five routes. So there is one list, one
 * function, and a test that walks a fully-populated record through it and fails
 * if any listed field survives.
 *
 * Deny-list rather than allow-list, deliberately. An allow-list would be safer
 * against a field nobody classified, but it would also silently stop sending
 * fields that guests legitimately read today the moment one is added to the
 * record — a bug that shows up as a blank on a guest's screen rather than as a
 * failing test. The list below is short, it is checked, and adding to it is the
 * same edit as adding the field.
 */
export const STAFF_ONLY_RESERVATION_FIELDS = ["staffNote"] as const;

export type StaffOnlyReservationField = (typeof STAFF_ONLY_RESERVATION_FIELDS)[number];

export type GuestReservation = Omit<ReservationRecord, StaffOnlyReservationField>;

/**
 * Strips everything only staff may see. Call it on **every** reservation a
 * guest route returns, including inside a list.
 */
export function toGuestReservation(reservation: ReservationRecord): GuestReservation {
  const copy: ReservationRecord = { ...reservation };

  for (const field of STAFF_ONLY_RESERVATION_FIELDS) {
    delete copy[field];
  }

  return copy;
}
