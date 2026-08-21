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

/**
 * One plate: a named guest's dish.
 *
 * The unit the board actually works in. "2 Amuse Bouche" does not say what
 * anybody is eating, and an allergy note says "guest 2 is allergic to gluten" —
 * so a plate has to know whose it is and what it is, or neither of those can be
 * answered from the screen.
 */
export type BoardPlate = {
  /** Which booking; a shared table has several, each with its own guest 0. */
  reservationNumber: string;
  guestIndex: number;
  /** "Guest 2", or "402 · Guest 2" when the table is shared. */
  label: string;
  optionName: string;
  servedAt?: string;
};

export type BoardCourse = {
  courseId: string;
  courseName: string;
  order: number;
  /** Every plate of this course, in guest order. Declines are not plates. */
  plates: BoardPlate[];
  /** How many, grouped by dish — what the collapsed row shows. */
  summary: { optionName: string; count: number }[];
  served: number;
  outstanding: number;
  /** When the last plate of it went out, if they all have. */
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

/**
 * Every plate this booking needs, by course.
 *
 * `NONE_OPTION_ID` is a real selection but never a plate — "guest 2 wants no
 * starter" is a fact the kitchen wants and a plate nobody carries.
 */
function platesByCourse(reservation: ReservationRecord, isShared: boolean): Map<string, BoardPlate[]> {
  const byCourse = new Map<string, BoardPlate[]>();
  const room = reservation.roomNumber || reservation.guestName?.trim() || "—";

  for (const selection of reservation.selections) {
    if (selection.optionId === NONE_OPTION_ID) {
      continue;
    }

    const guestIndex = selection.guestIndex ?? 0;
    const served =
      reservation.service?.servedGuests?.[selection.courseId]?.[String(guestIndex)] ??
      // A record from the first version of the board marked whole courses;
      // every plate of such a course counts as out.
      reservation.service?.servedAt?.[selection.courseId];

    byCourse.set(selection.courseId, [
      ...(byCourse.get(selection.courseId) ?? []),
      {
        reservationNumber: reservation.reservationNumber,
        guestIndex,
        // The room is only worth the space when the table is shared; on a
        // single booking "Guest 2" is unambiguous and shorter to read at speed.
        label: isShared ? `${room} · Guest ${guestIndex + 1}` : `Guest ${guestIndex + 1}`,
        optionName: selection.optionName,
        servedAt: served,
      },
    ]);
  }

  return byCourse;
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
    const isShared = members.length > 1;
    const plates = new Map<string, BoardPlate[]>();

    for (const reservation of members) {
      for (const [courseId, coursePlates] of platesByCourse(reservation, isShared)) {
        plates.set(courseId, [...(plates.get(courseId) ?? []), ...coursePlates]);
      }
    }

    const statuses = members.map((reservation) => reservation.attendance?.status ?? null);
    const unanimous = statuses.every((status) => status === statuses[0]);

    const courses: BoardCourse[] = [...plates]
      .map(([courseId, coursePlates]) => {
        const ordered = [...coursePlates].sort(
          (a, b) =>
            a.reservationNumber.localeCompare(b.reservationNumber) || a.guestIndex - b.guestIndex,
        );
        const served = ordered.filter((plate) => plate.servedAt);

        // Grouped by dish for the collapsed row: "2 x Salmon, 1 x Veloute".
        const counts = new Map<string, number>();
        for (const plate of ordered) {
          counts.set(plate.optionName, (counts.get(plate.optionName) ?? 0) + 1);
        }

        return {
          courseId,
          courseName: courseNames.get(courseId) ?? "Course",
          order: courseOrder.get(courseId) ?? 99,
          plates: ordered,
          summary: [...counts]
            .map(([optionName, count]) => ({ optionName, count }))
            .sort((a, b) => b.count - a.count || a.optionName.localeCompare(b.optionName)),
          served: served.length,
          outstanding: ordered.length - served.length,
          // The course is out when its last plate is, so the time is the latest
          // of them — "when did table 7 finish its starter", not when it began.
          servedAt:
            served.length === ordered.length && ordered.length > 0
              ? served.map((plate) => plate.servedAt!).sort().at(-1)
              : undefined,
        };
      })
      .sort((a, b) => a.order - b.order);

    return {
      key,
      table: members[0].tableNumber ?? "",
      rooms: members.map(labelOf).sort(compareRoomNumbers),
      guests: members.reduce((sum, reservation) => sum + Math.max(0, reservation.guestCount), 0),
      isShared,
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
      if (course.outstanding === 0) {
        continue;
      }

      const existing = totals.get(course.courseId);
      if (existing) {
        existing.plates += course.outstanding;
      } else {
        // Only the plates genuinely still to go: a course half sent counts what
        // is left, not all of it, or the kitchen plates twice.
        totals.set(course.courseId, {
          courseId: course.courseId,
          courseName: course.courseName,
          order: course.order,
          plates: course.outstanding,
        });
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
    finished: seated.filter((table) => table.courses.every((course) => course.outstanding === 0)).length,
  };
}
