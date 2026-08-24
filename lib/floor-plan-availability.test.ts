import { describe, expect, it } from "vitest";
import {
  MAX_COMBINATIONS_PER_ROW,
  findPlanCombination,
  offerTables,
} from "@/lib/floor-plan-availability";
import type { ChairSide, FloorPlan, FloorTable } from "@/lib/floor-plan";
import type { TableClaimRecord } from "@/lib/services/table-claims";

function table(over: Partial<FloorTable> & { id: string; label: string; seats: number }): FloorTable {
  return {
    shape: "square",
    active: true,
    x: 0,
    y: 0,
    width: 70,
    height: 70,
    rotation: 0,
    ...over,
  };
}

/**
 * Stands tables in a row, each linked to the next.
 *
 * Written from both ends here, the way `toFloorZone` writes it on the way in —
 * these plans are built by hand and never go through it, so a helper that
 * linked one end only would be testing a plan the app cannot hold.
 */
function row(tables: FloorTable[], side: ChairSide = "right"): FloorTable[] {
  const back = side === "left" ? "right" : side === "right" ? "left" : side === "top" ? "bottom" : "top";

  return tables.map((entry, index) => {
    const neighbours = [
      ...(tables[index + 1] ? [{ tableId: tables[index + 1].id, side }] : []),
      ...(tables[index - 1] ? [{ tableId: tables[index - 1].id, side: back as ChairSide }] : []),
    ];

    return { ...entry, neighbours };
  });
}

function plan(tables: FloorTable[]): FloorPlan {
  return {
    zones: [{ id: "z1", name: "Main hall", width: 1400, height: 900, tables, features: [] }],
  };
}

function claim(tableId: string, guests: number, reservationNumber = "R-1"): TableClaimRecord {
  return { date: "2026-08-25", tableId, guests, reservationNumbers: [reservationNumber] };
}

/**
 * The room this is all about: 11 next to 1 on its left, 12 next to 11 on its
 * left, 13 next to 12 on its left — so left to right the row stands 13, 12,
 * 11, 1, which is the order it is written in here and the order it comes back
 * in. A two-top sits on its own across the floor.
 */
const ROW = plan([
  ...row([
    table({ id: "t13", label: "13", seats: 4 }),
    table({ id: "t12", label: "12", seats: 4 }),
    table({ id: "t11", label: "11", seats: 4 }),
    table({ id: "t1", label: "1", seats: 4 }),
  ]),
  table({ id: "t20", label: "20", seats: 2 }),
]);

