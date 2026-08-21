import { isNoneSelection, NONE_OPTION_ID } from "@/lib/menu-selection";
import { compareRoomNumbers, formatRoomList } from "@/lib/room";
import { sortReservationsBy, type ReservationOrder } from "@/lib/reservation-order";
import type { MenuCourse, ReservationRecord } from "@/types/booking";

/**
 * Turns a day's reservations into the sheets the kitchen works from.
 *
 * Two views, answering different questions:
 * - "guest": one line per diner naming their dishes — the plating list.
 * - "room": one line per room with a column per *option* and a count in each
 *   cell, totalled at the bottom. That bottom row is the prep list: how many
 *   of every dish the kitchen has to make.
 */

export type KitchenLayout = "guest" | "room";

/** One column per course, used by the per-guest sheet. */
export type CourseColumn = { id: string; label: string };

/** One column per option, grouped under its course, for the per-room sheet. */
export type OptionColumn = { id: string; label: string; courseId: string; courseName: string };

export type GuestRow = {
  key: string;
  reservationNumber: string;
  table: string;
  room: string;
  guests: string;
  choices: Record<string, string>;
  comment: string;
  /**
   * Promotions this booking took on the confirmation screen — a bottle of
   * wine, a dessert. Named rather than counted, and kept apart from `choices`,
   * because nothing here is a plate: it must never reach the kitchen's totals.
   */
  extras: string[];
  /** When the booking was taken. Absent on records predating the field. */
  bookedAt?: string;
  cancelled: boolean;
  tableGroupId?: string;
};

export type RoomRow = {
  key: string;
  reservationNumber: string;
  table: string;
  room: string;
  guests: number;
  /** Option id -> how many of it this room needs. Zero means nothing to plate. */
  counts: Record<string, number>;
  comment: string;
  /** Promotions to bring to the table. Never plates, never counted as such. */
  extras: string[];
  /** When the booking was taken. Absent on records predating the field. */
  bookedAt?: string;
  cancelled: boolean;
  tableGroupId?: string;
};

/**
 * How a booking is identified on the sheet: the room for a hotel guest, the
 * guest's own name for an invited one, who has no room yet.
 *
 * A booking taken from a ticket may carry several rooms on one table, and all of
 * them belong here — a waiter looking for room 405 has to find it, and the sheet
 * has always shown a shared table as "402 + 405".
 */
export function reservationLabel(
  reservation: Pick<ReservationRecord, "roomNumber" | "guestName" | "additionalRooms">,
) {
  return (
    formatRoomList(reservation.roomNumber, reservation.additionalRooms) ||
    reservation.guestName?.trim() ||
    "—"
  );
}

/**
 * The order rows appear in.
 *
 * `service` is the sheet's own: table, then group, then room — the order a
 * waiter walks the room in, and the only one that makes a shared table read as
 * one thing. Anything else is "when did this come in?", which is a different
 * question with a different answer, and lives in `lib/reservation-order.ts`.
 */
function sortReservations(reservations: ReservationRecord[], order: ReservationOrder = "service") {
  if (order !== "service") {
    return sortReservationsBy(reservations, order);
  }

  return reservations.slice().sort((a, b) => {
    // Rooms sharing a table sit next to each other on the sheet.
    const tableA = a.tableNumber ?? "";
    const tableB = b.tableNumber ?? "";
    if (tableA !== tableB) {
      if (!tableA) return 1;
      if (!tableB) return -1;
      return tableA.localeCompare(tableB, undefined, { numeric: true });
    }

    const groupA = a.tableGroupId ?? a.reservationNumber;
    const groupB = b.tableGroupId ?? b.reservationNumber;
    if (groupA !== groupB) {
      return groupA.localeCompare(groupB);
    }

    return compareRoomNumbers(reservationLabel(a), reservationLabel(b));
  });
}

/**
 * A column per course, in menu order, plus any course that only appears in
 * older reservations — so a dish removed from the menu still prints on the
 * sheet for bookings that chose it.
 */
