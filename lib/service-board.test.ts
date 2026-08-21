import { describe, expect, it } from "vitest";
import { boardSummary, buildBoard, outstandingPlates } from "@/lib/service-board";
import { NONE_OPTION_ID, NONE_OPTION_NAME } from "@/lib/menu-selection";
import type { MenuCourse, ReservationRecord } from "@/types/booking";

/**
 * The service board's arithmetic.
 *
 * The number that matters most is "what is still to go out" — it is what the
 * pass asks for at 20:30, and it is the one somebody will argue with.
 */

const menu: MenuCourse[] = [
  {
    id: "c1",
    order: 1,
    name: "Starter",
    description: "",
    required: true,
    active: true,
    options: [{ id: "o1", courseId: "c1", name: "Salmon", description: "", allergens: [], active: true }],
  },
  {
    id: "c2",
    order: 2,
    name: "Main",
    description: "",
    required: true,
    active: true,
    options: [{ id: "o3", courseId: "c2", name: "Duck", description: "", allergens: [], active: true }],
  },
];

function pick(guestIndex: number, courseId: string, optionId: string, optionName = "Dish") {
  return { guestIndex, courseId, courseName: courseId === "c1" ? "Starter" : "Main", optionId, optionName };
}

function booking(overrides: Partial<ReservationRecord> = {}): ReservationRecord {
  return {
    reservationNumber: "VDM-AAA111",
    roomNumber: "402",
    guestCount: 2,
    date: "2026-08-25",
    status: "confirmed",
    tableNumber: "7",
    selections: [pick(0, "c1", "o1"), pick(0, "c2", "o3"), pick(1, "c1", "o1"), pick(1, "c2", "o3")],
    ...overrides,
  };
}

describe("building the board", () => {
  it("counts the plates each table needs, per course", () => {
    const [table] = buildBoard([booking()], menu);

    expect(table.courses.map((course) => [course.courseName, course.plates])).toEqual([
      ["Starter", 2],
      ["Main", 2],
    ]);
  });

  /** A decline is a real selection but never a plate (README, rule 2.17's cousin). */
  it("does not count a declined course as a plate", () => {
    const [table] = buildBoard(
      [booking({ selections: [pick(0, "c1", NONE_OPTION_ID, NONE_OPTION_NAME), pick(0, "c2", "o3")] })],
      menu,
    );

    expect(table.courses.map((course) => [course.courseName, course.plates])).toEqual([["Main", 1]]);
  });

  it("puts the courses in menu order, not the order they were chosen", () => {
    const [table] = buildBoard([booking({ selections: [pick(0, "c2", "o3"), pick(0, "c1", "o1")] })], menu);
    expect(table.courses.map((course) => course.courseName)).toEqual(["Starter", "Main"]);
  });

  it("leaves a cancelled booking off the board entirely", () => {
    expect(buildBoard([booking({ status: "cancelled" })], menu)).toEqual([]);
  });

  it("groups rooms sharing a table into one row", () => {
    const board = buildBoard(
      [
        booking({ reservationNumber: "A", roomNumber: "402", tableNumber: "7" }),
        booking({ reservationNumber: "B", roomNumber: "118", tableNumber: "7" }),
      ],
      menu,
    );

    expect(board).toHaveLength(1);
    expect(board[0].isShared).toBe(true);
    expect(board[0].guests).toBe(4);
    expect(board[0].reservationNumbers).toEqual(["A", "B"]);
    // Plates add up across the rooms.
    expect(board[0].courses[0].plates).toBe(4);
  });

  it("groups rooms that asked to sit together before a table was assigned", () => {
    const board = buildBoard(
      [
        booking({ reservationNumber: "A", tableNumber: undefined, tableGroupId: "A" }),
        booking({ reservationNumber: "B", roomNumber: "118", tableNumber: undefined, tableGroupId: "A" }),
      ],
      menu,
    );

    expect(board).toHaveLength(1);
  });

  /** Unassigned tables need attention, so they are not buried at the bottom. */
  it("sorts tables with no number first", () => {
    const board = buildBoard(
      [
        booking({ reservationNumber: "A", tableNumber: "3" }),
        booking({ reservationNumber: "B", roomNumber: "118", tableNumber: undefined, tableGroupId: "B" }),
      ],
      menu,
    );

    expect(board[0].table).toBe("");
    expect(board[1].table).toBe("3");
  });

  it("sorts table numbers the way people read them", () => {
    const board = buildBoard(
      [
        booking({ reservationNumber: "A", tableNumber: "10" }),
        booking({ reservationNumber: "B", roomNumber: "118", tableNumber: "2" }),
      ],
      menu,
    );

    expect(board.map((table) => table.table)).toEqual(["2", "10"]);
  });
});

