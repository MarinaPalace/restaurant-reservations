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

/**
 * Two or more tables pushed together for one party.
 *
 * A restaurant of four-tops cannot seat five at a table, and refusing the
 * booking over it would be absurd — staff would push two together, which is
 * what this is. Which tables *may* be pushed together is a fact about the room,
 * written on the plan as a `mergeGroup` rather than guessed from coordinates:
 * two tables 30 cm apart may have a pillar between them, and two a metre apart
 * may be joined every Saturday.
 *
 * ## A combination is taken whole
 *
 * `seats` is what the tables seat between them, and **every one of those seats
 * is claimed** — not only the ones the party fills. Nobody can be seated at a
 * table pushed against a stranger's dinner, so a party of five on two four-tops
 * takes both tables entirely, and the offer says so rather than pretending
 * three seats are still going.
 */
export type TableCombination = {
  /**
   * The table ids joined with `+`, in the order they are offered.
   *
   * Doubles as the value a guest's screen sends back, so one field carries
   * either a table or a combination and nothing downstream has to be told which
   * it is holding. `findPlanCombination` resolves it **from the plan**, so a
   * request cannot invent a combination the room does not allow (rule 2.6).
   */
  id: string;
  tableIds: string[];
  /** What they are called, in the same order. Becomes "7 + 8" on the booking. */
  labels: string[];
  /** Every seat of every table in it. */
  seats: number;
  /** The group on the plan that permits this. */
  mergeGroup: string;
};

export type ZoneOffer = {
  id: string;
  name: string;
  width: number;
  height: number;
  tables: TableOffer[];
  /**
   * Tables pushed together, offered only when no single table would do.
   *
   * Empty on every plan that names no merge groups, which is every plan drawn
   * before they existed.
   */
  combinations: TableCombination[];
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
    combinations: combineTables(zone.tables, seated, guests),
  }));
}

/**
 * The tables to push together for a party no single table can take.
 *
 * ## One answer per group, not a menu
 *
 * A group of four tables offers eleven combinations that would fit a party of
 * five, and a guest asked to choose between them is being asked to do the
 * maitre d's job. Each group therefore offers **one**: the fewest tables that
 * will do, and among those the fewest seats — so a party of five is given two
 * four-tops rather than a four and a six, and the six is still there for the
 * party of six.
 *
 * ## Only when nothing else will do
 *
 * A combination is offered only if no single table in the zone fits the party.
 * Pushing tables together is work for staff and it takes two tables out of the
 * room; offering it beside a four-top that would have done loses a table for
 * nothing.
 *
 * ## Whole tables only
 *
 * Every table in a combination must be **completely free** — not merely free
 * enough. Half a table cannot be pushed against somebody else's dinner.
 */
function combineTables(
  tables: readonly FloorTable[],
  seated: Map<string, number>,
  guests: number,
): TableCombination[] {
  if (guests < 1) {
    return [];
  }

  // A table on its own would do, so nothing needs pushing together.
  const fitsAlone = tables.some(
    (table) =>
      table.label.trim().length > 0 && !reasonUnavailable(table, seated.get(table.id) ?? 0, guests),
  );

  if (fitsAlone) {
    return [];
  }

  const groups = new Map<string, FloorTable[]>();

  for (const table of tables) {
    const group = (table.mergeGroup ?? "").trim();

    if (!group || !table.active || !table.label.trim() || (seated.get(table.id) ?? 0) > 0) {
      continue;
    }

    groups.set(group, [...(groups.get(group) ?? []), table]);
  }

  const combinations: TableCombination[] = [];

  for (const [group, members] of groups) {
    const chosen = fewestTablesThatFit(members, guests);

    // One table is not a combination — and if one had been enough, the check
    // above would already have offered it on its own.
    if (chosen.length < 2) {
      continue;
    }

    combinations.push({
      id: chosen.map((table) => table.id).join("+"),
      tableIds: chosen.map((table) => table.id),
      labels: chosen.map((table) => table.label),
      seats: chosen.reduce((total, table) => total + table.seats, 0),
      mergeGroup: group,
    });
  }

  // The tightest fit first: it is the one that costs the room least.
  return combinations.sort((a, b) => a.seats - b.seats || a.tableIds.length - b.tableIds.length);
}