export function buildCourseColumns(reservations: ReservationRecord[], menu: MenuCourse[]): CourseColumn[] {
  const columns: CourseColumn[] = menu
    .slice()
    .sort((a, b) => a.order - b.order)
    .map((course) => ({ id: course.id, label: course.name }));

  const known = new Set(columns.map((column) => column.id));

  for (const reservation of reservations) {
    for (const selection of reservation.selections) {
      if (!known.has(selection.courseId)) {
        known.add(selection.courseId);
        columns.push({ id: selection.courseId, label: selection.courseName });
      }
    }
  }

  return columns;
}

/**
 * A column per option the kitchen might have to prepare.
 *
 * "None" never gets a column: nobody cooks it. Options withdrawn from the menu
 * still appear if a live booking chose them.
 */
export function buildOptionColumns(reservations: ReservationRecord[], menu: MenuCourse[]): OptionColumn[] {
  const columns: OptionColumn[] = [];
  const known = new Set<string>();

  for (const course of menu.slice().sort((a, b) => a.order - b.order)) {
    for (const option of course.options) {
      if (!option.active || known.has(option.id)) {
        continue;
      }
      known.add(option.id);
      columns.push({ id: option.id, label: option.name, courseId: course.id, courseName: course.name });
    }
  }

  for (const reservation of sortReservations(reservations)) {
    for (const selection of reservation.selections) {
      if (isNoneSelection(selection) || known.has(selection.optionId)) {
        continue;
      }
      known.add(selection.optionId);
      columns.push({
        id: selection.optionId,
        label: selection.optionName,
        courseId: selection.courseId,
        courseName: selection.courseName,
      });
    }
  }

  return columns;
}

/** Options grouped by course, so the sheet can span a header over each group. */
export function groupOptionColumns(columns: OptionColumn[]) {
  const groups: { courseId: string; courseName: string; options: OptionColumn[] }[] = [];

  for (const column of columns) {
    const last = groups[groups.length - 1];
    if (last && last.courseId === column.courseId) {
      last.options.push(column);
    } else {
      groups.push({ courseId: column.courseId, courseName: column.courseName, options: [column] });
    }
  }

  return groups;
}

/**
 * The promotions on a booking, as short labels a waiter can read at a glance.
 *
 * Deliberately not resolved against the menu the way dishes are (rule 2.6):
 * promotions are already stored in English, priced and named as they were
 * agreed, and the catalogue they came from may have changed since. What the
 * guest agreed to is what goes to the table.
 */
export function extrasOf(reservation: ReservationRecord): string[] {
  return (reservation.addOns ?? []).map((addOn) => addOn.optionName);
}

export function buildGuestRows(
  reservations: ReservationRecord[],
  columns: CourseColumn[],
  order: ReservationOrder = "service",
): GuestRow[] {
  const rows: GuestRow[] = [];

  for (const reservation of sortReservations(reservations, order)) {
    for (let guestIndex = 0; guestIndex < Math.max(reservation.guestCount, 1); guestIndex += 1) {
      const choices: Record<string, string> = {};

      for (const column of columns) {
        const selection = reservation.selections.find(
          (entry) => (entry.guestIndex ?? 0) === guestIndex && entry.courseId === column.id,
        );
        choices[column.id] = selection?.optionName ?? "";
      }

      rows.push({
        key: `${reservation.reservationNumber}-${guestIndex}`,
        reservationNumber: reservation.reservationNumber,
        table: reservation.tableNumber ?? "",
        room: reservationLabel(reservation),
        guests: `${guestIndex + 1} of ${reservation.guestCount}`,
        choices,
        // The note belongs to the booking; repeating it on every line would
        // have the kitchen read the same allergy warning several times.
        comment: guestIndex === 0 ? (reservation.notes ?? "") : "",
        // Like the note: it belongs to the booking, not to each guest on it.
        extras: guestIndex === 0 ? extrasOf(reservation) : [],
        bookedAt: guestIndex === 0 ? reservation.createdAt : undefined,
        cancelled: reservation.status === "cancelled",
        tableGroupId: reservation.tableGroupId,
      });
    }
  }

  return rows;
}

