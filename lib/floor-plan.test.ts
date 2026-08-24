import { describe, expect, it } from "vitest";
import { floorPlanSchema } from "@/lib/validation/booking";
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
  CHAIR_SIZE,
  CHAIR_SIDES,
  chairPositions,
  chairSidesOf,
  clampPosition,
  rotatedExtent,
  clampSize,
  clampZoneSize,
  formatLength,
  countPlan,
  countZone,
  DEFAULT_FLOOR_PLAN_MODE,
  FLOOR_PLAN_MODES,
  bookableTables,
  describePlanProblems,
  duplicateLabels,
  isFloorPlanMode,
  resolveFloorPlanMode,
  toFloorPlanMode,
  newFeature,
  newTable,
  newZone,
  forgetTable,
  joinedSeats,
  linkTables,
  rowThrough,
  seatsOnSide,
  seatsPerSide,
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

/**
 * Turning something changes how much floor it covers, and the hall has to be
 * measured against what it covers rather than against what it stores.
 */
describe("something that has been turned", () => {
  const hall = { width: 1400, height: 900 };

  it("covers the floor its rotated footprint covers", () => {
    expect(rotatedExtent({ width: 160, height: 20 }, 0)).toEqual({ width: 160, height: 20 });

    const upright = rotatedExtent({ width: 160, height: 20 }, 90);
    expect(upright.width).toBeCloseTo(20);
    expect(upright.height).toBeCloseTo(160);

    // A quarter turn either way is the same footprint as the other.
    expect(rotatedExtent({ width: 160, height: 20 }, 270).width).toBeCloseTo(20);
  });

  /**
   * The bug this fixes. A 160-long window stood on end against the right wall
   * could get no closer to it than 70 cm — half the difference between its
   * length and its depth — because the *unrotated* box was what was clamped.
   * A longer window was held further out still, which is what staff saw as
   * "at least a metre of margin I cannot close".
   */
  it("lets a window stood on end sit flush against the side wall", () => {
    const window = { width: 160, height: 20, rotation: 90 };
    const placed = clampPosition({ x: 99_999, y: 200, ...window }, hall);

    // Where the glass actually is: the centre of the stored box, plus half the
    // depth it covers once turned.
    const centre = placed.x + window.width / 2;
    expect(centre + rotatedExtent(window, 90).width / 2).toBeCloseTo(hall.width);

    // Which means the stored x is legitimately negative at the near wall.
    const near = clampPosition({ x: -99_999, y: 200, ...window }, hall);
    expect(near.x + window.width / 2 - rotatedExtent(window, 90).width / 2).toBeCloseTo(0);
    expect(near.x).toBeLessThan(0);
  });

  it("holds a thing set on the diagonal inside the walls", () => {
    const wall = { width: 240, height: 20, rotation: 45 };
    const placed = clampPosition({ x: 99_999, y: 99_999, ...wall }, hall);
    const extent = rotatedExtent(wall, 45);

    expect(placed.x + wall.width / 2 + extent.width / 2).toBeCloseTo(hall.width);
    expect(placed.y + wall.height / 2 + extent.height / 2).toBeCloseTo(hall.height);
  });

  it("leaves anything square to the room exactly where it was", () => {
    // The whole point: no existing plan moves by a millimetre on being read.
    expect(clampPosition({ x: 1100, y: 0, width: 300, height: 60, rotation: 0 }, hall)).toEqual({ x: 1100, y: 0 });
    expect(clampPosition({ x: 99_999, y: 99_999, width: 300, height: 60, rotation: 180 }, hall)).toEqual({
      x: 1100,
      y: 840,
    });
  });

  it("keeps a turned thing inside the hall on the way in", () => {
    const plan = toFloorPlan({
      zones: [
        {
          id: "z1",
          name: "Main",
          width: 1400,
          height: 900,
          tables: [],
          features: [{ id: "w1", kind: "window", x: 9_999, y: 100, width: 160, height: 20, rotation: 90 }],
        },
      ],
    });

    const glass = plan.zones[0].features[0];
    expect(glass.x + glass.width / 2 + rotatedExtent(glass, 90).width / 2).toBeCloseTo(1400);
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

/**
 * Which sides the chairs go on. The chairs stay derived — this narrows where
 * they may go, and the count is still shared out between what is left.
 */
describe("which side the chairs go on", () => {
  const above = (chairs: Array<{ y: number }>) => chairs.filter((chair) => chair.y + CHAIR_SIZE <= 0).length;
  const below = (chairs: Array<{ y: number }>, height: number) => chairs.filter((chair) => chair.y >= height).length;
  const leftOf = (chairs: Array<{ x: number }>) => chairs.filter((chair) => chair.x + CHAIR_SIZE <= 0).length;
  const rightOf = (chairs: Array<{ x: number }>, width: number) => chairs.filter((chair) => chair.x >= width).length;

  it("takes all four sides when nothing says otherwise", () => {
    expect(chairSidesOf({})).toEqual([...CHAIR_SIDES]);
    // Lenient in the same direction as `active` and `chairs`: something
    // unusable draws an ordinary table rather than a bare one.
    expect(chairSidesOf({ chairSides: [] })).toEqual([...CHAIR_SIDES]);
  });

  it("lays a table against a wall on the three sides that are free", () => {
    const table = { seats: 6, shape: "rectangle" as const, width: 120, height: 70 };
    const chairs = chairPositions({ ...table, chairSides: ["top", "left", "right"] });

    expect(chairs).toHaveLength(6);
    // Nothing on the side that is against the wall.
    expect(below(chairs, table.height)).toBe(0);
    expect(above(chairs) + leftOf(chairs) + rightOf(chairs, table.width)).toBe(6);
  });

  /**
   * The count is shared out, not dropped. A four-top laid on two sides puts
   * two on each — the chairs that would have gone against the wall are still
   * chairs, and they are still drawn.
   */
  it("shares the chairs out between the sides that are left", () => {
    const banquette = chairPositions({
      seats: 4,
      shape: "rectangle",
      width: 120,
      height: 70,
      chairSides: ["top", "bottom"],
    });

    expect(banquette).toHaveLength(4);
    expect(above(banquette)).toBe(2);
    expect(below(banquette, 70)).toBe(2);
  });

  it("puts them all on one side when that is the only one laid", () => {
    const chairs = chairPositions({ seats: 3, shape: "rectangle", width: 120, height: 70, chairSides: ["top"] });

    expect(chairs).toHaveLength(3);
    expect(above(chairs)).toBe(3);
  });

  it("draws a round table part of the way round", () => {
    const table = { seats: 4, shape: "round" as const, width: 70, height: 70 };
    const half = chairPositions({ ...table, chairSides: ["top", "right"] });

    expect(half).toHaveLength(4);

    /**
     * Two sides next to each other make one arc rather than two, so the chairs
     * flow round the corner instead of bunching at the middle of each side.
     * Top owns the quarter centred on straight up (-90°) and right the quarter
     * centred on 0°, which together run from -135° to 45° — and nothing may
     * fall outside that, because that is where the wall is.
     */
    for (const chair of half) {
      const degrees =
        (Math.atan2(chair.y + CHAIR_SIZE / 2 - table.height / 2, chair.x + CHAIR_SIZE / 2 - table.width / 2) * 180) /
        Math.PI;

      expect(degrees).toBeGreaterThanOrEqual(-135);
      expect(degrees).toBeLessThanOrEqual(45);
    }
  });

  /**
   * Two sides that face each other are two arcs, not one, so a round table
   * laid top and bottom does not quietly fill in the sides between them.
   */
  it("keeps facing sides of a round table apart", () => {
    const chairs = chairPositions({ seats: 4, shape: "round", width: 70, height: 70, chairSides: ["top", "bottom"] });

    expect(chairs).toHaveLength(4);
    expect(chairs.filter((chair) => chair.y + CHAIR_SIZE / 2 < 35)).toHaveLength(2);
    expect(chairs.filter((chair) => chair.y + CHAIR_SIZE / 2 > 35)).toHaveLength(2);
  });

  it("leaves a table with all four sides drawn exactly as it always was", () => {
    const table = { seats: 5, shape: "round" as const, width: 70, height: 70 };

    expect(chairPositions({ ...table, chairSides: [...CHAIR_SIDES] })).toEqual(chairPositions(table));
  });

  it("keeps the sides through a save and a read", () => {
    const plan = toFloorPlan({
      zones: [
        {
          id: "z1",
          name: "Main",
          tables: [
            { id: "t1", label: "1", seats: 4, chairSides: ["top", "nonsense"] },
            // All four is the absent case, stored as absent however it arrives.
            { id: "t2", label: "2", seats: 4, chairSides: ["top", "right", "bottom", "left"] },
            { id: "t3", label: "3", seats: 4, chairSides: [] },
          ],
          features: [],
        },
      ],
    });

    expect(plan.zones[0].tables[0].chairSides).toEqual(["top"]);
    expect(plan.zones[0].tables[1].chairSides).toBeUndefined();
    expect(plan.zones[0].tables[2].chairSides).toBeUndefined();
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

/**
 * The switch — §4, §9 step 2.
 *
 * Three states rather than a boolean, and the one that matters is `off`: it is
 * the default, it is what every existing deployment reads without a migration
 * (rule 2.2), and **off must be indistinguishable from the app as it was
 * before the plan existed**. That is the acceptance criterion for the feature.
 */
describe("who chooses the table", () => {
  const withTable = (table: Partial<FloorTable>): FloorPlan =>
    toFloorPlan({
      zones: [
        {
          id: "z1",
          name: "Main",
          tables: [{ id: "t1", label: "7", seats: 4, active: true, ...table }],
          features: [],
        },
      ],
    });

  it("is off when nothing has ever been chosen", () => {
    expect(DEFAULT_FLOOR_PLAN_MODE).toBe("off");
    expect(toFloorPlanMode(undefined)).toBe("off");
    expect(toFloorPlanMode(null)).toBe("off");
  });

  it("reads back every mode it knows", () => {
    for (const mode of FLOOR_PLAN_MODES) {
      expect(toFloorPlanMode(mode)).toBe(mode);
      expect(isFloorPlanMode(mode)).toBe(true);
    }
  });

  /**
   * The lenient direction matters more here than anywhere else in the module:
   * an unreadable stored value must not leave guests picking tables against a
   * plan the app does not understand.
   */
  it("reads anything it does not recognise as off", () => {
    expect(toFloorPlanMode("enabled")).toBe("off");
    expect(toFloorPlanMode(true)).toBe("off");
    expect(toFloorPlanMode({ mode: "required" })).toBe("off");
    expect(isFloorPlanMode("ON")).toBe(false);
  });

  it("counts only tables a guest could actually be given", () => {
    // In service and labelled.
    expect(bookableTables(withTable({}))).toHaveLength(1);
    // Out of service: it is drawn, and it is not offered.
    expect(bookableTables(withTable({ active: false }))).toHaveLength(0);
    // Unlabelled: a room somebody is still drawing. The label is what becomes
    // a booking's tableNumber, so an unlabelled table could be picked and then
    // not be nameable on the sheet.
    expect(bookableTables(withTable({ label: "  " }))).toHaveLength(0);
  });

  it("says which zone a bookable table stands in", () => {
    expect(bookableTables(withTable({}))[0]).toMatchObject({ zoneId: "z1", zoneName: "Main", label: "7" });
  });

  /**
   * A policy against an empty room is not a policy. `required` would ask every
   * guest to pick and then have nothing to offer, so it degrades rather than
   * refusing them — and it degrades at every read, because the plan can be
   * emptied after the mode was stored.
   */
  it("applies as off while there is nothing bookable in the plan", () => {
    expect(resolveFloorPlanMode("required", EMPTY_PLAN)).toBe("off");
    expect(resolveFloorPlanMode("optional", EMPTY_PLAN)).toBe("off");
    expect(resolveFloorPlanMode("optional", withTable({ active: false }))).toBe("off");
  });

  it("applies as chosen once one table is in service and labelled", () => {
    expect(resolveFloorPlanMode("optional", withTable({}))).toBe("optional");
    expect(resolveFloorPlanMode("required", withTable({}))).toBe("required");
  });

  it("stays off however full the room is", () => {
    expect(resolveFloorPlanMode("off", withTable({}))).toBe("off");
  });
});


/**
 * Tables standing next to each other.
 *
 * The room this is all about: 1, 11, 12 and 13 in a row, each linked to the
 * next, which is what says staff may push them together — and, just as
 * importantly, what says 1 and 12 are not two tables anybody can push together,
 * because 11 is standing between them.
 */
describe("which tables stand next to which", () => {
  /** A row linked rightwards, so the array reads the way the room does. */
  function standing(...ids: string[]): FloorTable[] {
    return ids.map((id, index) => ({
      ...table({ id, label: id, seats: 4, shape: "square" }),
      neighbours: [
        ...(ids[index + 1] ? [{ tableId: ids[index + 1], side: "right" as const }] : []),
        ...(ids[index - 1] ? [{ tableId: ids[index - 1], side: "left" as const }] : []),
      ],
    }));
  }

  it("writes a link from both ends, however it arrived", () => {
    // Said once, in one direction. The other table has to learn it, or a row
    // would be a row from one end and a gap from the other.
    const plan = toFloorPlan({
      zones: [
        {
          id: "z1",
          name: "Main hall",
          tables: [
            { id: "a", label: "1", seats: 4, neighbours: [{ tableId: "b", side: "left" }] },
            { id: "b", label: "11", seats: 4 },
          ],
        },
      ],
    });

    expect(plan.zones[0].tables[0].neighbours).toEqual([{ tableId: "b", side: "left" }]);
    expect(plan.zones[0].tables[1].neighbours).toEqual([{ tableId: "a", side: "right" }]);
  });

  it("drops a link to a table that is not in the hall", () => {
    // Tables cannot be pushed together through a wall, and a link to a table
    // somebody deleted is a row with a hole in it.
    const plan = toFloorPlan({
      zones: [
        {
          id: "z1",
          name: "Main hall",
          tables: [{ id: "a", label: "1", seats: 4, neighbours: [{ tableId: "gone", side: "left" }] }],
        },
      ],
    });

    expect(plan.zones[0].tables[0].neighbours).toBeUndefined();
  });

  it("refuses to stand two tables on the same side of one", () => {
    const plan = toFloorPlan({
      zones: [
        {
          id: "z1",
          name: "Main hall",
          tables: [
            {
              id: "a",
              label: "1",
              seats: 4,
              neighbours: [
                { tableId: "b", side: "left" },
                { tableId: "c", side: "left" },
              ],
            },
            { id: "b", label: "11", seats: 4 },
            { id: "c", label: "12", seats: 4 },
          ],
        },
      ],
    });

    expect(plan.zones[0].tables[0].neighbours).toEqual([{ tableId: "b", side: "left" }]);
    expect(plan.zones[0].tables[2].neighbours).toBeUndefined();
  });

  it("never links a table to itself", () => {
    const plan = toFloorPlan({
      zones: [
        {
          id: "z1",
          name: "Main hall",
          tables: [{ id: "a", label: "1", seats: 4, neighbours: [{ tableId: "a", side: "left" }] }],
        },
      ],
    });

    expect(plan.zones[0].tables[0].neighbours).toBeUndefined();
  });

  it("walks the whole row from any table in it", () => {
    const tables = standing("t13", "t12", "t11", "t1");

    for (const start of ["t13", "t12", "t11", "t1"]) {
      expect(rowThrough(tables, start, "horizontal").map((entry) => entry.id)).toEqual([
        "t13",
        "t12",
        "t11",
        "t1",
      ]);
    }
  });

  it("stops the row where it is told to", () => {
    // How a row of free tables is walked without stepping through somebody
    // else's dinner: a taken table in the middle is two rows, not one.
    const tables = standing("t13", "t12", "t11", "t1");
    const walked = rowThrough(tables, "t11", "horizontal", (entry) => entry.id === "t12");

    expect(walked.map((entry) => entry.id)).toEqual(["t11", "t1"]);
  });

  it("does not confuse a row across with a row down", () => {
    const tables = standing("a", "b");

    expect(rowThrough(tables, "a", "vertical").map((entry) => entry.id)).toEqual(["a"]);
  });

  it("links both ends at once, and displaces whoever stood there", () => {
    const tables = standing("a", "b");
    const linked = linkTables([...tables, table({ id: "c", label: "3" })], "a", "right", "c");

    expect(linked.find((entry) => entry.id === "a")?.neighbours).toEqual([
      { tableId: "c", side: "right" },
    ]);
    expect(linked.find((entry) => entry.id === "c")?.neighbours).toEqual([
      { tableId: "a", side: "left" },
    ]);
    // b was standing there and no longer is — from its own side too.
    expect(linked.find((entry) => entry.id === "b")?.neighbours).toBeUndefined();
  });

  it("unlinks the table it displaces from both ends", () => {
    /**
     * c already had b on its left. Putting a there pushes b out, and b has to
     * stop naming c as well — a half-erased link wins the disagreement in
     * `toFloorZone` if it is read first, and the join comes back on the save.
     */
    const moved = linkTables([...standing("b", "c"), table({ id: "a", label: "3" })], "a", "right", "c");

    expect(moved.find((entry) => entry.id === "b")?.neighbours).toBeUndefined();
    expect(moved.find((entry) => entry.id === "c")?.neighbours).toEqual([
      { tableId: "a", side: "left" },
    ]);
  });

  it("survives being saved and read back", () => {
    // The check that the two halves agree: whatever `linkTables` leaves behind
    // has to come back out of `toFloorPlan` unchanged.
    const moved = linkTables([...standing("b", "c"), table({ id: "a", label: "3" })], "a", "right", "c");
    const read = toFloorPlan({ zones: [{ id: "z1", name: "Main hall", tables: moved }] });

    expect(read.zones[0].tables.map((entry) => entry.neighbours)).toEqual([
      undefined,
      [{ tableId: "a", side: "left" }],
      [{ tableId: "c", side: "right" }],
    ]);
  });

  it("clears a side when nothing is put on it", () => {
    const cleared = linkTables(standing("a", "b"), "a", "right", null);

    expect(cleared.find((entry) => entry.id === "a")?.neighbours).toBeUndefined();
    expect(cleared.find((entry) => entry.id === "b")?.neighbours).toBeUndefined();
  });

  it("takes a deleted table out of the rows it stood in", () => {
    const left = forgetTable(standing("a", "b", "c"), "b");

    expect(left.map((entry) => entry.id)).toEqual(["a", "c"]);
    expect(left.every((entry) => !entry.neighbours)).toBe(true);
  });
});

/**
 * The chairs lost where two tables meet.
 *
 * Two four-tops pushed together seat six. The other answer — eight — seats two
 * people on chairs that are standing where the other table now is, which is the
 * kind of mistake a guest discovers on the night.
 */
describe("what a row of tables actually seats", () => {
  it("lays a square table on all four sides", () => {
    expect(seatsPerSide(table({ seats: 4, shape: "square" }))).toEqual({
      top: 1,
      right: 1,
      bottom: 1,
      left: 1,
    });
  });

  it("puts a long table's seats along its length", () => {
    // Which is how anybody lays a table up, and it means joining two of them
    // end to end costs far less than joining them side by side.
    const long = table({ seats: 6, shape: "rectangle", width: 120, height: 70 });

    expect(seatsOnSide(long, "top")).toBe(2);
    expect(seatsOnSide(long, "left")).toBe(1);
  });

  it("leaves nothing on a side that was cleared", () => {
    const banquette = table({ seats: 4, shape: "square", chairSides: ["top", "bottom"] });

    expect(seatsPerSide(banquette)).toEqual({ top: 2, right: 0, bottom: 2, left: 0 });
  });

  it("takes the meeting chairs off a pair", () => {
    const [a, b] = [
      { ...table({ id: "a", seats: 4, shape: "square" }), neighbours: [{ tableId: "b", side: "right" as const }] },
      { ...table({ id: "b", seats: 4, shape: "square" }), neighbours: [{ tableId: "a", side: "left" as const }] },
    ];

    expect(joinedSeats([a, b])).toBe(6);
  });

  it("pays for every junction in a longer row", () => {
    const ids = ["a", "b", "c"];
    const row = ids.map((id, index) => ({
      ...table({ id, seats: 4, shape: "square" }),
      neighbours: [
        ...(ids[index + 1] ? [{ tableId: ids[index + 1], side: "right" as const }] : []),
        ...(ids[index - 1] ? [{ tableId: ids[index - 1], side: "left" as const }] : []),
      ],
    }));

    // Twelve seats, two junctions, two seats lost at each.
    expect(joinedSeats(row)).toBe(8);
  });

  it("loses nothing where the tables were never laid", () => {
    // Staff who lay two-tops knowing they meet left and right have already
    // taken those chairs away, so pushing them together costs nothing.
    const sides = ["top", "bottom"] as const;
    const [a, b] = [
      {
        ...table({ id: "a", seats: 2, shape: "square", chairSides: [...sides] }),
        neighbours: [{ tableId: "b", side: "right" as const }],
      },
      {
        ...table({ id: "b", seats: 2, shape: "square", chairSides: [...sides] }),
        neighbours: [{ tableId: "a", side: "left" as const }],
      },
    ];

    expect(joinedSeats([a, b])).toBe(4);
  });

  it("refuses to put a number on tables that do not touch", () => {
    const strangers = [table({ id: "a", seats: 4 }), table({ id: "b", seats: 4 })];

    expect(joinedSeats(strangers)).toBe(0);
  });

  it("is just the table when there is only one", () => {
    expect(joinedSeats([table({ seats: 4 })])).toBe(4);
  });
});


/**
 * The whole way in, as the designer actually saves.
 *
 * The route validates with `floorPlanSchema` and *then* reads the result with
 * `toFloorPlan`, and the schema **strips every field it does not name**. A
 * table field missing from it is therefore not a lax validation — it is a field
 * thrown away on every save, which is how the links between tables came back
 * empty from a room where staff had just drawn them. Nothing here is testable
 * from either half alone.
 */
describe("a plan saved the way the designer saves it", () => {
  const drawn = {
    zones: [
      {
        id: "z1",
        name: "Main hall",
        width: 1400,
        height: 900,
        tables: [
          {
            id: "a",
            label: "1",
            seats: 2,
            shape: "round",
            active: true,
            x: 0,
            y: 0,
            width: 70,
            height: 70,
            rotation: 0,
            chairSides: ["top", "bottom"],
            neighbours: [{ tableId: "b", side: "right" }],
          },
          {
            id: "b",
            label: "2",
            seats: 2,
            shape: "round",
            active: true,
            x: 100,
            y: 0,
            width: 70,
            height: 70,
            rotation: 0,
            neighbours: [{ tableId: "a", side: "left" }],
          },
        ],
        features: [],
      },
    ],
  };

  it("keeps the links through validation and back out again", () => {
    const parsed = floorPlanSchema.safeParse(drawn);
    expect(parsed.success).toBe(true);

    const plan = toFloorPlan(parsed.success ? parsed.data : null);

    expect(plan.zones[0].tables[0].neighbours).toEqual([{ tableId: "b", side: "right" }]);
    expect(plan.zones[0].tables[1].neighbours).toEqual([{ tableId: "a", side: "left" }]);
  });

  it("keeps the other fields a table carries", () => {
    // The same stripping would take any of these, and each has been added to
    // the schema at some point for exactly this reason.
    const plan = toFloorPlan(floorPlanSchema.parse(drawn));

    expect(plan.zones[0].tables[0].chairSides).toEqual(["top", "bottom"]);
    expect(plan.zones[0].tables[0].seats).toBe(2);
  });
});
