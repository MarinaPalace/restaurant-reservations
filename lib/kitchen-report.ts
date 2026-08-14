import { isNoneSelection, NONE_OPTION_ID } from "@/lib/menu-selection";
import { compareRoomNumbers } from "@/lib/room";
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
  cancelled: boolean;
  tableGroupId?: string;
};

function sortReservations(reservations: ReservationRecord[]) {
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

    return compareRoomNumbers(a.roomNumber, b.roomNumber);
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

export function buildGuestRows(reservations: ReservationRecord[], columns: CourseColumn[]): GuestRow[] {
  const rows: GuestRow[] = [];

  for (const reservation of sortReservations(reservations)) {
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
        room: reservation.roomNumber,
        guests: `${guestIndex + 1} of ${reservation.guestCount}`,
        choices,
        // The note belongs to the booking; repeating it on every line would
        // have the kitchen read the same allergy warning several times.
        comment: guestIndex === 0 ? (reservation.notes ?? "") : "",
        cancelled: reservation.status === "cancelled",
        tableGroupId: reservation.tableGroupId,
      });
    }
  }

  return rows;
}

export function buildRoomRows(reservations: ReservationRecord[], columns: OptionColumn[]): RoomRow[] {
  return sortReservations(reservations).map((reservation) => {
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
      room: reservation.roomNumber,
      guests: reservation.guestCount,
      counts,
      comment: reservation.notes ?? "",
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

export function buildRoomCsv(columns: OptionColumn[], rows: RoomRow[], totals: Record<string, number>) {
  // Two header lines so each option column sits under its course, the way the
  // sheet reads on screen.
  const courseHeader = ["", "", "", ...columns.map((column) => column.courseName), "", ""];
  const optionHeader = ["Table", "Room", "Guests", ...columns.map((column) => column.label), "Comment", "Status"];

  const body = rows.map((row) => [
    row.table,
    row.room,
    String(row.guests),
    // Blank rather than 0, so the counts that matter stand out.
    ...columns.map((column) => (row.counts[column.id] ? String(row.counts[column.id]) : "")),
    row.comment,
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
