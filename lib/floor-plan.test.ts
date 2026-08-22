import { describe, expect, it } from "vitest";
import {
  EMPTY_PLAN,
  GRID,
  PLAN_HEIGHT,
  PLAN_WIDTH,
  TABLE_SIZE,
  clampToPlan,
  countPlan,
  countRoom,
  describePlanProblems,
  duplicateLabels,
  newRoom,
  newTable,
  snap,
  toFloorPlan,
  type FloorPlan,
  type FloorRoom,
  type FloorTable,
} from "@/lib/floor-plan";

/**
 * The floor plan model.
 *
 * `toFloorPlan` is the load-bearing one: it is the boundary between whatever
 * the settings store happens to hold and the rest of the app, and it is the
 * same function that runs on the way in from the designer. It must never
 * throw, whatever it is handed — a plan that cannot be read is a screen that
 * cannot be opened to fix it.
 */

function table(extra: Partial<FloorTable> = {}): FloorTable {
  return { id: "t1", label: "1", seats: 4, x: 0, y: 0, shape: "round", active: true, ...extra };
}

function room(tables: FloorTable[], extra: Partial<FloorRoom> = {}): FloorRoom {
  return { id: "r1", name: "Main room", tables, ...extra };
}

describe("reading a stored plan", () => {
  it("reads nothing at all as an empty plan", () => {
    // A fresh install, or a store that has never seen this key.
    expect(toFloorPlan(undefined)).toEqual(EMPTY_PLAN);
    expect(toFloorPlan(null)).toEqual(EMPTY_PLAN);
    expect(toFloorPlan("")).toEqual(EMPTY_PLAN);
  });

  it("reads something that is not a plan as an empty plan, rather than throwing", () => {
    expect(toFloorPlan(42)).toEqual(EMPTY_PLAN);
    expect(toFloorPlan("a room")).toEqual(EMPTY_PLAN);
    expect(toFloorPlan({ tables: [] })).toEqual(EMPTY_PLAN);
    expect(toFloorPlan({ rooms: "the terrace" })).toEqual(EMPTY_PLAN);
  });

  it("drops one unreadable table without losing the room around it", () => {
    const plan = toFloorPlan({
      rooms: [{ id: "r1", name: "Main", tables: [table(), null, "nonsense", table({ id: "t2", label: "2" })] }],
    });

    expect(plan.rooms).toHaveLength(1);
    expect(plan.rooms[0].tables.map((entry) => entry.label)).toEqual(["1", "2"]);
  });

  it("reads a table written before `active` existed as being in service", () => {
    // Rule 2.2: absent fields read as sensible defaults, never as absent tables.
    const plan = toFloorPlan({ rooms: [{ id: "r1", name: "Main", tables: [{ id: "t1", label: "1", seats: 4 }] }] });

    expect(plan.rooms[0].tables[0].active).toBe(true);
    expect(plan.rooms[0].tables[0].shape).toBe("round");
  });

  it("snaps and clamps a position that came from outside the room", () => {
    const plan = toFloorPlan({
      rooms: [{ id: "r1", name: "Main", tables: [{ id: "t1", label: "1", seats: 4, x: -500, y: 99_999 }] }],
    });

    const [only] = plan.rooms[0].tables;
    expect(only.x).toBe(0);
    expect(only.y).toBe(PLAN_HEIGHT - TABLE_SIZE.round.height);
  });

  it("rounds a rotation to a quarter turn", () => {
    const plan = toFloorPlan({
      rooms: [{ id: "r1", name: "Main", tables: [{ id: "t1", label: "1", rotation: 37 }] }],
    });

    // A table at 37 degrees is a drawing nobody meant.
    expect(plan.rooms[0].tables[0].rotation).toBe(0);
  });

  it("keeps a negative rotation inside a single turn", () => {
    const plan = toFloorPlan({
      rooms: [{ id: "r1", name: "Main", tables: [{ id: "t1", label: "1", rotation: -90 }] }],
    });

    expect(plan.rooms[0].tables[0].rotation).toBe(270);
  });

  it("gives a table with no id one, so the designer can still address it", () => {
    const plan = toFloorPlan({ rooms: [{ name: "Main", tables: [{ label: "1" }] }] });

    expect(plan.rooms[0].id).toBeTruthy();
    expect(plan.rooms[0].tables[0].id).toBeTruthy();
  });

  it("caps seats, and drops duplicate tags", () => {
    const plan = toFloorPlan({
      rooms: [
        { id: "r1", name: "Main", tables: [{ id: "t1", label: "1", seats: 9_000, tags: ["window", "window", "quiet"] }] },
      ],
    });

    expect(plan.rooms[0].tables[0].seats).toBe(20);
    expect(plan.rooms[0].tables[0].tags).toEqual(["window", "quiet"]);
  });

  it("round-trips a plan it has already read", () => {
    const once = toFloorPlan({ rooms: [room([table(), table({ id: "t2", label: "2", x: 200, y: 100 })])] });

    expect(toFloorPlan(once)).toEqual(once);
  });
});

