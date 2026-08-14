import { describe, expect, it } from "vitest";
import {
  buildCourseColumns,
  buildGuestCsv,
  buildGuestRows,
  buildOptionColumns,
  buildOptionTotals,
  buildRoomCsv,
  buildRoomRows,
  countDeclined,
  countPlates,
  groupOptionColumns,
} from "@/lib/kitchen-report";
import { NONE_OPTION_ID, NONE_OPTION_NAME } from "@/lib/menu-selection";
import type { MenuCourse, ReservationRecord } from "@/types/booking";

function course(id: string, name: string, order: number, options: [string, string][]): MenuCourse {
  return {
    id,
    order,
    name,
    description: "",
    required: true,
    active: true,
    options: options.map(([optionId, optionName]) => ({
      id: optionId,
      courseId: id,
      name: optionName,
      description: "",
      allergens: [],
      active: true,
    })),
  };
}

const menu = [
  course("c1", "Starter", 1, [
    ["o1", "Salmon"],
    ["o2", "Velouté"],
  ]),
  course("c2", "Main", 2, [
    ["o3", "Duck"],
    ["o4", "Sea bream"],
  ]),
];

function pick(guestIndex: number, courseId: string, courseName: string, optionId: string, optionName: string) {
  return { guestIndex, courseId, courseName, optionId, optionName };
}

const roomWithTwo: ReservationRecord = {
  reservationNumber: "ALC-AAA111",
  roomNumber: "402",
  guestCount: 2,
  date: "2026-08-18",
  status: "confirmed",
  tableNumber: "4",
  tableGroupId: "ALC-AAA111",
  notes: "No nuts",
  selections: [
    pick(0, "c1", "Starter", "o1", "Salmon"),
    pick(0, "c2", "Main", "o3", "Duck"),
    pick(1, "c1", "Starter", "o2", "Velouté"),
    pick(1, "c2", "Main", "o3", "Duck"),
  ],
};

const roomSharingTable: ReservationRecord = {
  reservationNumber: "ALC-BBB222",
  roomNumber: "118",
  guestCount: 1,
  date: "2026-08-18",
  status: "confirmed",
  tableNumber: "4",
  tableGroupId: "ALC-AAA111",
  selections: [pick(0, "c1", "Starter", "o1", "Salmon"), pick(0, "c2", "Main", "o4", "Sea bream")],
};

/** A guest who wants a main but no starter. */
const roomDecliningACourse: ReservationRecord = {
  reservationNumber: "ALC-CCC333",
  roomNumber: "210",
  guestCount: 1,
  date: "2026-08-18",
  status: "confirmed",
  tableNumber: "7",
  selections: [
    pick(0, "c1", "Starter", NONE_OPTION_ID, NONE_OPTION_NAME),
    pick(0, "c2", "Main", "o3", "Duck"),
  ],
};

describe("course columns (per-guest sheet)", () => {
  it("uses menu order", () => {
    expect(buildCourseColumns([], menu).map((column) => column.label)).toEqual(["Starter", "Main"]);
  });

  it("keeps a course that only exists in an older reservation", () => {
    const legacy: ReservationRecord = {
      ...roomWithTwo,
      selections: [pick(0, "c9", "Cheese board", "o9", "Selection")],
    };

    expect(buildCourseColumns([legacy], menu).map((column) => column.label)).toContain("Cheese board");
  });
});

describe("per-guest sheet", () => {
  const columns = buildCourseColumns([roomWithTwo], menu);
  const rows = buildGuestRows([roomWithTwo], columns);

  it("produces one row per diner", () => {
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.guests)).toEqual(["1 of 2", "2 of 2"]);
  });

  it("puts each guest's own choice in the course column", () => {
    expect(rows[0].choices.c1).toBe("Salmon");
    expect(rows[1].choices.c1).toBe("Velouté");
  });

  it("shows the booking comment once", () => {
    expect(rows[0].comment).toBe("No nuts");
    expect(rows[1].comment).toBe("");
  });

  it("names a declined course rather than leaving it blank", () => {
    const declinedRows = buildGuestRows([roomDecliningACourse], columns);
    expect(declinedRows[0].choices.c1).toBe(NONE_OPTION_NAME);
    expect(declinedRows[0].choices.c2).toBe("Duck");
  });
});

describe("option columns (per-room sheet)", () => {
  it("gives every menu option a column, grouped under its course", () => {
    const columns = buildOptionColumns([], menu);

    expect(columns.map((column) => column.label)).toEqual(["Salmon", "Velouté", "Duck", "Sea bream"]);
    expect(groupOptionColumns(columns).map((group) => group.courseName)).toEqual(["Starter", "Main"]);
  });

  /** Nobody cooks "None", so it must never take a column. */
  it("never gives None a column", () => {
    const columns = buildOptionColumns([roomDecliningACourse], menu);
    expect(columns.some((column) => column.id === NONE_OPTION_ID)).toBe(false);
  });

  it("keeps an option withdrawn from the menu if a booking chose it", () => {
    const legacy: ReservationRecord = {
      ...roomWithTwo,
      selections: [pick(0, "c2", "Main", "o99", "Retired lamb dish")],
    };

    expect(buildOptionColumns([legacy], menu).map((column) => column.label)).toContain("Retired lamb dish");
  });
});

