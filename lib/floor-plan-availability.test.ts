import { describe, expect, it } from "vitest";
import { findPlanCombination, offerTables } from "@/lib/floor-plan-availability";
import type { FloorPlan, FloorTable } from "@/lib/floor-plan";
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

function plan(tables: FloorTable[]): FloorPlan {
  return {
    zones: [{ id: "z1", name: "Main hall", width: 1400, height: 900, tables, features: [] }],
  };
}

function claim(tableId: string, guests: number, reservationNumber = "R-1"): TableClaimRecord {
  return { date: "2026-08-25", tableId, guests, reservationNumbers: [reservationNumber] };
}

/** Four-tops that may be pushed together, which is the room this is all about. */
const FOUR_TOPS = plan([
  table({ id: "t1", label: "1", seats: 4, mergeGroup: "window" }),
  table({ id: "t2", label: "2", seats: 4, mergeGroup: "window" }),
  table({ id: "t3", label: "3", seats: 2 }),
]);

describe("a party no single table can take", () => {
  it("offers two tables pushed together", () => {
    const [zone] = offerTables(FOUR_TOPS, [], 5);

    expect(zone.combinations).toHaveLength(1);
    expect(zone.combinations[0]).toMatchObject({
      id: "t1+t2",
      tableIds: ["t1", "t2"],
      labels: ["1", "2"],
      seats: 8,
      mergeGroup: "window",
    });
  });

  it("offers nothing when a single table would have done", () => {
    // Pushing tables together is work, and it takes a second table out of the
    // room. A party of four gets the four-top.
    expect(offerTables(FOUR_TOPS, [], 4)[0].combinations).toEqual([]);
  });

  it("will not push together tables the plan never said may be", () => {
    const strangers = plan([
      table({ id: "t1", label: "1", seats: 4 }),
      table({ id: "t2", label: "2", seats: 4 }),
    ]);

    expect(offerTables(strangers, [], 5)[0].combinations).toEqual([]);
  });

  it("will not use a table somebody is already on, even with a seat to spare", () => {
    // Half a table cannot be pushed against a stranger's dinner.
    const [zone] = offerTables(FOUR_TOPS, [claim("t2", 1)], 5);

    expect(zone.combinations).toEqual([]);
  });

  it("says nothing at all when the whole group is still too small", () => {
    const small = plan([
      table({ id: "t1", label: "1", seats: 2, mergeGroup: "a" }),
      table({ id: "t2", label: "2", seats: 2, mergeGroup: "a" }),
    ]);

    expect(offerTables(small, [], 9)[0].combinations).toEqual([]);
  });

  it("takes as few tables as it can, then as few seats", () => {
    const mixed = plan([
      table({ id: "t1", label: "1", seats: 6, mergeGroup: "a" }),
      table({ id: "t2", label: "2", seats: 4, mergeGroup: "a" }),
      table({ id: "t3", label: "3", seats: 4, mergeGroup: "a" }),
    ]);

    // Seven people fit on 6+4 and on 4+4. Both are two tables; the second
    // leaves the six-top free for a party that needs a six-top.
    const [zone] = offerTables(mixed, [], 7);

    expect(zone.combinations[0].tableIds).toEqual(["t2", "t3"]);
    expect(zone.combinations[0].seats).toBe(8);
  });

  it("uses three tables when two will not reach", () => {
    const twos = plan([
      table({ id: "t1", label: "1", seats: 2, mergeGroup: "a" }),
      table({ id: "t2", label: "2", seats: 2, mergeGroup: "a" }),
      table({ id: "t3", label: "3", seats: 2, mergeGroup: "a" }),
    ]);

    expect(offerTables(twos, [], 6)[0].combinations[0].tableIds).toEqual(["t1", "t2", "t3"]);
  });

  it("offers one combination per group, tightest first", () => {
    const rooms = plan([
      table({ id: "a1", label: "1", seats: 4, mergeGroup: "window" }),
      table({ id: "a2", label: "2", seats: 4, mergeGroup: "window" }),
      table({ id: "b1", label: "8", seats: 6, mergeGroup: "terrace" }),
      table({ id: "b2", label: "9", seats: 6, mergeGroup: "terrace" }),
    ]);

    const [zone] = offerTables(rooms, [], 7);

    expect(zone.combinations.map((entry) => entry.mergeGroup)).toEqual(["window", "terrace"]);
    expect(zone.combinations[0].seats).toBe(8);
  });

  it("leaves an out-of-service table out of the pushing", () => {
    const broken = plan([
      table({ id: "t1", label: "1", seats: 4, mergeGroup: "a" }),
      table({ id: "t2", label: "2", seats: 4, mergeGroup: "a", active: false }),
    ]);

    expect(offerTables(broken, [], 5)[0].combinations).toEqual([]);
  });

  it("leaves an unlabelled table out of it too", () => {
    // The labels become the booking's table number; one without a label could
    // not be named on the sheet.
    const unlabelled = plan([
      table({ id: "t1", label: "1", seats: 4, mergeGroup: "a" }),
      table({ id: "t2", label: "  ", seats: 4, mergeGroup: "a" }),
    ]);

    expect(offerTables(unlabelled, [], 5)[0].combinations).toEqual([]);
  });
});

describe("resolving a combination back from the plan", () => {
  it("resolves the tables, their seats and the label they will carry", () => {
    const found = findPlanCombination(FOUR_TOPS, "t1+t2");

    expect(found?.tables.map((entry) => entry.id)).toEqual(["t1", "t2"]);
    expect(found?.seats).toBe(8);
    expect(found?.label).toBe("1 + 2");
  });

  it("resolves a single table, so a caller need not know which it holds", () => {
    expect(findPlanCombination(FOUR_TOPS, "t3")?.label).toBe("3");
  });

  it("refuses tables the plan never said may be joined", () => {
    const strangers = plan([
      table({ id: "t1", label: "1", seats: 4, mergeGroup: "a" }),
      table({ id: "t2", label: "2", seats: 4, mergeGroup: "b" }),
    ]);

    expect(findPlanCombination(strangers, "t1+t2")).toBeNull();
  });

  it("refuses a table named twice", () => {
    // It would claim one table twice and seat a party that does not fit at it.
    expect(findPlanCombination(FOUR_TOPS, "t1+t1")).toBeNull();
  });

  it("refuses anything that is not on the plan, or is out of service", () => {
    expect(findPlanCombination(FOUR_TOPS, "nope")).toBeNull();
    expect(findPlanCombination(FOUR_TOPS, "t1+nope")).toBeNull();
    expect(findPlanCombination(FOUR_TOPS, "")).toBeNull();
  });
});
