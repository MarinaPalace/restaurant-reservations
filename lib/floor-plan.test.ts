import { describe, expect, it } from "vitest";
import {
  DEFAULT_FEATURE_SIZE,
  DEFAULT_TABLE_SIZE,
  EMPTY_PLAN,
  GRID,
  CM_PER_M,
  DEFAULT_ZONE_HEIGHT,
  DEFAULT_ZONE_WIDTH,
  MAX_ZONE_SIDE,
  MIN_SIZE,
  MIN_ZONE_SIDE,
  chairPositions,
  clampPosition,
  clampSize,
  clampZoneSize,
  formatLength,
  countPlan,
  countZone,
  describePlanProblems,
  duplicateLabels,
  newFeature,
  newTable,
  newZone,
  snap,
  zoneArea,
  toFloorPlan,
  type FloorPlan,
  type FloorTable,
  type FloorZone,
} from "@/lib/floor-plan";

/**
 * The floor plan model.
 *
 * `toFloorPlan` is the load-bearing one: it is the boundary between whatever
 * the settings store happens to hold and the rest of the app, and it is the
 * same function that runs on the way in from the designer. It must never
 * throw, whatever it is handed — a plan that cannot be read is a screen that
 * cannot be opened to fix it.
 *
 * A **zone** is a hall of the restaurant. It is never a hotel room; this app
 * already uses that word for where the guest is staying.
 */

function table(extra: Partial<FloorTable> = {}): FloorTable {
  return {
    id: "t1",
    label: "1",
    seats: 4,
    x: 0,
    y: 0,
    width: 70,
    height: 70,
    rotation: 0,
    shape: "round",
    active: true,
    ...extra,
  };
}

function zone(tables: FloorTable[], extra: Partial<FloorZone> = {}): FloorZone {
  return {
    id: "z1",
    name: "Main hall",
    width: DEFAULT_ZONE_WIDTH,
    height: DEFAULT_ZONE_HEIGHT,
    tables,
    features: [],
    ...extra,
  };
}