describe("per-room counts", () => {
  const reservations = [roomWithTwo, roomSharingTable, roomDecliningACourse];
  const columns = buildOptionColumns(reservations, menu);
  const rows = buildRoomRows(reservations, columns);

  it("produces one row per room", () => {
    expect(rows).toHaveLength(3);
  });

  it("counts how many of each dish a room needs", () => {
    const room402 = rows.find((row) => row.room === "402")!;

    expect(room402.counts.o1).toBe(1); // one Salmon
    expect(room402.counts.o2).toBe(1); // one Velouté
    expect(room402.counts.o3).toBe(2); // both mains are Duck
    expect(room402.counts.o4).toBe(0);
  });

  it("counts nothing for a declined course", () => {
    const room210 = rows.find((row) => row.room === "210")!;

    expect(room210.counts.o1).toBe(0);
    expect(room210.counts.o2).toBe(0);
    expect(room210.counts.o3).toBe(1);
  });

  it("totals each dish across the whole service", () => {
    const totals = buildOptionTotals(rows, columns);

    expect(totals.o1).toBe(2); // 402 and 118
    expect(totals.o2).toBe(1);
    expect(totals.o3).toBe(3); // 402 twice, 210 once
    expect(totals.o4).toBe(1);
    // Seven, not eight: four diners × two courses, less one declined starter.
    expect(countPlates(totals)).toBe(7);
    expect(countDeclined(reservations)).toBe(1);
  });

  it("leaves cancelled bookings out of the totals", () => {
    const withCancelled = [...reservations, { ...roomWithTwo, reservationNumber: "ALC-XXX", status: "cancelled" as const }];
    const cancelledRows = buildRoomRows(withCancelled, columns);

    expect(buildOptionTotals(cancelledRows, columns).o3).toBe(3);
  });
});

describe("shared tables", () => {
  it("keeps rooms at the same table together, then orders by table", () => {
    const reservations = [roomDecliningACourse, roomSharingTable, roomWithTwo];
    const rows = buildRoomRows(reservations, buildOptionColumns(reservations, menu));

    expect(rows.map((row) => row.room)).toEqual(["118", "402", "210"]);
    expect(rows.map((row) => row.table)).toEqual(["4", "4", "7"]);
  });

  it("sorts rooms with no table last", () => {
    const unassigned: ReservationRecord = { ...roomWithTwo, reservationNumber: "ALC-DDD", tableNumber: undefined };
    const rows = buildRoomRows([unassigned, roomSharingTable], buildOptionColumns([], menu));

    expect(rows[rows.length - 1].table).toBe("");
  });
});

describe("csv export", () => {
  const reservations = [roomWithTwo, roomSharingTable, roomDecliningACourse];

  it("starts with a BOM so Excel reads it as UTF-8", () => {
    const columns = buildCourseColumns(reservations, menu);
    // Without this, accented and Cyrillic dish names are mangled on open.
    expect(buildGuestCsv(columns, buildGuestRows(reservations, columns)).charCodeAt(0)).toBe(0xfeff);
  });

  it("writes the per-guest sheet one line per diner", () => {
    const columns = buildCourseColumns(reservations, menu);
    const csv = buildGuestCsv(columns, buildGuestRows(reservations, columns));
    const lines = csv.trimEnd().split("\r\n");

    expect(lines[0]).toBe("﻿Table,Room,Guest,Starter,Main,Comment,Status");
    expect(lines).toHaveLength(5); // header + 4 diners
  });

  it("writes the per-room sheet as counts under two header rows", () => {
    const columns = buildOptionColumns(reservations, menu);
    const rows = buildRoomRows(reservations, columns);
    const csv = buildRoomCsv(columns, rows, buildOptionTotals(rows, columns));
    const lines = csv.trimEnd().split("\r\n");

    expect(lines[0]).toBe("﻿,,,Starter,Starter,Main,Main,,");
    expect(lines[1]).toBe("Table,Room,Guests,Salmon,Velouté,Duck,Sea bream,Comment,Status");
    // Room 402: one Salmon, one Velouté, two Duck, no Sea bream.
    expect(lines.find((line) => line.startsWith("4,402"))).toBe("4,402,2,1,1,2,,No nuts,confirmed");
  });

  it("finishes with the total the kitchen prepares", () => {
    const columns = buildOptionColumns(reservations, menu);
    const rows = buildRoomRows(reservations, columns);
    const csv = buildRoomCsv(columns, rows, buildOptionTotals(rows, columns));
    const lines = csv.trimEnd().split("\r\n");

    expect(lines[lines.length - 1]).toBe("TOTAL,,4,2,1,3,1,,");
  });

  it("quotes values containing separators", () => {
    const noisy: ReservationRecord = { ...roomWithTwo, notes: 'Allergy: nuts, "severe"' };
    const columns = buildCourseColumns([noisy], menu);

    expect(buildGuestCsv(columns, buildGuestRows([noisy], columns))).toContain('"Allergy: nuts, ""severe"""');
  });

  it("marks cancelled bookings", () => {
    const cancelled: ReservationRecord = { ...roomWithTwo, status: "cancelled" };
    const columns = buildCourseColumns([cancelled], menu);

    expect(buildGuestCsv(columns, buildGuestRows([cancelled], columns))).toContain("CANCELLED");
  });
});