export function buildRoomRows(
  reservations: ReservationRecord[],
  columns: OptionColumn[],
  order: ReservationOrder = "service",
): RoomRow[] {
  return sortReservations(reservations, order).map((reservation) => {
    const counts: Record<string, number> = {};
    for (const column of columns) {
      counts[column.id] = 0;
    }

    for (const selection of reservation.selections) {
      if (selection.optionId in counts) {
        counts[selection.optionId] += 1;
      }
    }

    return {
      key: reservation.reservationNumber,
      reservationNumber: reservation.reservationNumber,
      table: reservation.tableNumber ?? "",
      room: reservationLabel(reservation),
      guests: reservation.guestCount,
      counts,
      comment: reservation.notes ?? "",
      extras: extrasOf(reservation),
      bookedAt: reservation.createdAt,
      cancelled: reservation.status === "cancelled",
      tableGroupId: reservation.tableGroupId,
    };
  });
}

/**
 * What the kitchen has to prepare. Cancelled bookings are left out — nobody
 * cooks for a table that is not coming.
 */
export function buildOptionTotals(rows: RoomRow[], columns: OptionColumn[]) {
  const totals: Record<string, number> = {};

  for (const column of columns) {
    totals[column.id] = rows
      .filter((row) => !row.cancelled)
      .reduce((sum, row) => sum + (row.counts[column.id] ?? 0), 0);
  }

  return totals;
}

/**
 * The per-room sheet grouped by table.
 *
 * Rooms dining together share a table, and the kitchen plates per table — so
 * each group carries its own subtotal of every dish, which is what a waiter
 * carries out in one trip.
 */
export type TableGroup = {
  key: string;
  /** Blank when no table has been assigned yet. */
  table: string;
  rows: RoomRow[];
  /** Option id -> how many of it this table needs. */
  subtotals: Record<string, number>;
  guests: number;
  /** More than one room sitting together. */
  isShared: boolean;
};

export function groupRoomRowsByTable(rows: RoomRow[], columns: OptionColumn[]): TableGroup[] {
  const groups: TableGroup[] = [];

  for (const row of rows) {
    // Rooms are one table when they share a number, or asked to sit together
    // before a number was assigned.
    const key = row.table || row.tableGroupId || row.reservationNumber;
    const last = groups[groups.length - 1];

    if (last && last.key === key) {
      last.rows.push(row);
    } else {
      groups.push({ key, table: row.table, rows: [row], subtotals: {}, guests: 0, isShared: false });
    }
  }

  for (const group of groups) {
    const live = group.rows.filter((row) => !row.cancelled);

    group.isShared = group.rows.length > 1;
    group.guests = live.reduce((sum, row) => sum + row.guests, 0);

    for (const column of columns) {
      group.subtotals[column.id] = live.reduce((sum, row) => sum + (row.counts[column.id] ?? 0), 0);
    }
  }

  return groups;
}

/**
 * One row per *table* rather than per room.
 *
 * Rooms dining together are served as a single table, so their choices are
 * combined into one line and the Room column lists everyone on it. Reading two
 * separate lines and adding them up in your head was the thing that made a
 * shared table hard to see.
 */
export type CombinedTableRow = {
  key: string;
  table: string;
  /** Every room on this table, in reading order. */
  rooms: string[];
  guests: number;
  counts: Record<string, number>;
  comments: { room: string; note: string }[];
  /**
   * Promotions to bring, attributed to the room that ordered them — on a
   * shared table two rooms may have ordered different bottles, and the waiter
   * has to know which is whose.
   */
  extras: { room: string; items: string[] }[];
  /**
   * When the table was first booked — the earliest of its rooms.
   *
   * The earliest rather than the latest because a shared table exists from the
   * moment the first room took it; the rooms that joined afterwards are why it
   * is shared, not when it began.
   */
  bookedAt?: string;
  /** The bookings behind the row, for the per-reservation actions. */
  members: { reservationNumber: string; room: string; cancelled: boolean }[];
  isShared: boolean;
  /** True only when every booking on the table is cancelled. */
  cancelled: boolean;
};

