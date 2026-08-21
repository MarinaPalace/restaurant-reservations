import type { MenuCourse, ReservationRecord } from "@/types/booking";
import { compareRoomNumbers } from "@/lib/room";
import { NONE_OPTION_ID } from "@/lib/menu-selection";

/**
 * What the service board shows, worked out from the evening's bookings.
 *
 * Pure, like `lib/kitchen-report.ts`, and for the same reason: the arithmetic
 * that decides what is still to go out is the arithmetic somebody will argue
 * with at 20:30, so it is testable without a browser.
 *
 * ## Grouped by table, not by booking
 *
 * Rooms dining together are one table and are seated in one tap — but they are
 * several bookings, and each carries its own attendance record. So a group
 * knows its members and a mark fans out across them, exactly the way
 * `assignTableNumber` already works.
 */

export type BoardCourse = {
  courseId: string;
  courseName: string;
  order: number;
  /** Plates this table needs of this course. Declines are not plates. */
  plates: number;
  /** When it went out, if it has. The earliest across the table's bookings. */
  servedAt?: string;
};

export type BoardTable = {
  key: string;
  /** Blank when nobody has assigned one yet. */
  table: string;
  rooms: string[];
  guests: number;
  isShared: boolean;
  /** The bookings behind this table; a mark writes to all of them. */
  reservationNumbers: string[];
  /**
   * The table's attendance, which is the *weakest* of its bookings.
   *
   * A shared table is seated when everybody on it is. If one room is marked
   * and another is not, the table reads as unknown — because it is, and
   * showing it as seated would hide the room still to arrive.
   */
  attendance: "seated" | "no-show" | null;
  /** True when its bookings disagree, so the board can say so rather than pick. */
  attendanceMixed: boolean;
  courses: BoardCourse[];
  notes: string[];
  /** Promotions to bring. Never plates (rule 2.17). */
  extras: string[];
};

/** Plates this booking needs of each course. `NONE_OPTION_ID` is a choice, not a plate. */
function platesByCourse(reservation: ReservationRecord): Map<string, number> {
  const counts = new Map<string, number>();

  for (const selection of reservation.selections) {
    if (selection.optionId === NONE_OPTION_ID) {
      continue;
    }
    counts.set(selection.courseId, (counts.get(selection.courseId) ?? 0) + 1);
  }

  return counts;
}

function labelOf(reservation: ReservationRecord): string {
  return reservation.roomNumber || reservation.guestName?.trim() || "—";
}

/**
 * Tonight's tables, in the order somebody walks the room in.
 *
 * Cancelled bookings are left out entirely: there is nobody to seat and nothing
 * to serve, and a cancelled row on a board used at speed is a row somebody will
 * eventually tap.
 *
 * Tables with no number sort **first**, not last. Staff do not always assign
 * one before guests arrive, and the unassigned ones are exactly the rows that
 * need attention — burying them at the bottom is how a table goes unseated.
 */
export function buildBoard(
  reservations: readonly ReservationRecord[],
  menu: readonly MenuCourse[],
): BoardTable[] {
  const live = reservations.filter((reservation) => reservation.status === "confirmed");
  const courseOrder = new Map(menu.map((course) => [course.id, course.order]));
  const courseNames = new Map(menu.map((course) => [course.id, course.name]));

  const groups = new Map<string, ReservationRecord[]>();
  for (const reservation of live) {
    // The same key the sheet groups on: a shared table before a number is
    // assigned is still one table.
    const key = reservation.tableNumber || reservation.tableGroupId || reservation.reservationNumber;
    groups.set(key, [...(groups.get(key) ?? []), reservation]);
  }

  const tables: BoardTable[] = [...groups].map(([key, members]) => {
    const plates = new Map<string, number>();
    const servedAt = new Map<string, string>();

    for (const reservation of members) {
      for (const [courseId, count] of platesByCourse(reservation)) {
        plates.set(courseId, (plates.get(courseId) ?? 0) + count);
      }

      for (const [courseId, at] of Object.entries(reservation.service?.servedAt ?? {})) {
        const existing = servedAt.get(courseId);
        // The earliest: the course went out when the first plate of it did.
        if (!existing || at < existing) {
          servedAt.set(courseId, at);
        }
      }
    }

    const statuses = members.map((reservation) => reservation.attendance?.status ?? null);
    const unanimous = statuses.every((status) => status === statuses[0]);

    const courses: BoardCourse[] = [...plates]
      .map(([courseId, count]) => ({
        courseId,
        courseName: courseNames.get(courseId) ?? "Course",
        order: courseOrder.get(courseId) ?? 99,
        plates: count,
        servedAt: servedAt.get(courseId),
      }))
      .sort((a, b) => a.order - b.order);

    return {
      key,
      table: members[0].tableNumber ?? "",
      rooms: members.map(labelOf).sort(compareRoomNumbers),
      guests: members.reduce((sum, reservation) => sum + Math.max(0, reservation.guestCount), 0),
      isShared: members.length > 1,
      reservationNumbers: members.map((reservation) => reservation.reservationNumber),
      attendance: unanimous ? statuses[0] : null,
      attendanceMixed: !unanimous,
      courses,
      notes: members.map((reservation) => reservation.notes ?? "").filter(Boolean),
      extras: members.flatMap((reservation) => (reservation.addOns ?? []).map((addOn) => addOn.optionName)),
    };
  });

  return tables.sort((a, b) => {
    // Unassigned first: they are the rows that need attention.
    if (!a.table !== !b.table) {
      return a.table ? 1 : -1;
    }
    return a.table.localeCompare(b.table, undefined, { numeric: true }) || a.key.localeCompare(b.key);
  });
}

export type Outstanding = { courseId: string; courseName: string; order: number; plates: number };

/**
 * What is still to go out across the whole room, per course.
 *
 * The number the pass actually asks for. Counted only for tables that have
 * **arrived**: a course cannot be outstanding for guests who are not there,
 * and counting them would have the kitchen plating for an empty table.
 */
export function outstandingPlates(tables: readonly BoardTable[]): Outstanding[] {
  const totals = new Map<string, Outstanding>();

  for (const table of tables) {
    if (table.attendance !== "seated") {
      continue;
    }

    for (const course of table.courses) {
      if (course.servedAt) {
        continue;
      }

      const existing = totals.get(course.courseId);
      if (existing) {
        existing.plates += course.plates;
      } else {
        totals.set(course.courseId, { ...course, plates: course.plates });
      }
    }
  }

  return [...totals.values()].sort((a, b) => a.order - b.order);
}

/** How the evening is going, for the strip at the top. */
export function boardSummary(tables: readonly BoardTable[]) {
  const seated = tables.filter((table) => table.attendance === "seated");
  const noShow = tables.filter((table) => table.attendance === "no-show");
  const waiting = tables.filter((table) => table.attendance === null);

  return {
    tables: tables.length,
    seated: seated.length,
    noShow: noShow.length,
    waiting: waiting.length,
    guestsSeated: seated.reduce((sum, table) => sum + table.guests, 0),
    guestsExpected: tables.reduce((sum, table) => sum + table.guests, 0),
    /** Tables fully served: arrived, and every course out. */
    finished: seated.filter((table) => table.courses.every((course) => course.servedAt)).length,
  };
}