describe("counting a room", () => {
  it("counts seats only at tables that are in service", () => {
    const counted = countRoom(room([table({ seats: 4 }), table({ id: "t2", seats: 6, active: false })]));

    // The out-of-service table is still drawn; it just seats nobody tonight.
    expect(counted).toEqual({ tables: 1, seats: 4 });
  });

  it("adds the rooms up across the plan", () => {
    const plan: FloorPlan = {
      rooms: [
        room([table({ seats: 4 }), table({ id: "t2", seats: 2 })]),
        room([table({ id: "t3", seats: 6 })], { id: "r2", name: "Terrace" }),
      ],
    };

    expect(countPlan(plan)).toEqual({ rooms: 2, tables: 3, seats: 12 });
  });

  it("counts an empty plan as nothing rather than failing", () => {
    expect(countPlan(EMPTY_PLAN)).toEqual({ rooms: 0, tables: 0, seats: 0 });
  });
});

describe("labels", () => {
  /**
   * The label becomes a booking's `tableNumber`, so a duplicate is a service
   * problem rather than a drawing one — the sheet would not be able to say
   * which table a party is at.
   */
  it("finds a duplicate label across two different rooms", () => {
    const plan: FloorPlan = {
      rooms: [room([table({ label: "7" })]), room([table({ id: "t2", label: "7" })], { id: "r2", name: "Terrace" })],
    };

    expect(duplicateLabels(plan)).toEqual(["7"]);
  });

  it("treats labels as the same however they were typed", () => {
    const plan: FloorPlan = { rooms: [room([table({ label: "a1" }), table({ id: "t2", label: " A1 " })])] };

    expect(duplicateLabels(plan)).toEqual(["A1"]);
  });

  it("does not count two unlabelled tables as a duplicate", () => {
    const plan: FloorPlan = { rooms: [room([table({ label: "" }), table({ id: "t2", label: "" })])] };

    expect(duplicateLabels(plan)).toEqual([]);
    // They are still worth mentioning, just not as a clash.
    expect(describePlanProblems(plan).join(" ")).toMatch(/no label yet/);
  });

  it("says nothing is wrong with a finished plan", () => {
    const plan: FloorPlan = { rooms: [room([table({ label: "1" }), table({ id: "t2", label: "2" })])] };

    expect(describePlanProblems(plan)).toEqual([]);
  });
});

describe("adding to the plan", () => {
  it("puts a new table on the grid and inside the room", () => {
    const created = newTable(room([]));

    expect(created.x % GRID).toBe(0);
    expect(created.y % GRID).toBe(0);
    expect(created.x).toBeLessThan(PLAN_WIDTH);
    expect(created.y).toBeLessThan(PLAN_HEIGHT);
  });

  it("does not drop a new table on top of an existing one", () => {
    const existing = newTable(room([]));
    const next = newTable(room([existing]));

    expect(`${next.x},${next.y}`).not.toBe(`${existing.x},${existing.y}`);
  });

  it("numbers a new table with the lowest number going spare", () => {
    const filled = room([table({ label: "1" }), table({ id: "t2", label: "3" })]);

    expect(newTable(filled).label).toBe("2");
  });

  /**
   * A room of "T1"/"T2", or of named tables, is a scheme somebody chose. Adding
   * a bare "1" to it would clash with that intent, so only purely numeric
   * labels are counted.
   */
  it("leaves a non-numeric labelling scheme alone", () => {
    expect(newTable(room([table({ label: "T1" })])).label).toBe("1");
  });

  it("names the first room, then avoids repeating a name", () => {
    const first = newRoom(EMPTY_PLAN);
    expect(first.name).toBe("Main room");

    const second = newRoom({ rooms: [first] });
    const third = newRoom({ rooms: [first, second] });
    expect(third.name).not.toBe(second.name);
  });
});

describe("the grid", () => {
  it("snaps to the nearest multiple", () => {
    expect(snap(0)).toBe(0);
    expect(snap(4)).toBe(0);
    expect(snap(6)).toBe(10);
    expect(snap(-4)).toBe(-0);
  });

  it("keeps a wide table's far edge inside the room", () => {
    const clamped = clampToPlan({ x: PLAN_WIDTH + 100, y: 0, shape: "rectangle" });

    expect(clamped.x).toBe(PLAN_WIDTH - TABLE_SIZE.rectangle.width);
  });
});