describe("a party no single table can take", () => {
  it("pushes two neighbours together", () => {
    const [zone] = offerTables(ROW, [], 5);

    expect(zone.combinations[0]).toMatchObject({
      id: "t13+t12",
      tableIds: ["t13", "t12"],
      labels: ["13", "12"],
      axis: "horizontal",
    });
  });

  it("offers every place along the row the party fits", () => {
    /**
     * Four tables in a line hold a party of five in three places, and they are
     * not the same offer: one end of the row is by the window and the other is
     * by the door. Which of those a guest wants is the question the picker is
     * asking.
     */
    const [zone] = offerTables(ROW, [], 5);

    expect(zone.combinations.map((entry) => entry.id)).toEqual([
      "t13+t12",
      "t12+t11",
      "t11+t1",
    ]);
  });

  it("never offers more tables than the party needs", () => {
    // Every offer is the same length — the fewest that will do. Where is the
    // guest's choice; how many is not.
    const lengths = new Set(offerTables(ROW, [], 5)[0].combinations.map((e) => e.tableIds.length));

    expect([...lengths]).toEqual([2]);
  });

  it("does not sell the chairs that are lost where the tables meet", () => {
    // Two four-tops pushed together seat six, not eight: the chair on 13's
    // right and the one on 12's left are standing where the other table is.
    expect(offerTables(ROW, [], 5)[0].combinations[0].seats).toBe(6);
  });

  it("refuses a party the row cannot seat once the join is paid for", () => {
    // 4 + 4 is eight seats on paper and six in the room, so a party of seven
    // is not offered the pair — it is offered three tables.
    const [zone] = offerTables(ROW, [], 7);

    expect(zone.combinations[0].tableIds).toEqual(["t13", "t12", "t11"]);
    expect(zone.combinations[0].seats).toBe(8);
  });

  it("keeps the chairs a side that was already cleared never had", () => {
    // Staff who laid these tables for two knew they meet on the left and the
    // right, so there was never a chair there to lose: 2 + 2 seats four.
    const cleared = plan(
      row([
        table({ id: "t1", label: "1", seats: 2, chairSides: ["top", "bottom"] }),
        table({ id: "t2", label: "2", seats: 2, chairSides: ["top", "bottom"] }),
      ]),
    );

    expect(offerTables(cleared, [], 4)[0].combinations[0].seats).toBe(4);
  });

  it("offers nothing when a single table would have done", () => {
    // Pushing tables together is work, and it takes a second table out of the
    // room. A party of four gets the four-top.
    expect(offerTables(ROW, [], 4)[0].combinations).toEqual([]);
  });

  it("will not push together tables that are not next to each other", () => {
    const strangers = plan([
      table({ id: "t1", label: "1", seats: 4 }),
      table({ id: "t2", label: "2", seats: 4 }),
    ]);

    expect(offerTables(strangers, [], 5)[0].combinations).toEqual([]);
  });

  it("never reaches past a table to the one beyond it", () => {
    // 13 and 11 are both in the row and are not neighbours: 12 stands between
    // them, and no combination may skip it.
    const offered = offerTables(ROW, [], 5)[0].combinations.map((entry) => entry.id);

    expect(offered).not.toContain("t13+t11");
  });

  it("is broken in two by a table somebody is already on", () => {
    /**
     * 12 is sold, so 13 and 11 are not two tables pushed together — they are
     * two tables with somebody's dinner between them. What is left is 11 + 1,
     * and 13 standing alone.
     */
    const [zone] = offerTables(ROW, [claim("t12", 2)], 5);

    expect(zone.combinations.map((entry) => entry.id)).toEqual(["t11+t1"]);
  });

  it("will not use a table somebody is already on, even with a seat to spare", () => {
    // Half a table cannot be pushed against a stranger's dinner.
    const [zone] = offerTables(ROW, [claim("t13", 1), claim("t11", 1), claim("t20", 1)], 5);

    expect(zone.combinations).toEqual([]);
  });

  it("says nothing at all when the whole row is still too small", () => {
    expect(offerTables(ROW, [], 20)[0].combinations).toEqual([]);
  });

  it("takes as few tables as it can, then as few seats", () => {
    const mixed = plan(
      row([
        table({ id: "t1", label: "1", seats: 6, width: 120 }),
        table({ id: "t2", label: "2", seats: 6, width: 120 }),
        table({ id: "t3", label: "3", seats: 4 }),
      ]),
    );

    /**
     * Seven people fit on 1 + 2, which seats ten, and on 2 + 3, which seats
     * eight. Both are two tables; the second leaves a six-top free for a party
     * that needs a six-top.
     */
    const [zone] = offerTables(mixed, [], 7);

    expect(zone.combinations[0].tableIds).toEqual(["t2", "t3"]);
    expect(zone.combinations[0].seats).toBe(8);
  });

  it("uses three tables when two will not reach", () => {
    expect(offerTables(ROW, [], 8)[0].combinations[0].tableIds).toEqual(["t13", "t12", "t11"]);
  });

  it("offers one combination per row, and rows run either way", () => {
    const halls = plan([
      ...row([
        table({ id: "a1", label: "1", seats: 4 }),
        table({ id: "a2", label: "2", seats: 4 }),
      ]),
      // Standing one above the other rather than side by side, which is a row
      // just the same — and a separate one.
      ...row(
        [
          table({ id: "b1", label: "8", seats: 4 }),
          table({ id: "b2", label: "9", seats: 4 }),
        ],
        "bottom",
      ),
    ]);

    const [zone] = offerTables(halls, [], 5);

    expect(zone.combinations.map((entry) => entry.id)).toEqual(["a1+a2", "b1+b2"]);
    expect(zone.combinations.map((entry) => entry.seats)).toEqual([6, 6]);
    expect(zone.combinations[0].axis).toBe("horizontal");
    expect(zone.combinations[1].axis).toBe("vertical");
  });

  it("leaves an out-of-service table out of the pushing", () => {
    const broken = plan(
      row([
        table({ id: "t1", label: "1", seats: 4 }),
        table({ id: "t2", label: "2", seats: 4, active: false }),
      ]),
    );

    expect(offerTables(broken, [], 5)[0].combinations).toEqual([]);
  });

  it("leaves an unlabelled table out of it too", () => {
    // The labels become the booking's table number; one without a label could
    // not be named on the sheet.
    const unlabelled = plan(
      row([
        table({ id: "t1", label: "1", seats: 4 }),
        table({ id: "t2", label: "  ", seats: 4 }),
      ]),
    );

    expect(offerTables(unlabelled, [], 5)[0].combinations).toEqual([]);
  });
});

