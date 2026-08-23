import { describe, expect, it } from "vitest";
import {
  STAFF_ONLY_RESERVATION_FIELDS,
  toGuestReservation,
} from "@/lib/guest-reservation";
import type { ReservationRecord } from "@/types/booking";

/**
 * The boundary between what staff record and what a guest may read.
 *
 * A note reading "difficult about the wine last time" is a legitimate thing for
 * reception to keep and a catastrophic thing to send to the person it is about.
 * A guest can open the network tab, so a screen that does not render it is not
 * a boundary — the route is.
 */
describe("what a guest may see of their own booking", () => {
  /** Every field a record can carry, so nothing is stripped by accident. */
  const full: ReservationRecord = {
    reservationNumber: "VDM-1234",
    kind: "standard",
    roomNumber: "402",
    additionalRooms: ["405"],
    guestName: "A guest",
    guestCount: 2,
    date: "2026-09-04",
    selections: [{ courseId: "c1", courseName: "Starter", optionId: "o1", optionName: "Salmon" }],
    addOns: [
      {
        courseId: "p1",
        courseName: "Wines",
        optionId: "w1",
        optionName: "Chardonnay",
        price: 3200,
        discountPercent: 10,
        finalPrice: 2880,
      },
    ],
    attendance: { status: "seated", at: "2026-09-04T19:02:00.000Z", byName: "Reception" },
    contact: { method: "email", email: "guest@example.com" },
    time: "19:00",
    endTime: "22:00",
    notes: "No gluten for guest 2",
    staffNote: "Complained about the wine last time. Do not seat by the door.",
    tableGroupId: "VDM-1234",
    tableNumber: "7",
    status: "confirmed",
    passKeyId: "key-1",
    createdAt: "2026-09-01T10:00:00.000Z",
    updatedAt: "2026-09-01T10:00:00.000Z",
  };

  it("keeps everything the guest told us or we told them", () => {
    const guest = toGuestReservation(full) as ReservationRecord;

    expect(guest.reservationNumber).toBe("VDM-1234");
    expect(guest.selections).toEqual(full.selections);
    expect(guest.addOns).toEqual(full.addOns);
    expect(guest.tableNumber).toBe("7");
    // The guest's own note stays: they wrote it, and the screen shows it back.
    expect(guest.notes).toBe("No gluten for guest 2");
  });

  /**
   * The test the whole module exists for. It walks every listed field rather
   * than naming `staffNote`, so adding the *next* staff-only field to the list
   * extends the guard automatically — and forgetting to add it to the list is
   * the one mistake this cannot catch, which is why the list sits beside the
   * type that declares the field.
   */
  it("strips every field only staff may see", () => {
    const guest = toGuestReservation(full) as Record<string, unknown>;

    for (const field of STAFF_ONLY_RESERVATION_FIELDS) {
      expect(field in guest).toBe(false);
    }

    expect(STAFF_ONLY_RESERVATION_FIELDS.length).toBeGreaterThan(0);
  });

  it("does not alter the record it was given", () => {
    const copy = { ...full };
    toGuestReservation(full);

    // A route that strips on the way out must not have quietly emptied the
    // object it is about to write to the audit log or return to staff.
    expect(full).toEqual(copy);
    expect(full.staffNote).toBe("Complained about the wine last time. Do not seat by the door.");
  });

  it("is unbothered by a booking that has no staff note", () => {
    const { staffNote, ...without } = full;
    void staffNote;

    expect(toGuestReservation(without as ReservationRecord)).toEqual(without);
  });
});
