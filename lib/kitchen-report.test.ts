import { describe, expect, it } from "vitest";
import { canonicalizeSelections } from "@/lib/menu-selection";
import {
  buildCourseColumns,
  chooseSheetPrintSize,
  buildPrepList,
  groupRoomRowsByTable,
  buildGuestCsv,
  buildGuestRows,
  buildOptionColumns,
  buildOptionTotals,
  buildCombinedTableRows,
  buildTableCsv,
  buildRoomRows,
  countDeclined,
  countPlates,
  groupOptionColumns,
} from "@/lib/kitchen-report";
import { NONE_OPTION_ID, NONE_OPTION_NAME } from "@/lib/menu-selection";
import type { MenuCourse, ReservationRecord } from "@/types/booking";

/** Excel needs this to read the file as UTF-8. */
const BOM = "﻿";

/** Splits on CRLF, which is what the CSV writer emits. */
function splitCsvLines(csv: string) {
  return csv.trimEnd().split(String.fromCharCode(13, 10));
}

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

  /**
   * A ticket may name several rooms on one line. They are one booking, so the
   * sheet has to name all of them — a waiter looking for room 405 has to find
   * it, and it reads the same as a table rooms joined themselves.
   */
  it("names every room on a booking taken from one ticket", () => {
    const ticket: ReservationRecord = {
      ...roomWithTwo,
      reservationNumber: "ALC-TICKET",
      additionalRooms: ["405"],
      tableGroupId: undefined,
    };

    const rows = buildRoomRows([ticket], buildOptionColumns([ticket], menu));
    expect(rows[0].room).toBe("402 + 405");
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
    const lines = splitCsvLines(csv);

    expect(lines[0]).toBe(`${BOM}Table,Room,Guest,Starter,Main,Comment,Status`);
    expect(lines).toHaveLength(5); // header + 4 diners
  });

  it("writes the per-table sheet as counts under two header rows", () => {
    const columns = buildOptionColumns(reservations, menu);
    const rows = buildCombinedTableRows(
      groupRoomRowsByTable(buildRoomRows(reservations, columns), columns),
      columns,
    );
    const csv = buildTableCsv(columns, rows, buildOptionTotals(buildRoomRows(reservations, columns), columns));
    const lines = splitCsvLines(csv);

    expect(lines[0]).toBe(`${BOM},,,Starter,Starter,Main,Main,,`);
    expect(lines[1]).toBe("Table,Rooms,Guests,Salmon,Velouté,Duck,Sea bream,Comment,Status");
    // Rooms 118 and 402 share table 4, so they are one line with combined counts.
    expect(lines[2]).toBe("4,118 + 402,3,2,1,2,1,402: No nuts,confirmed");
  });

  it("finishes with the total the kitchen prepares", () => {
    const columns = buildOptionColumns(reservations, menu);
    const roomRows = buildRoomRows(reservations, columns);
    const rows = buildCombinedTableRows(groupRoomRowsByTable(roomRows, columns), columns);
    const csv = buildTableCsv(columns, rows, buildOptionTotals(roomRows, columns));
    const lines = splitCsvLines(csv);

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

describe("dish names for staff", () => {
  /**
   * A guest booking in Bulgarian sends Bulgarian labels. The kitchen sheet has
   * to read in one language, so names are resolved from the English menu.
   */
  it("rewrites names booked in another language to English", () => {
    const bookedInBulgarian = [
      { guestIndex: 0, courseId: "c1", courseName: "Предястие", optionId: "o1", optionName: "Сьомга" },
      { guestIndex: 0, courseId: "c2", courseName: "Основно", optionId: "o3", optionName: "Патица" },
    ];

    const resolved = canonicalizeSelections(bookedInBulgarian, menu);

    expect(resolved.map((entry) => entry.courseName)).toEqual(["Starter", "Main"]);
    expect(resolved.map((entry) => entry.optionName)).toEqual(["Salmon", "Duck"]);
  });

  it("keeps the booked name for a dish no longer on the menu", () => {
    const retired = [{ guestIndex: 0, courseId: "c9", courseName: "Cheese", optionId: "o9", optionName: "Stilton" }];

    expect(canonicalizeSelections(retired, menu)[0].optionName).toBe("Stilton");
  });

  it("always calls a declined course None", () => {
    const declined = [
      { guestIndex: 0, courseId: "c1", courseName: "Предястие", optionId: NONE_OPTION_ID, optionName: "Няма" },
    ];

    expect(canonicalizeSelections(declined, menu)[0].optionName).toBe(NONE_OPTION_NAME);
  });
});

describe("tables dining together", () => {
  const reservations = [roomWithTwo, roomSharingTable, roomDecliningACourse];
  const columns = buildOptionColumns(reservations, menu);
  const rows = buildRoomRows(reservations, columns);
  const groups = groupRoomRowsByTable(rows, columns);

  it("puts rooms at the same table in one group", () => {
    expect(groups).toHaveLength(2);
    expect(groups[0].rows.map((row) => row.room)).toEqual(["118", "402"]);
    expect(groups[0].isShared).toBe(true);
    expect(groups[1].isShared).toBe(false);
  });

  /** What the waiter carries to that table in one trip. */
  it("sums each dish across the rooms sharing a table", () => {
    const shared = groups[0].subtotals;

    expect(shared.o1).toBe(2); // 402's Salmon plus 118's
    expect(shared.o2).toBe(1);
    expect(shared.o3).toBe(2); // both of 402's Duck mains
    expect(shared.o4).toBe(1); // 118's Sea bream
    expect(groups[0].guests).toBe(3);
  });

  it("leaves a cancelled room out of the table subtotal", () => {
    const withCancelled = [{ ...roomWithTwo, status: "cancelled" as const }, roomSharingTable];
    const cancelledGroups = groupRoomRowsByTable(buildRoomRows(withCancelled, columns), columns);

    expect(cancelledGroups[0].subtotals.o3).toBe(0);
    expect(cancelledGroups[0].guests).toBe(1);
  });
});

describe("kitchen prep slip", () => {
  const reservations = [roomWithTwo, roomSharingTable, roomDecliningACourse];
  const columns = buildOptionColumns(reservations, menu);
  const totals = buildOptionTotals(buildRoomRows(reservations, columns), columns);

  it("lists every dish that has to be made, with its count", () => {
    expect(buildPrepList(columns, totals)).toEqual([
      { courseName: "Starter", optionName: "Salmon", quantity: 2 },
      { courseName: "Starter", optionName: "Velouté", quantity: 1 },
      { courseName: "Main", optionName: "Duck", quantity: 3 },
      { courseName: "Main", optionName: "Sea bream", quantity: 1 },
    ]);
  });

  /** Nothing to cook means nothing on the slip. */
  it("omits dishes nobody ordered", () => {
    const onlySalmon = [
      { ...roomSharingTable, selections: [pick(0, "c1", "Starter", "o1", "Salmon")], guestCount: 1 },
    ];
    const onlyColumns = buildOptionColumns(onlySalmon, menu);
    const onlyTotals = buildOptionTotals(buildRoomRows(onlySalmon, onlyColumns), onlyColumns);

    expect(buildPrepList(onlyColumns, onlyTotals)).toEqual([
      { courseName: "Starter", optionName: "Salmon", quantity: 1 },
    ]);
  });
});

describe("rooms combined onto one table", () => {
  const reservations = [roomWithTwo, roomSharingTable, roomDecliningACourse];
  const columns = buildOptionColumns(reservations, menu);
  const rows = buildCombinedTableRows(
    groupRoomRowsByTable(buildRoomRows(reservations, columns), columns),
    columns,
  );

  it("produces one row per table, not per room", () => {
    expect(rows).toHaveLength(2);
  });

  it("lists every room sharing the table", () => {
    expect(rows[0].rooms).toEqual(["118", "402"]);
    expect(rows[0].isShared).toBe(true);
    expect(rows[1].rooms).toEqual(["210"]);
    expect(rows[1].isShared).toBe(false);
  });

  /** The whole point: one number per dish for the table. */
  it("combines the menu choices across the table", () => {
    expect(rows[0].counts.o1).toBe(2);
    expect(rows[0].counts.o2).toBe(1);
    expect(rows[0].counts.o3).toBe(2);
    expect(rows[0].counts.o4).toBe(1);
    expect(rows[0].guests).toBe(3);
  });

  it("keeps each room's comment attributed to it", () => {
    expect(rows[0].comments).toEqual([{ room: "402", note: "No nuts" }]);
  });

  it("keeps every booking reachable for cancelling", () => {
    expect(rows[0].members.map((member) => member.room)).toEqual(["118", "402"]);
  });

  it("leaves a cancelled room out of the combined counts", () => {
    const withCancelled = [{ ...roomWithTwo, status: "cancelled" as const }, roomSharingTable];
    const cancelledRows = buildCombinedTableRows(
      groupRoomRowsByTable(buildRoomRows(withCancelled, columns), columns),
      columns,
    );

    // Only 118's single Salmon and Sea bream remain.
    expect(cancelledRows[0].counts.o3).toBe(0);
    expect(cancelledRows[0].counts.o4).toBe(1);
    expect(cancelledRows[0].guests).toBe(1);
    expect(cancelledRows[0].cancelled).toBe(false);
  });
});

describe("fitting the sheet on one page", () => {
  it("prints a quiet evening large", () => {
    expect(chooseSheetPrintSize({ rows: 10, dishColumns: 6 })).toBe("lg");
  });

  it("steps down as the tables fill up", () => {
    const sizes = [12, 24, 34, 44].map((rows) => chooseSheetPrintSize({ rows, dishColumns: 10 }));

    // Never larger than the row before it, and never off the bottom of the page.
    expect(sizes).toEqual([...sizes].sort((a, b) => "lgmdsmxs".indexOf(a) - "lgmdsmxs".indexOf(b)));
    expect(new Set(sizes).size).toBeGreaterThan(1);
  });

  it("steps down when a long menu narrows the dish columns", () => {
    expect(chooseSheetPrintSize({ rows: 8, dishColumns: 24 })).toBe("xs");
  });

  /** A sheet spread over two pages is worse than a small one. */
  it("never gives up and grows a second page", () => {
    expect(chooseSheetPrintSize({ rows: 200, dishColumns: 60 })).toBe("xs");
  });
});
