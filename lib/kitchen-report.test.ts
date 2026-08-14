import { describe, expect, it } from "vitest";
import { buildKitchenColumns, buildKitchenCsv, buildKitchenRows } from "@/lib/kitchen-report";
import type { MenuCourse, ReservationRecord } from "@/types/booking";

function course(id: string, name: string, order: number): MenuCourse {
  return { id, order, name, description: "", required: true, active: true, options: [] };
}

const menu = [course("c1", "Starter", 1), course("c2", "Main", 2), course("c3", "Dessert", 3)];

function selection(guestIndex: number, courseId: string, courseName: string, optionName: string) {
  return { guestIndex, courseId, courseName, optionId: `${courseId}-${optionName}`, optionName };
}

const roomWithTwo: ReservationRecord = {
  reservationNumber: "ALC-AAA111",
  roomNumber: 402,
  guestCount: 2,
  date: "2026-08-18",
  status: "confirmed",
  tableNumber: "4",
  tableGroupId: "ALC-AAA111",
  notes: "No nuts",
  selections: [
    selection(0, "c1", "Starter", "Salmon"),
    selection(0, "c2", "Main", "Duck"),
    selection(0, "c3", "Dessert", "Ganache"),
    selection(1, "c1", "Starter", "Velouté"),
    selection(1, "c2", "Main", "Duck"),
    selection(1, "c3", "Dessert", "Brûlée"),
  ],
};

const roomSharingTable: ReservationRecord = {
  reservationNumber: "ALC-BBB222",
  roomNumber: 118,
  guestCount: 1,
  date: "2026-08-18",
  status: "confirmed",
  tableNumber: "4",
  tableGroupId: "ALC-AAA111",
  selections: [
    selection(0, "c1", "Starter", "Salmon"),
    selection(0, "c2", "Main", "Sea bream"),
    selection(0, "c3", "Dessert", "Ganache"),
  ],
};

describe("kitchen columns", () => {
  it("uses menu order", () => {
    expect(buildKitchenColumns([], menu).map((column) => column.label)).toEqual(["Starter", "Main", "Dessert"]);
  });

  /** A dish pulled from the menu must still print for bookings that chose it. */
  it("keeps a course that only exists in an older reservation", () => {
    const legacy: ReservationRecord = {
      ...roomWithTwo,
      selections: [selection(0, "c9", "Cheese board", "Selection")],
    };

    expect(buildKitchenColumns([legacy], menu).map((column) => column.label)).toEqual([
      "Starter",
      "Main",
      "Dessert",
      "Cheese board",
    ]);
  });
});

describe("per-guest layout", () => {
  const columns = buildKitchenColumns([roomWithTwo], menu);
  const rows = buildKitchenRows([roomWithTwo], columns, "guest");

  it("produces one row per diner", () => {
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.guests)).toEqual(["1 of 2", "2 of 2"]);
  });

  it("puts each guest's own choice in the course column", () => {
    expect(rows[0].choices.c1).toBe("Salmon");
    expect(rows[1].choices.c1).toBe("Velouté");
    expect(rows[1].choices.c2).toBe("Duck");
  });

  it("repeats the table and room on every line", () => {
    expect(rows.every((row) => row.table === "4" && row.room === 402)).toBe(true);
  });

  /** The note belongs to the booking, not to each diner. */
  it("shows the comment once", () => {
    expect(rows[0].comment).toBe("No nuts");
    expect(rows[1].comment).toBe("");
  });

  it("leaves a gap when a guest has no choice for a course", () => {
    const partial: ReservationRecord = { ...roomWithTwo, selections: [selection(0, "c1", "Starter", "Salmon")] };
    const partialRows = buildKitchenRows([partial], columns, "guest");

    expect(partialRows[0].choices.c2).toBe("");
  });
});

describe("per-booking layout", () => {
  const columns = buildKitchenColumns([roomWithTwo], menu);
  const rows = buildKitchenRows([roomWithTwo], columns, "booking");

  it("produces one row per room", () => {
    expect(rows).toHaveLength(1);
    expect(rows[0].guests).toBe("2");
  });

  it("lists every choice, collapsing duplicates with a count", () => {
    expect(rows[0].choices.c1).toBe("Salmon, Velouté");
    expect(rows[0].choices.c2).toBe("Duck ×2");
  });
});

describe("shared tables", () => {
  it("keeps rooms at the same table together and in room order", () => {
    const other: ReservationRecord = {
      ...roomWithTwo,
      reservationNumber: "ALC-CCC333",
      roomNumber: 210,
      guestCount: 1,
      tableNumber: "7",
      tableGroupId: undefined,
      selections: [selection(0, "c1", "Starter", "Salmon")],
    };

    const columns = buildKitchenColumns([other, roomSharingTable, roomWithTwo], menu);
    const rows = buildKitchenRows([other, roomSharingTable, roomWithTwo], columns, "booking");

    expect(rows.map((row) => row.room)).toEqual([118, 402, 210]);
    expect(rows.map((row) => row.table)).toEqual(["4", "4", "7"]);
  });

  it("sorts unassigned tables last", () => {
    const unassigned: ReservationRecord = { ...roomWithTwo, reservationNumber: "ALC-DDD444", tableNumber: undefined };
    const rows = buildKitchenRows([unassigned, roomSharingTable], buildKitchenColumns([], menu), "booking");

    expect(rows[rows.length - 1].table).toBe("");
  });
});

describe("csv export", () => {
  const columns = buildKitchenColumns([roomWithTwo], menu);
  const rows = buildKitchenRows([roomWithTwo], columns, "guest");
  const csv = buildKitchenCsv(columns, rows, "guest");

  it("starts with a BOM so Excel reads it as UTF-8", () => {
    // Without this, accented and Cyrillic dish names are mangled on open.
    expect(csv.charCodeAt(0)).toBe(0xfeff);
  });

  it("writes the header the kitchen sheet expects", () => {
    expect(csv.split("\r\n")[0]).toBe("﻿Table,Room,Guest,Starter,Main,Dessert,Comment,Status");
  });

  it("writes one line per guest", () => {
    const lines = csv.trimEnd().split("\r\n");
    expect(lines).toHaveLength(3);
    expect(lines[1]).toContain("Salmon");
    expect(lines[2]).toContain("Velouté");
  });

  it("quotes values containing separators", () => {
    const noisy: ReservationRecord = { ...roomWithTwo, notes: 'Allergy: nuts, "severe"' };
    const noisyCsv = buildKitchenCsv(columns, buildKitchenRows([noisy], columns, "guest"), "guest");

    expect(noisyCsv).toContain('"Allergy: nuts, ""severe"""');
  });

  it("marks cancelled bookings", () => {
    const cancelled: ReservationRecord = { ...roomWithTwo, status: "cancelled" };
    const cancelledCsv = buildKitchenCsv(columns, buildKitchenRows([cancelled], columns, "guest"), "guest");

    expect(cancelledCsv).toContain("CANCELLED");
  });
});