describe("reading a stored plan", () => {
  it("reads nothing at all as an empty plan", () => {
    expect(toFloorPlan(undefined)).toEqual(EMPTY_PLAN);
    expect(toFloorPlan(null)).toEqual(EMPTY_PLAN);
    expect(toFloorPlan("")).toEqual(EMPTY_PLAN);
  });

  it("reads something that is not a plan as an empty plan, rather than throwing", () => {
    expect(toFloorPlan(42)).toEqual(EMPTY_PLAN);
    expect(toFloorPlan("the terrace")).toEqual(EMPTY_PLAN);
    expect(toFloorPlan({ tables: [] })).toEqual(EMPTY_PLAN);
    expect(toFloorPlan({ zones: "the terrace" })).toEqual(EMPTY_PLAN);
  });

  /**
   * The first version of this feature called zones "rooms", before the word was
   * found to collide with the hotel's own. A plan saved under the old name has
   * to keep loading — rule 2.2, and the alternative is somebody's drawn
   * restaurant silently becoming an empty floor.
   */
  it("still reads a plan saved when zones were called rooms", () => {
    const plan = toFloorPlan({ rooms: [{ id: "r1", name: "Main", tables: [{ id: "t1", label: "1", seats: 4 }] }] });

    expect(plan.zones).toHaveLength(1);
    expect(plan.zones[0].name).toBe("Main");
    expect(plan.zones[0].tables[0].label).toBe("1");
  });

  it("drops one unreadable table without losing the zone around it", () => {
    const plan = toFloorPlan({
      zones: [{ id: "z1", name: "Main", tables: [table(), null, "nonsense", table({ id: "t2", label: "2" })] }],
    });

    expect(plan.zones[0].tables.map((entry) => entry.label)).toEqual(["1", "2"]);
  });

  it("reads a zone drawn before features existed as one with no features", () => {
    const plan = toFloorPlan({ zones: [{ id: "z1", name: "Main", tables: [] }] });

    expect(plan.zones[0].features).toEqual([]);
  });

  it("reads a table written before `active` existed as being in service", () => {
    const plan = toFloorPlan({ zones: [{ id: "z1", name: "Main", tables: [{ id: "t1", label: "1", seats: 4 }] }] });

    expect(plan.zones[0].tables[0].active).toBe(true);
    expect(plan.zones[0].tables[0].shape).toBe("round");
  });

  it("gives a table written before sizes existed the default for its shape", () => {
    const plan = toFloorPlan({
      zones: [{ id: "z1", name: "Main", tables: [{ id: "t1", label: "1", shape: "rectangle" }] }],
    });

    expect(plan.zones[0].tables[0].width).toBe(DEFAULT_TABLE_SIZE.rectangle.width);
    expect(plan.zones[0].tables[0].height).toBe(DEFAULT_TABLE_SIZE.rectangle.height);
  });

  it("snaps and clamps a position that came from outside the room", () => {
    const plan = toFloorPlan({
      zones: [{ id: "z1", name: "Main", tables: [{ id: "t1", label: "1", x: -500, y: 99_999, width: 70, height: 70 }] }],
    });

    const [only] = plan.zones[0].tables;
    expect(only.x).toBe(0);
    expect(only.y).toBe(DEFAULT_ZONE_HEIGHT - 70);
  });

  it("holds a size within what can be drawn", () => {
    const plan = toFloorPlan({
      zones: [
        {
          id: "z1",
          name: "Main",
          tables: [
            { id: "t1", label: "1", width: 1, height: 5_000 },
            { id: "t2", label: "2", width: 123, height: 87 },
          ],
        },
      ],
    });

    const [tiny, odd] = plan.zones[0].tables;
    expect(tiny.width).toBe(MIN_SIZE);
    expect(tiny.height).toBeLessThanOrEqual(DEFAULT_ZONE_HEIGHT);
    // Sizes land on the grid, like everything else.
    expect(odd.width % GRID).toBe(0);
    expect(odd.height % GRID).toBe(0);
  });

  it("keeps any angle, wrapped into a single turn", () => {
    const plan = toFloorPlan({
      zones: [
        {
          id: "z1",
          name: "Main",
          tables: [
            { id: "t1", label: "1", rotation: 37 },
            { id: "t2", label: "2", rotation: -90 },
          ],
        },
      ],
    });

    // Any angle: a table on the diagonal is an ordinary thing in a real room,
    // and 37 degrees is now a drawing somebody may well have meant.
    expect(plan.zones[0].tables[0].rotation).toBe(37);
    expect(plan.zones[0].tables[1].rotation).toBe(270);
  });

  it("caps seats and drops duplicate tags", () => {
    const plan = toFloorPlan({
      zones: [
        { id: "z1", name: "Main", tables: [{ id: "t1", label: "1", seats: 9_000, tags: ["window", "window", "quiet"] }] },
      ],
    });

    expect(plan.zones[0].tables[0].seats).toBe(20);
    expect(plan.zones[0].tables[0].tags).toEqual(["window", "quiet"]);
  });

  it("round-trips a plan it has already read", () => {
    const once = toFloorPlan({
      zones: [
        {
          id: "z1",
          name: "Main hall",
          tables: [table(), table({ id: "t2", label: "2", x: 200, y: 100 })],
          features: [{ id: "f1", kind: "stage", label: "Musician", x: 400, y: 300, width: 180, height: 120 }],
        },
      ],
    });

    expect(toFloorPlan(once)).toEqual(once);
  });
});