describe("a row of six two-tops", () => {
  /** Six two-tops in a line, which is the room this was reported from. */
  const TWOS = plan(
    row(
      ["1", "2", "3", "4", "5", "6"].map((label) =>
        table({ id: `t${label}`, label, seats: 2 }),
      ),
    ),
  );

  it("seats a party of six on three of them, in four places", () => {
    const [zone] = offerTables(TWOS, [], 6);

    expect(zone.combinations.map((entry) => entry.id)).toEqual([
      "t1+t2+t3",
      "t2+t3+t4",
      "t3+t4+t5",
      "t4+t5+t6",
    ]);
    expect(zone.combinations.every((entry) => entry.seats === 6)).toBe(true);
  });

  it("loses no seats joining them, since a two-top is laid top and bottom", () => {
    // A 70cm square seating two puts both chairs on its long-facing sides, so
    // pushing them together left to right takes nothing away.
    expect(offerTables(TWOS, [], 6)[0].combinations[0].seats).toBe(6);
  });

  it("offers fewer places as the row fills up", () => {
    // Table 3 is sold, so the row is 1–2 and 4–5–6. Only one stretch of three
    // survives.
    const [zone] = offerTables(TWOS, [claim("t3", 2)], 6);

    expect(zone.combinations.map((entry) => entry.id)).toEqual(["t4+t5+t6"]);
  });

  it("takes two of them for a party of four", () => {
    const [zone] = offerTables(TWOS, [], 4);

    expect(zone.combinations.map((entry) => entry.tableIds.length)).toEqual([2, 2, 2, 2, 2]);
    expect(zone.combinations[0].id).toBe("t1+t2");
  });

  it("caps how many places are listed, so the list stays a choice", () => {
    const long = plan(
      row(
        Array.from({ length: 20 }, (_, index) =>
          table({ id: `t${index}`, label: String(index), seats: 2 }),
        ),
      ),
    );

    expect(offerTables(long, [], 6)[0].combinations.length).toBeLessThanOrEqual(
      MAX_COMBINATIONS_PER_ROW,
    );
  });
});