/**
 * The smallest set of tables from one group that seats the party.
 *
 * Biggest first, so "as few tables as possible" falls out of taking them in
 * order — then each is swapped for the smallest table that still leaves
 * everybody a seat, which turns "6 + 4 for a party of seven" into "4 + 4":
 * the same two tables, two seats less out of the room, and the six-top still
 * free for a party that needs it.
 *
 * Not an optimum. The exact answer is a subset-sum and a dining room is not
 * worth one; this gets the cases a real room produces.
 */
function fewestTablesThatFit(members: readonly FloorTable[], guests: number): FloorTable[] {
  const ordered = [...members].sort(
    (a, b) => b.seats - a.seats || a.label.localeCompare(b.label, undefined, { numeric: true }),
  );

  const chosen: FloorTable[] = [];
  let seats = 0;

  for (const table of ordered) {
    if (seats >= guests) {
      break;
    }

    chosen.push(table);
    seats += table.seats;
  }

  if (seats < guests) {
    // Not enough room even with the whole group.
    return [];
  }

  for (let index = 0; index < chosen.length; index += 1) {
    const withoutThis = chosen.reduce((total, table, at) => (at === index ? total : total + table.seats), 0);

    const smaller = ordered
      .filter((table) => !chosen.includes(table))
      .sort((a, b) => a.seats - b.seats)
      .find((table) => withoutThis + table.seats >= guests && table.seats < chosen[index].seats);

    if (smaller) {
      chosen[index] = smaller;
    }
  }

  // Back into the order the room is drawn in, so "7 + 8" does not come out as
  // "8 + 7" for no reason a guest could see.
  return chosen.sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }));
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

/**
 * Whether anything at all could be offered. Decides if the step is worth
 * showing, and whether the screen says "we will seat you" instead.
 *
 * **Combinations count.** A room of four-tops offers nothing at all to a party
 * of five by this measure without them — which is precisely the evening the
 * pushing-together exists for, and the screen would refuse the very thing it
 * had just worked out.
 */
export function hasOffer(zones: readonly ZoneOffer[]): boolean {
  return zones.some(
    (zone) => zone.tables.some((table) => !table.unavailable) || zone.combinations.length > 0,
  );
}

/**
 * The tables behind a combination id, for the route that has to claim them.
 *
 * Resolved from the plan, like `findPlanTable` and for the same reason (rule
 * 2.6): a request able to name its own combination could push together two
 * tables at opposite ends of the room. Every id must exist, be in service, be
 * labelled, and — the point — **share one merge group**, which is the plan's
 * own statement that those tables may be joined.
 *
 * A single id resolves too, so a caller never has to know in advance whether it
 * is holding one table or several.
 */
export function findPlanCombination(
  plan: FloorPlan,
  combinationId: string,
): { tables: FloorTable[]; seats: number; label: string } | null {
  const ids = combinationId
    .split("+")
    .map((id) => id.trim())
    .filter(Boolean);

  // A repeated id would claim one table twice and seat a party that does not
  // fit at it.
  if (ids.length === 0 || new Set(ids).size !== ids.length) {
    return null;
  }

  const found = ids.map((id) => findPlanTable(plan, id));

  if (found.some((table) => !table || !table.active || !table.label.trim())) {
    return null;
  }

  const tables = found as FloorTable[];

  if (tables.length > 1) {
    const groups = new Set(tables.map((table) => (table.mergeGroup ?? "").trim()));

    if (groups.size !== 1 || groups.has("")) {
      return null;
    }
  }

  return {
    tables,
    seats: tables.reduce((total, table) => total + table.seats, 0),
    // The label a shared table has always had: what staff read off the sheet.
    label: tables.map((table) => table.label).join(" + "),
  };
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