describe("features", () => {
  it("keeps the stage, its name and its size", () => {
    const plan = toFloorPlan({
      zones: [
        {
          id: "z1",
          name: "Main",
          tables: [],
          features: [{ id: "f1", kind: "stage", label: "Musician", x: 100, y: 100, width: 200, height: 120 }],
        },
      ],
    });

    const [stage] = plan.zones[0].features;
    expect(stage.kind).toBe("stage");
    expect(stage.label).toBe("Musician");
    expect(stage.width).toBe(200);
  });

  /**
   * Drawing a mystery rectangle in the middle of somebody's restaurant helps
   * nobody, so an unrecognised kind is dropped rather than guessed at.
   */
  it("drops a feature whose kind it does not recognise", () => {
    const plan = toFloorPlan({
      zones: [
        {
          id: "z1",
          name: "Main",
          tables: [],
          features: [{ id: "f1", kind: "helipad", x: 0, y: 0 }, { id: "f2", kind: "door", x: 0, y: 0 }],
        },
      ],
    });

    expect(plan.zones[0].features.map((entry) => entry.kind)).toEqual(["door"]);
  });

  it("gives a feature the default size for its kind", () => {
    const plan = toFloorPlan({ zones: [{ id: "z1", name: "Main", tables: [], features: [{ id: "f1", kind: "bar" }] }] });

    expect(plan.zones[0].features[0].width).toBe(DEFAULT_FEATURE_SIZE.bar.width);
  });

  it("reads a feature with no name as unnamed rather than as an empty string", () => {
    const plan = toFloorPlan({
      zones: [{ id: "z1", name: "Main", tables: [], features: [{ id: "f1", kind: "wall", label: "   " }] }],
    });

    expect(plan.zones[0].features[0].label).toBeUndefined();
  });

  it("names a new stage for the musician, since that is what it is for", () => {
    expect(newFeature(zone([]), "stage").label).toBe("Musician");
    expect(newFeature(zone([]), "wall").label).toBeUndefined();
  });

  it("does not count features as seats", () => {
    const withStage: FloorZone = {
      ...zone([table({ seats: 4 })]),
      features: [{ id: "f1", kind: "stage", x: 0, y: 0, width: 100, height: 100, rotation: 0 }],
    };

    expect(countZone(withStage)).toEqual({ tables: 1, seats: 4 });
  });
});

describe("counting a zone", () => {
  it("counts seats only at tables that are in service", () => {
    const counted = countZone(zone([table({ seats: 4 }), table({ id: "t2", seats: 6, active: false })]));

    expect(counted).toEqual({ tables: 1, seats: 4 });
  });

  it("adds the zones up across the plan", () => {
    const plan: FloorPlan = {
      zones: [
        zone([table({ seats: 4 }), table({ id: "t2", seats: 2 })]),
        zone([table({ id: "t3", seats: 6 })], { id: "z2", name: "Terrace" }),
      ],
    };

    expect(countPlan(plan)).toEqual({ zones: 2, tables: 3, seats: 12 });
  });

  it("counts an empty plan as nothing rather than failing", () => {
    expect(countPlan(EMPTY_PLAN)).toEqual({ zones: 0, tables: 0, seats: 0 });
  });
});

describe("labels", () => {
  it("finds a duplicate label across two different zones", () => {
    const plan: FloorPlan = {
      zones: [zone([table({ label: "7" })]), zone([table({ id: "t2", label: "7" })], { id: "z2", name: "Terrace" })],
    };

    expect(duplicateLabels(plan)).toEqual(["7"]);
  });

  it("treats labels as the same however they were typed", () => {
    const plan: FloorPlan = { zones: [zone([table({ label: "a1" }), table({ id: "t2", label: " A1 " })])] };

    expect(duplicateLabels(plan)).toEqual(["A1"]);
  });

  it("does not count two unlabelled tables as a duplicate", () => {
    const plan: FloorPlan = { zones: [zone([table({ label: "" }), table({ id: "t2", label: "" })])] };

    expect(duplicateLabels(plan)).toEqual([]);
    expect(describePlanProblems(plan).join(" ")).toMatch(/no label yet/);
  });

  it("says nothing is wrong with a finished plan", () => {
    const plan: FloorPlan = { zones: [zone([table({ label: "1" }), table({ id: "t2", label: "2" })])] };

    expect(describePlanProblems(plan)).toEqual([]);
  });
});

