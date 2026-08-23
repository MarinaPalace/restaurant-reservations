import { describe, expect, it } from "vitest";
import { describeChange, describeReservationChanges, summariseChanges } from "@/lib/reservation-changes";
import type { ReservationRecord } from "@/types/booking";

function booking(over: Partial<ReservationRecord> = {}): ReservationRecord {
  return {
    reservationNumber: "R-1",
    roomNumber: "101",
    guestCount: 4,
    date: "2026-08-25",
    selections: [],
    status: "confirmed",
    ...over,
  };
}

describe("describeReservationChanges", () => {
  it("says nothing when nothing moved", () => {
    expect(describeReservationChanges(booking(), booking())).toEqual([]);
  });

  it("ignores the timestamps that change on every write", () => {
    const before = booking({ updatedAt: "2026-08-01T10:00:00.000Z" });
    const after = booking({ updatedAt: "2026-08-02T11:00:00.000Z" });

    expect(describeReservationChanges(before, after)).toEqual([]);
  });

  it("names the field, the old value and the new", () => {
    const changes = describeReservationChanges(booking({ tableNumber: "12" }), booking({ tableNumber: "7" }));

    expect(changes).toEqual([{ field: "tableNumber", label: "Table", from: "12", to: "7" }]);
    expect(describeChange(changes[0]!)).toBe("Table 12 → 7");
  });

  it("treats blank, whitespace and absent as the same nothing", () => {
    expect(describeReservationChanges(booking({ tableNumber: "" }), booking({}))).toEqual([]);
    expect(describeReservationChanges(booking({ staffNote: "  " }), booking({ staffNote: "" }))).toEqual([]);
  });

  it("marks a field being filled in and a field being cleared", () => {
    const set = describeReservationChanges(booking(), booking({ tableNumber: "7" }));
    expect(describeChange(set[0]!)).toBe("Table set to 7");

    const cleared = describeReservationChanges(booking({ tableNumber: "7" }), booking());
    expect(describeChange(cleared[0]!)).toBe("Table cleared (was 7)");
  });

  it("reads the date and the party before the notes", () => {
    const changes = describeReservationChanges(
      booking({ staffNote: "quiet corner" }),
      booking({ date: "2026-08-26", guestCount: 6, staffNote: "by the window" }),
    );

    expect(changes.map((change) => change.field)).toEqual(["date", "guestCount", "staffNote"]);
  });

  it("counts the dishes rather than diffing the menu guest by guest", () => {
    const changes = describeReservationChanges(
      booking(),
      booking({
        selections: [
          { guestIndex: 0, courseId: "c1", courseName: "Starter", optionId: "o1", optionName: "Soup" },
          { guestIndex: 1, courseId: "c1", courseName: "Starter", optionId: "o2", optionName: "Salad" },
        ],
      }),
    );

    expect(changes[0]?.label).toBe("Menu");
    expect(changes[0]?.to).toBe("2 dishes (Salad, Soup)");
  });

  it("does not report a change when the same dishes come back in another order", () => {
    const dishes = [
      { guestIndex: 0, courseId: "c1", courseName: "Starter", optionId: "o1", optionName: "Soup" },
      { guestIndex: 1, courseId: "c1", courseName: "Starter", optionId: "o2", optionName: "Salad" },
    ];

    const changes = describeReservationChanges(
      booking({ selections: dishes }),
      booking({ selections: [...dishes].reverse() }),
    );

    expect(changes).toEqual([]);
  });

  it("notices a guest moved from a telephone call to WhatsApp", () => {
    const changes = describeReservationChanges(
      booking({ contact: { method: "phone", phone: "+359888123456" } }),
      booking({ contact: { method: "phone", phone: "+359888123456", messagingApp: "whatsapp" } }),
    );

    expect(changes[0]).toMatchObject({ field: "contact", from: "+359888123456", to: "+359888123456 (whatsapp)" });
  });

  it("does not leave `service` or `attendance` to this — they have their own words", () => {
    const changes = describeReservationChanges(
      booking(),
      booking({
        attendance: { status: "seated", at: "2026-08-25T18:00:00.000Z", byName: "Maria" },
        service: { servedAt: { c1: "2026-08-25T18:20:00.000Z" } },
      }),
    );

    expect(changes).toEqual([]);
  });
});

describe("summariseChanges", () => {
  it("is a sentence a person can read in a list", () => {
    const changes = describeReservationChanges(
      booking({ tableNumber: "12" }),
      booking({ tableNumber: "7", guestCount: 6 }),
    );

    expect(summariseChanges(changes)).toBe("Party 4 → 6; Table 12 → 7");
  });

  it("counts the rest rather than running to three lines", () => {
    const changes = describeReservationChanges(
      booking(),
      booking({
        date: "2026-08-26",
        time: "19:00",
        guestCount: 6,
        tableNumber: "7",
        staffNote: "anniversary",
      }),
    );

    expect(summariseChanges(changes)).toBe(
      "Date 2026-08-25 → 2026-08-26; Arrival set to 19:00; Party 4 → 6 and 2 more",
    );
  });

  it("says so plainly when there is nothing to report", () => {
    expect(summariseChanges([])).toBe("No changes");
  });
});