describe("a table bigger than the party needs", () => {
  it("is kept back while a table that fits better is free", () => {
    // A party of two cannot take a four-top while the two-top is free: the
    // four-top is the only table left for a party of four.
    const [zone] = offerTables(ROW, [], 2);

    expect(zone.tables.find((entry) => entry.id === "t20")?.unavailable).toBeUndefined();
    expect(zone.tables.find((entry) => entry.id === "t13")?.unavailable).toBe("kept-for-larger");
  });

  it("opens up once nothing smaller is left", () => {
    // The two-top is sold, so the four-tops are what the room has.
    const [zone] = offerTables(ROW, [claim("t20", 2)], 2);

    expect(zone.tables.find((entry) => entry.id === "t13")?.unavailable).toBeUndefined();
  });

  it("never refuses every table", () => {
    const onlyBig = plan([
      table({ id: "t1", label: "1", seats: 8, width: 200 }),
      table({ id: "t2", label: "2", seats: 10, width: 240 }),
    ]);

    const [zone] = offerTables(onlyBig, [], 2);

    // Something always holds the tightest fit, and here it is the eight-top.
    expect(zone.tables.find((entry) => entry.id === "t1")?.unavailable).toBeUndefined();
    expect(zone.tables.find((entry) => entry.id === "t2")?.unavailable).toBe("kept-for-larger");
  });

  it("is measured on the seats still free, not the size of the table", () => {
    /**
     * Two of the six-top's seats are left and the party is two, so it wastes
     * nothing — while the empty four-top would waste two. Joining the shared
     * table is the use of the room that costs it least.
     */
    const shared = plan([
      table({ id: "t6", label: "6", seats: 6, width: 120 }),
      table({ id: "t4", label: "4", seats: 4 }),
    ]);

    const [zone] = offerTables(shared, [claim("t6", 4)], 2);

    expect(zone.tables.find((entry) => entry.id === "t6")?.unavailable).toBeUndefined();
    expect(zone.tables.find((entry) => entry.id === "t4")?.unavailable).toBe("kept-for-larger");
  });

  it("is decided hall by hall, so a guest is not sent to another room", () => {
    const halls: FloorPlan = {
      zones: [
        { id: "z1", name: "Main hall", width: 1400, height: 900, tables: [table({ id: "t2", label: "2", seats: 2 })], features: [] },
        { id: "z2", name: "Terrace", width: 1400, height: 900, tables: [table({ id: "t4", label: "4", seats: 4 })], features: [] },
      ],
    };

    // The terrace has only four-tops. A party of two who want the terrace are
    // not told it is closed to them because the main hall has a smaller table.
    const [, terrace] = offerTables(halls, [], 2);

    expect(terrace.tables[0].unavailable).toBeUndefined();
  });

  it("does not push tables together for a party a single table would fit", () => {
    // Every four-top is kept back for a larger party, but a four-top still
    // *fits* two — so the answer is a smaller table, never two joined ones.
    expect(offerTables(ROW, [], 2)[0].combinations).toEqual([]);
  });
});

describe("resolving a combination back from the plan", () => {
  it("resolves the tables, the seats they really have and the label they carry", () => {
    const found = findPlanCombination(ROW, "t11+t1");

    expect(found?.tables.map((entry) => entry.id)).toEqual(["t11", "t1"]);
    expect(found?.seats).toBe(6);
    expect(found?.label).toBe("11 + 1");
  });

  it("resolves a single table, so a caller need not know which it holds", () => {
    expect(findPlanCombination(ROW, "t20")?.label).toBe("20");
    expect(findPlanCombination(ROW, "t20")?.seats).toBe(2);
  });

  it("refuses two tables that do not touch", () => {
    // The request a shared group name could never have caught: 1 and 12 are
    // both in the row, and 11 is standing between them.
    expect(findPlanCombination(ROW, "t1+t12")).toBeNull();
  });

  it("refuses a row with a gap in the middle", () => {
    expect(findPlanCombination(ROW, "t13+t12+t1")).toBeNull();
  });

  it("refuses tables given out of the order they stand in", () => {
    expect(findPlanCombination(ROW, "t12+t13+t11")).toBeNull();
  });

  it("refuses a row that doubles back on itself", () => {
    // Down one side and back up the other is not a row of tables, and it would
    // claim a table twice over if the ids differed.
    const bent = plan([
      {
        ...table({ id: "t1", label: "1", seats: 4 }),
        neighbours: [
          { tableId: "t2", side: "left" },
          { tableId: "t3", side: "top" },
        ],
      },
      { ...table({ id: "t2", label: "2", seats: 4 }), neighbours: [{ tableId: "t1", side: "right" }] },
      { ...table({ id: "t3", label: "3", seats: 4 }), neighbours: [{ tableId: "t1", side: "bottom" }] },
    ]);

    expect(findPlanCombination(bent, "t2+t1+t3")).toBeNull();
  });

  it("refuses a table named twice", () => {
    // It would claim one table twice and seat a party that does not fit at it.
    expect(findPlanCombination(ROW, "t13+t13")).toBeNull();
  });

  it("refuses anything that is not on the plan, or is out of service", () => {
    expect(findPlanCombination(ROW, "nope")).toBeNull();
    expect(findPlanCombination(ROW, "t13+nope")).toBeNull();
    expect(findPlanCombination(ROW, "")).toBeNull();
  });
});