describe("adding to the plan", () => {
  it("puts a new table on the grid and inside the room", () => {
    const created = newTable(zone([]));

    expect(created.x % GRID).toBe(0);
    expect(created.y % GRID).toBe(0);
    expect(created.x + created.width).toBeLessThanOrEqual(DEFAULT_ZONE_WIDTH);
    expect(created.y + created.height).toBeLessThanOrEqual(DEFAULT_ZONE_HEIGHT);
  });

  it("does not drop a new table on top of an existing one", () => {
    const existing = newTable(zone([]));
    const next = newTable(zone([existing]));

    expect(`${next.x},${next.y}`).not.toBe(`${existing.x},${existing.y}`);
  });

  it("does not drop a new table on top of the bar either", () => {
    const bar = newFeature(zone([]), "bar");
    const created = newTable({ ...zone([]), features: [bar] });

    expect(`${created.x},${created.y}`).not.toBe(`${bar.x},${bar.y}`);
  });

  it("numbers a new table with the lowest number going spare", () => {
    expect(newTable(zone([table({ label: "1" }), table({ id: "t2", label: "3" })])).label).toBe("2");
  });

  it("leaves a non-numeric labelling scheme alone", () => {
    expect(newTable(zone([table({ label: "T1" })])).label).toBe("1");
  });

  it("names the first zone as a hall, then avoids repeating a name", () => {
    const first = newZone(EMPTY_PLAN);
    expect(first.name).toBe("Main hall");

    const second = newZone({ zones: [first] });
    const third = newZone({ zones: [first, second] });
    expect(third.name).not.toBe(second.name);
  });
});

describe("the grid", () => {
  it("snaps to the nearest multiple", () => {
    expect(snap(0)).toBe(0);
    expect(snap(4)).toBe(0);
    expect(snap(6)).toBe(10);
  });

  it("keeps a wide thing's far edge inside the hall", () => {
    expect(clampPosition({ x: DEFAULT_ZONE_WIDTH + 100, y: 0, width: 300, height: 60 }).x).toBe(
      DEFAULT_ZONE_WIDTH - 300,
    );
  });

  /**
   * The far wall is reachable. There is no dead band at the end of a hall —
   * something 300 wide in a 1400 hall may sit at exactly 1100, flush against
   * the wall, and the corner is both walls at once.
   */
  it("lets something sit flush against the far wall and into the corner", () => {
    const hall = { width: 1400, height: 900 };

    expect(clampPosition({ x: 1100, y: 0, width: 300, height: 60 }, hall).x).toBe(1100);
    expect(clampPosition({ x: 99_999, y: 99_999, width: 300, height: 60 }, hall)).toEqual({ x: 1100, y: 840 });
  });

  it("refuses to make anything smaller than it can be grabbed", () => {
    expect(clampSize(1, 1)).toEqual({ width: MIN_SIZE, height: MIN_SIZE });
  });
});

describe("the hall itself", () => {
  it("holds a zone between an alcove and a banqueting hall", () => {
    expect(clampZoneSize(10, 10)).toEqual({ width: MIN_ZONE_SIDE, height: MIN_ZONE_SIDE });
    expect(clampZoneSize(99_999, 99_999)).toEqual({ width: MAX_ZONE_SIDE, height: MAX_ZONE_SIDE });
  });

  it("gives a zone drawn before halls had dimensions the default size", () => {
    // Which is the size everything was implicitly laid out in, so an existing
    // plan keeps every table exactly where it was put.
    const plan = toFloorPlan({ zones: [{ id: "z1", name: "Main", tables: [], features: [] }] });

    expect(plan.zones[0].width).toBe(DEFAULT_ZONE_WIDTH);
    expect(plan.zones[0].height).toBe(DEFAULT_ZONE_HEIGHT);
  });

  it("will not let anything be larger than the hall holding it", () => {
    const plan = toFloorPlan({
      zones: [
        {
          id: "z1",
          name: "Alcove",
          width: 300,
          height: 300,
          tables: [{ id: "t1", label: "1", width: 900, height: 900 }],
          features: [],
        },
      ],
    });

    const [only] = plan.zones[0].tables;
    expect(only.width).toBeLessThanOrEqual(300);
    expect(only.height).toBeLessThanOrEqual(300);
  });

  it("pulls a table inside when the hall it stands in is shrunk", () => {
    const plan = toFloorPlan({
      zones: [
        {
          id: "z1",
          name: "Shrunk",
          width: 400,
          height: 400,
          tables: [{ id: "t1", label: "1", x: 1200, y: 800, width: 70, height: 70 }],
          features: [],
        },
      ],
    });

    const [only] = plan.zones[0].tables;
    expect(only.x).toBeLessThanOrEqual(400 - only.width);
    expect(only.y).toBeLessThanOrEqual(400 - only.height);
  });
});