export function buildCombinedTableRows(groups: TableGroup[], columns: OptionColumn[]): CombinedTableRow[] {
  return groups.map((group) => {
    const live = group.rows.filter((row) => !row.cancelled);
    // A table with a cancellation still shows the remaining rooms' food.
    const counted = live.length > 0 ? live : [];
    const counts: Record<string, number> = {};

    for (const column of columns) {
      counts[column.id] = counted.reduce((sum, row) => sum + (row.counts[column.id] ?? 0), 0);
    }

    return {
      key: group.key,
      table: group.table,
      rooms: group.rows.map((row) => row.room),
      guests: group.guests,
      counts,
      comments: group.rows
        .filter((row) => row.comment)
        .map((row) => ({ room: row.room, note: row.comment })),
      // Cancelled rooms are left out: nobody carries wine to a table that is
      // not coming, which is the same rule the plate counts follow.
      extras: group.rows
        .filter((row) => !row.cancelled && row.extras.length > 0)
        .map((row) => ({ room: row.room, items: row.extras })),
      bookedAt: group.rows
        .map((row) => row.bookedAt)
        .filter((at): at is string => Boolean(at))
        .sort()[0],
      members: group.rows.map((row) => ({
        reservationNumber: row.reservationNumber,
        room: row.room,
        cancelled: row.cancelled,
      })),
      isShared: group.isShared,
      cancelled: group.rows.every((row) => row.cancelled),
    };
  });
}

/**
 * Every promotion ordered for the evening, and how many of each.
 *
 * Kept apart from the kitchen's prep list rather than merged into it: these
 * are poured and carried, not cooked, and a bottle of wine appearing among the
 * plate counts is exactly the confusion the separate promotions catalogue
 * exists to prevent. Cancelled bookings are left out, like everywhere else.
 */
export function buildExtrasList(reservations: ReservationRecord[]): PrepLine[] {
  const counts = new Map<string, PrepLine>();

  for (const reservation of reservations) {
    if (reservation.status === "cancelled") {
      continue;
    }

    for (const addOn of reservation.addOns ?? []) {
      const existing = counts.get(addOn.optionId);
      if (existing) {
        existing.quantity += 1;
      } else {
        counts.set(addOn.optionId, {
          courseName: addOn.courseName,
          optionName: addOn.optionName,
          quantity: 1,
        });
      }
    }
  }

  return [...counts.values()].sort(
    (a, b) => a.courseName.localeCompare(b.courseName) || a.optionName.localeCompare(b.optionName),
  );
}

/**
 * The cut-off slip for the kitchen: every dish with something to make, and how
 * many. No tables, no rooms — just the prep list.
 */
export type PrepLine = { courseName: string; optionName: string; quantity: number };

export function buildPrepList(columns: OptionColumn[], totals: Record<string, number>): PrepLine[] {
  return columns
    .filter((column) => (totals[column.id] ?? 0) > 0)
    .map((column) => ({
      courseName: column.courseName,
      optionName: column.label,
      quantity: totals[column.id],
    }));
}

/* ------------------------------------------------------------------ *
 * Fitting the sheet to a page
 * ------------------------------------------------------------------ */

/**
 * How large the printed sheet may be set.
 *
 * The sheet is printed **portrait** and read at arm's length in a working
 * kitchen, so it wants to be as large as it can be — but it also has to stay on
 * one page, and how much room it needs depends on the evening: a column per
 * dish across, a row per table down. Rather than set one size small enough for
 * the worst night, the size is chosen from what is actually on the sheet.
 *
 * The estimate is deliberate arithmetic rather than a measurement. Print
 * layout cannot be measured from the screen — different type sizes, different
 * paddings, a different page — so anything read from the DOM would be
 * measuring the wrong thing and would be wrong in a way nobody could see until
 * it came out of the printer.
 */
export type SheetPrintSize = "lg" | "md" | "sm" | "xs";

/** A4 portrait, less the 10mm print margin on each side. */
const PAGE_WIDTH_MM = 190;
const PAGE_HEIGHT_MM = 277;
const PT_TO_MM = 0.3528;

/**
 * The share of the width the identity columns hold: table, rooms, guests and
 * the comment. The dish columns divide what is left — see rule 2.8, they are
 * percentages so they can never sum past the page.
 */
const IDENTITY_SHARE = 0.44;

/** The heading block above the table: title, date, covers and plates. */
const HEADING_MM = 22;

/**
 * Rows are not all one line. A shared table lists several rooms and a booking
 * may carry an allergy note, both of which wrap — so the estimate allows a
 * third of a line on average rather than assuming the best case.
 */
const WRAP_ALLOWANCE = 1.3;