describe("attendance on a table", () => {
  it("reads as unknown when nobody has marked it", () => {
    expect(buildBoard([booking()], menu)[0].attendance).toBeNull();
  });

  it("reads as seated once marked", () => {
    const seated = booking({ attendance: { status: "seated", at: "2026-08-25T17:00:00.000Z", byName: "Ivan" } });
    expect(buildBoard([seated], menu)[0].attendance).toBe("seated");
  });

  /**
   * A shared table is seated when everybody on it is. One room marked and the
   * other not is *unknown*, not seated — showing it as seated would hide the
   * room still to arrive.
   */
  it("reads a half-marked shared table as unknown, and says the rooms disagree", () => {
    const board = buildBoard(
      [
        booking({
          reservationNumber: "A",
          attendance: { status: "seated", at: "2026-08-25T17:00:00.000Z", byName: "Ivan" },
        }),
        booking({ reservationNumber: "B", roomNumber: "118" }),
      ],
      menu,
    );

    expect(board[0].attendance).toBeNull();
    expect(board[0].attendanceMixed).toBe(true);
  });
});

describe("what is still to go out", () => {
  const seated = { status: "seated" as const, at: "2026-08-25T17:00:00.000Z", byName: "Ivan" };

  it("counts every course of a seated table that has not gone out", () => {
    const board = buildBoard([booking({ attendance: seated })], menu);

    expect(outstandingPlates(board).map((course) => [course.courseName, course.plates])).toEqual([
      ["Starter", 2],
      ["Main", 2],
    ]);
  });

  it("drops a course once it has been served", () => {
    const board = buildBoard(
      [booking({ attendance: seated, service: { servedAt: { c1: "2026-08-25T18:04:00.000Z" } } })],
      menu,
    );

    expect(outstandingPlates(board).map((course) => course.courseName)).toEqual(["Main"]);
  });

  /**
   * The rule that keeps the kitchen honest: a course cannot be outstanding for
   * guests who are not in the room, and counting them would have the kitchen
   * plating for an empty table.
   */
  it("ignores a table that has not arrived", () => {
    expect(outstandingPlates(buildBoard([booking()], menu))).toEqual([]);
  });

  it("ignores a table marked as a no-show", () => {
    const noShow = booking({
      attendance: { status: "no-show", at: "2026-08-25T19:30:00.000Z", byName: "Ivan" },
    });

    expect(outstandingPlates(buildBoard([noShow], menu))).toEqual([]);
  });

  it("adds up across tables, in menu order", () => {
    const board = buildBoard(
      [
        booking({ reservationNumber: "A", tableNumber: "1", attendance: seated }),
        booking({ reservationNumber: "B", roomNumber: "118", tableNumber: "2", attendance: seated }),
      ],
      menu,
    );

    expect(outstandingPlates(board).map((course) => [course.courseName, course.plates])).toEqual([
      ["Starter", 4],
      ["Main", 4],
    ]);
  });

  /** A course went out when its first plate did, not its last. */
  it("takes the earliest time across a shared table's bookings", () => {
    const board = buildBoard(
      [
        booking({
          reservationNumber: "A",
          attendance: seated,
          service: { servedAt: { c1: "2026-08-25T18:10:00.000Z" } },
        }),
        booking({
          reservationNumber: "B",
          roomNumber: "118",
          attendance: seated,
          service: { servedAt: { c1: "2026-08-25T18:04:00.000Z" } },
        }),
      ],
      menu,
    );

    expect(board[0].courses[0].servedAt).toBe("2026-08-25T18:04:00.000Z");
  });
});

describe("the evening at a glance", () => {
  const seated = { status: "seated" as const, at: "2026-08-25T17:00:00.000Z", byName: "Ivan" };

  it("counts seated, waiting and no-shows", () => {
    const board = buildBoard(
      [
        booking({ reservationNumber: "A", tableNumber: "1", attendance: seated }),
        booking({ reservationNumber: "B", roomNumber: "118", tableNumber: "2" }),
        booking({
          reservationNumber: "C",
          roomNumber: "210",
          tableNumber: "3",
          attendance: { status: "no-show", at: "2026-08-25T19:30:00.000Z", byName: "Ivan" },
        }),
      ],
      menu,
    );

    expect(boardSummary(board)).toMatchObject({ tables: 3, seated: 1, waiting: 1, noShow: 1 });
  });

  it("counts a table finished only when every course has gone out", () => {
    const partly = buildBoard(
      [booking({ attendance: seated, service: { servedAt: { c1: "2026-08-25T18:04:00.000Z" } } })],
      menu,
    );
    expect(boardSummary(partly).finished).toBe(0);

    const done = buildBoard(
      [
        booking({
          attendance: seated,
          service: { servedAt: { c1: "2026-08-25T18:04:00.000Z", c2: "2026-08-25T19:00:00.000Z" } },
        }),
      ],
      menu,
    );
    expect(boardSummary(done).finished).toBe(1);
  });
});