describe("real-world dimensions", () => {
  it("says centimetres as centimetres and metres as metres", () => {
    expect(formatLength(70)).toBe("70 cm");
    expect(formatLength(CM_PER_M)).toBe("1 m");
    expect(formatLength(1400)).toBe("14 m");
    expect(formatLength(120)).toBe("1.2 m");
  });

  it("gives the floor area in square metres", () => {
    expect(zoneArea({ width: 1400, height: 900 })).toBe(126);
    expect(zoneArea({ width: 350, height: 250 })).toBe(8.8);
  });
});

describe("chairs", () => {
  it("draws one chair per seat", () => {
    expect(chairPositions({ seats: 6, shape: "rectangle", width: 120, height: 70 })).toHaveLength(6);
    expect(chairPositions({ seats: 4, shape: "round", width: 70, height: 70 })).toHaveLength(4);
  });

  /**
   * The chairs are derived, so changing the seat count changes the drawing.
   * There is no way for the two to disagree, which is the reason they are not
   * stored as separate objects somebody could forget to update.
   */
  it("follows the seat count rather than being placed by hand", () => {
    const table = { shape: "round" as const, width: 70, height: 70 };

    expect(chairPositions({ ...table, seats: 2 })).toHaveLength(2);
    expect(chairPositions({ ...table, seats: 8 })).toHaveLength(8);
    expect(chairPositions({ ...table, seats: 0 })).toEqual([]);
  });

  it("puts more chairs along the long sides of a rectangle", () => {
    const chairs = chairPositions({ seats: 6, shape: "rectangle", width: 240, height: 70 });
    const above = chairs.filter((chair) => chair.y < 0).length;
    const below = chairs.filter((chair) => chair.y > 70).length;

    // A long table seats people down its length, not crowded at the ends.
    expect(above + below).toBeGreaterThan(chairs.length - above - below);
  });

  it("places every chair clear of the table it belongs to", () => {
    for (const chair of chairPositions({ seats: 4, shape: "square", width: 70, height: 70 })) {
      const clear =
        chair.x + 42 <= 0 || chair.x >= 70 || chair.y + 42 <= 0 || chair.y >= 70;
      expect(clear).toBe(true);
    }
  });
});

describe("how many chairs", () => {
  it("draws as many as the table seats when nothing says otherwise", () => {
    expect(chairPositions({ seats: 5, shape: "round", width: 70, height: 70 })).toHaveLength(5);
  });

  /**
   * The room does not always agree with the arithmetic — a four-top laid with
   * two chairs against a wall, or a spare chair pulled up for a child. The seat
   * count stays the truth for booking; this is only what is drawn.
   */
  it("draws the number asked for when one is given", () => {
    expect(chairPositions({ seats: 4, chairCount: 2, shape: "square", width: 70, height: 70 })).toHaveLength(2);
    expect(chairPositions({ seats: 4, chairCount: 7, shape: "square", width: 70, height: 70 })).toHaveLength(7);
  });

  it("treats a chair count of zero as none, not as unset", () => {
    expect(chairPositions({ seats: 6, chairCount: 0, shape: "round", width: 70, height: 70 })).toEqual([]);
  });

  it("keeps a chair count through a save and a read", () => {
    const plan = toFloorPlan({
      zones: [{ id: "z1", name: "Main", tables: [{ id: "t1", label: "1", seats: 4, chairCount: 2 }], features: [] }],
    });

    expect(plan.zones[0].tables[0].chairCount).toBe(2);
    // Unset stays unset rather than becoming the seat count, so "as many as it
    // seats" keeps following the seats.
    const unset = toFloorPlan({
      zones: [{ id: "z1", name: "Main", tables: [{ id: "t1", label: "1", seats: 4 }], features: [] }],
    });
    expect(unset.zones[0].tables[0].chairCount).toBeUndefined();
  });
});