const SIZES: { id: SheetPrintSize; fontPt: number }[] = [
  { id: "lg", fontPt: 11 },
  { id: "md", fontPt: 10 },
  { id: "sm", fontPt: 9 },
  { id: "xs", fontPt: 8 },
];

function fitsOnOnePage(fontPt: number, rows: number, dishColumns: number) {
  const lineMm = fontPt * PT_TO_MM;
  // Text, its leading, the cell padding and the row border.
  const rowMm = lineMm * 1.25 * WRAP_ALLOWANCE + 1.6;
  // Dish names are trimmed to three words and wrap in a narrow column.
  const headerMm = lineMm * 1.15 * 3 + 3;

  const heightMm = HEADING_MM + headerMm + rows * rowMm + rowMm;

  // Every dish column has to hold a two-figure count without wrapping it.
  const dishColumnMm = (PAGE_WIDTH_MM * (1 - IDENTITY_SHARE)) / Math.max(dishColumns, 1);
  const neededMm = lineMm * 1.2 + 2;

  return heightMm <= PAGE_HEIGHT_MM && dishColumnMm >= neededMm;
}

/**
 * The largest type this evening can be printed at and still fit one page.
 * Falls back to the smallest size rather than growing a second page: a sheet
 * the kitchen has to reassemble from two pages is worse than a small one.
 */
export function chooseSheetPrintSize(input: { rows: number; dishColumns: number }): SheetPrintSize {
  const fitting = SIZES.find((size) => fitsOnOnePage(size.fontPt, input.rows, input.dishColumns));
  return (fitting ?? SIZES[SIZES.length - 1]).id;
}

export function countPlates(totals: Record<string, number>) {
  return Object.values(totals).reduce((sum, count) => sum + count, 0);
}

/** How many guests declined each course, so the totals can be reconciled. */
export function countDeclined(reservations: ReservationRecord[]) {
  return reservations
    .filter((reservation) => reservation.status !== "cancelled")
    .reduce(
      (total, reservation) =>
        total + reservation.selections.filter((selection) => selection.optionId === NONE_OPTION_ID).length,
      0,
    );
}

function escapeCsvCell(value: string) {
  return /[",\n;]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/**
 * CSV for Excel. The BOM matters: without it Excel reads the file as the local
 * codepage and mangles accented and Cyrillic dish names.
 */
function toCsv(lines: string[][]) {
  return `﻿${lines.map((line) => line.map(escapeCsvCell).join(",")).join("\r\n")}\r\n`;
}

export function buildGuestCsv(columns: CourseColumn[], rows: GuestRow[]) {
  const header = ["Table", "Room", "Guest", ...columns.map((column) => column.label), "Comment", "Status"];

  return toCsv([
    header,
    ...rows.map((row) => [
      row.table,
      row.room,
      row.guests,
      ...columns.map((column) => row.choices[column.id] ?? ""),
      row.comment,
      row.cancelled ? "CANCELLED" : "confirmed",
    ]),
  ]);
}

export function buildTableCsv(
  columns: OptionColumn[],
  rows: CombinedTableRow[],
  totals: Record<string, number>,
) {
  const courseHeader = ["", "", "", ...columns.map((column) => column.courseName), "", ""];
  const optionHeader = ["Table", "Rooms", "Guests", ...columns.map((column) => column.label), "Comment", "Status"];

  const body = rows.map((row) => [
    row.table,
    row.rooms.join(" + "),
    String(row.guests),
    // Blank rather than 0, so the counts that matter stand out.
    ...columns.map((column) => (row.counts[column.id] ? String(row.counts[column.id]) : "")),
    row.comments.map((entry) => `${entry.room}: ${entry.note}`).join(" · "),
    row.cancelled ? "CANCELLED" : "confirmed",
  ]);

  const totalsRow = [
    "TOTAL",
    "",
    String(rows.filter((row) => !row.cancelled).reduce((sum, row) => sum + row.guests, 0)),
    ...columns.map((column) => String(totals[column.id] ?? 0)),
    "",
    "",
  ];

  return toCsv([courseHeader, optionHeader, ...body, totalsRow]);
}

export function buildKitchenFileName(dateKey: string, layout: KitchenLayout) {
  return `kitchen-${dateKey}-by-${layout}.csv`;
}
