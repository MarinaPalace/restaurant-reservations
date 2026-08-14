import type { MenuCourse, ReservationRecord } from "@/types/booking";

/**
 * Turns a day's reservations into the sheet the kitchen works from.
 *
 * Two layouts, because they answer different questions:
 * - "guest": one line per diner, so a cook reads down a course column and
 *   counts plates.
 * - "booking": one line per room, closer to a reception list.
 */

export type KitchenLayout = "guest" | "booking";

export type KitchenColumn = { id: string; label: string };

export type KitchenRow = {
  key: string;
  reservationNumber: string;
  table: string;
  room: number;
  guests: string;
  /** Course id -> what was chosen. */
  choices: Record<string, string>;
  comment: string;
  cancelled: boolean;
  /** Rooms sharing a table, for highlighting them together. */
  tableGroupId?: string;
};

/**
 * A column per course, in menu order, plus any course that only appears in
 * older reservations — so a dish removed from the menu still prints on the
 * sheet for bookings that chose it.
 */
export function buildKitchenColumns(reservations: ReservationRecord[], menu: MenuCourse[]): KitchenColumn[] {
  const columns: KitchenColumn[] = menu
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

    return a.roomNumber - b.roomNumber;
  });
}

export function buildKitchenRows(
  reservations: ReservationRecord[],
  columns: KitchenColumn[],
  layout: KitchenLayout,
): KitchenRow[] {
  const rows: KitchenRow[] = [];

  for (const reservation of sortReservations(reservations)) {
    const base = {
      reservationNumber: reservation.reservationNumber,
      table: reservation.tableNumber ?? "",
      room: reservation.roomNumber,
      comment: reservation.notes ?? "",
      cancelled: reservation.status === "cancelled",
      tableGroupId: reservation.tableGroupId,
    };

    if (layout === "booking") {
      const choices: Record<string, string> = {};

      for (const column of columns) {
        const chosen = reservation.selections
          .filter((selection) => selection.courseId === column.id)
          .sort((a, b) => (a.guestIndex ?? 0) - (b.guestIndex ?? 0))
          .map((selection) => selection.optionName);

        choices[column.id] = summarizeChoices(chosen);
      }

      rows.push({
        ...base,
        key: reservation.reservationNumber,
        guests: String(reservation.guestCount),
        choices,
      });
      continue;
    }

    for (let guestIndex = 0; guestIndex < Math.max(reservation.guestCount, 1); guestIndex += 1) {
      const choices: Record<string, string> = {};

      for (const column of columns) {
        const selection = reservation.selections.find(
          (entry) => (entry.guestIndex ?? 0) === guestIndex && entry.courseId === column.id,
        );
        choices[column.id] = selection?.optionName ?? "";
      }

      rows.push({
        ...base,
        key: `${reservation.reservationNumber}-${guestIndex}`,
        guests: `${guestIndex + 1} of ${reservation.guestCount}`,
        choices,
        // The comment belongs to the booking; repeating it on every line
        // would have the kitchen read the same allergy note several times.
        comment: guestIndex === 0 ? base.comment : "",
      });
    }
  }

  return rows;
}

/** "Duck ×2, Sea bream" rather than a long repetitive list. */
function summarizeChoices(choices: string[]) {
  const counts = new Map<string, number>();
  for (const choice of choices) {
    counts.set(choice, (counts.get(choice) ?? 0) + 1);
  }

  return [...counts.entries()].map(([name, count]) => (count > 1 ? `${name} ×${count}` : name)).join(", ");
}

function escapeCsvCell(value: string) {
  return /[",\n;]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/**
 * A CSV for Excel. The BOM matters: without it Excel reads the file as the
 * local codepage and mangles accented and Cyrillic dish names.
 */
export function buildKitchenCsv(columns: KitchenColumn[], rows: KitchenRow[], layout: KitchenLayout) {
  const header = ["Table", "Room", layout === "guest" ? "Guest" : "Guests", ...columns.map((c) => c.label), "Comment", "Status"];

  const lines = [header, ...rows.map((row) => [
    row.table,
    String(row.room),
    row.guests,
    ...columns.map((column) => row.choices[column.id] ?? ""),
    row.comment,
    row.cancelled ? "CANCELLED" : "confirmed",
  ])];

  return `﻿${lines.map((line) => line.map(escapeCsvCell).join(",")).join("\r\n")}\r\n`;
}

export function buildKitchenFileName(dateKey: string, layout: KitchenLayout) {
  return `kitchen-${dateKey}-by-${layout}.csv`;
}
