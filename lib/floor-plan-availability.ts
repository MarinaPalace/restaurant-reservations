import { allTables, type FloorPlan, type FloorTable, type FloorZone } from "@/lib/floor-plan";
import type { TableClaimRecord } from "@/lib/services/table-claims";

/**
 * Which tables a guest may be offered on one evening.
 *
 * Pure, like `lib/service-board.ts`, and for the same reason: what a guest is
 * allowed to see is the thing most worth being able to test without a browser.
 *
 * ## Never say who has a table
 *
 * `docs/floor-plan.md` §6. "Taken" is all a guest may be told. A plan that
 * leaked "table 7, room 402, four guests" would be a guest list, and the
 * pass-key rules exist precisely because reservation details are not public.
 * So `TableOffer` carries no room, no name, and no reservation number — not
 * hidden in the UI, but **absent from the shape the route can serialise**.
 *
 * The seats already taken are not exposed either. It would be a small leak and
 * still a real one: "table 7 has two of its four seats gone" tells a guest
 * something about a stranger's party.
 */

/** Why a table cannot be picked, when it cannot. */
export type TableUnavailable = "taken" | "too-small" | "out-of-service";

export type TableOffer = {
  id: string;
  label: string;
  seats: number;
  shape: FloorTable["shape"];
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  /** Absent when the table can be picked. */
  unavailable?: TableUnavailable;
};

export type ZoneOffer = {
  id: string;
  name: string;
  width: number;
  height: number;
  tables: TableOffer[];
  /** Walls, windows, the bar — what makes the drawing recognisable. */
  features: FloorZone["features"];
};

/**
 * The room as a guest may see it, for a party of a given size.
 *
 * A table is offered when it is in service, labelled, big enough for the party,
 * and has room left after everybody already claimed on it. Anything else is
 * drawn but not pickable, because a plan with the taken tables missing is a
 * different room every time it loads — and `docs/floor-plan.md` §6 requires
 * that nothing moves under a finger.
 *
 * **Unlabelled tables are dropped entirely**, not shown as unavailable. The
 * label becomes the booking's `tableNumber`; a table without one could be
 * picked and then not be nameable on the service sheet, and drawing it as
 * "taken" would be a lie about a table that is free.
 */
export function offerTables(
  plan: FloorPlan,
  claims: readonly TableClaimRecord[],
  guests: number,
): ZoneOffer[] {
  const seated = new Map(claims.map((claim) => [claim.tableId, claim.guests]));

  return plan.zones.map((zone) => ({
    id: zone.id,
    name: zone.name,
    width: zone.width,
    height: zone.height,
    features: zone.features,
    tables: zone.tables
      .filter((table) => table.label.trim().length > 0)
      .map((table) => {
        const taken = seated.get(table.id) ?? 0;

        return {
          id: table.id,
          label: table.label,
          seats: table.seats,
          shape: table.shape,
          x: table.x,
          y: table.y,
          width: table.width,
          height: table.height,
          rotation: table.rotation,
          unavailable: reasonUnavailable(table, taken, guests),
        };
      }),
  }));
}

function reasonUnavailable(
  table: FloorTable,
  taken: number,
  guests: number,
): TableUnavailable | undefined {
  if (!table.active) {
    return "out-of-service";
  }

  // Ordered so the guest is told the most useful thing. A four-top is
  // "too small" for six whether or not anybody is on it, and being told it is
  // taken would send them back to look at it again later.
  if (table.seats < guests) {
    return "too-small";
  }

  if (taken + guests > table.seats) {
    return "taken";
  }

  return undefined;
}

/** Whether anything at all could be offered. Decides if the step is worth showing. */
export function hasOffer(zones: readonly ZoneOffer[]): boolean {
  return zones.some((zone) => zone.tables.some((table) => !table.unavailable));
}

/**
 * The table behind an id, for the route that has to claim it.
 *
 * Resolved from the plan rather than taken from the request — rule 2.6's habit.
 * A request that named its own seat count could claim a two-top for six.
 */
export function findPlanTable(plan: FloorPlan, tableId: string): FloorTable | null {
  return allTables(plan).find((table) => table.id === tableId) ?? null;
}
