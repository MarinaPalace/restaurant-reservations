import {
  allTables,
  joinedSeats,
  JOIN_AXES,
  rowThrough,
  type FloorPlan,
  type FloorTable,
  type FloorZone,
  type JoinAxis,
} from "@/lib/floor-plan";
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

/**
 * Why a table cannot be picked, when it cannot.
 *
 * `kept-for-larger` is the one that is not about the table at all: it fits, it
 * is free, and a smaller one that also fits is free as well. See
 * `reasonUnavailable` and `spareSeats`.
 */
export type TableUnavailable = "taken" | "too-small" | "out-of-service" | "kept-for-larger";

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
 * A row of tables pushed together for one party.
 *
 * A restaurant of four-tops cannot seat five at a table, and refusing the
 * booking over it would be absurd — staff would push two together, which is
 * what this is. Which tables *may* be pushed together is a fact about the room,
 * written on the plan as links between neighbours rather than guessed from
 * coordinates: two tables 30 cm apart may have a pillar between them, and two a
 * metre apart may be joined every Saturday.
 *
 * ## Only neighbours, and only in a row
 *
 * Tables stand in a row — 1, 11, 12, 13 — and a combination is a **contiguous
 * stretch** of one: 11 + 12 + 13 is three tables pushed together, 1 + 12 is two
 * tables with a table between them, and 1 + 11 + 13 is a row with a gap in it.
 * Staff cannot push together what is not adjacent, so neither can this.
 *
 * ## The seats are not the sum
 *
 * Two four-tops pushed together seat **six**: the chairs where the tables meet
 * are standing where the other table now is. `seats` is what the row actually
 * seats, junctions already subtracted (`joinedSeats`), because the other number
 * seats two people on furniture that is not in the room.
 *
 * ## A combination is taken whole
 *
 * **Every one of those seats is claimed** — not only the ones the party fills.
 * Nobody can be seated at a table pushed against a stranger's dinner, so a
 * party of five on two four-tops takes both tables entirely, and the offer says
 * so rather than pretending a seat is still going.
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
  /** What the row seats once the chairs lost at each junction are taken off. */
  seats: number;
  /** Which way the row runs. Two rows can cross at a table without joining. */
  axis: JoinAxis;
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
   * Empty on every plan whose tables are not linked to their neighbours, which
   * is every plan drawn before links existed.
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

  return plan.zones.map((zone) => {
    const listed = zone.tables.filter((table) => table.label.trim().length > 0);

    /**
     * The least a table can be left over by this party, in this hall.
     *
     * Every table that would otherwise be offered is measured by what it wastes
     * (`spareSeats`), and only the tightest are pickable — so a party of two
     * cannot take a four-top while a two-top is free, and the four-top is still
     * there for the party of four who would otherwise be turned away.
     *
     * Per hall, not per restaurant: a guest who wants the terrace should not be
     * told the terrace is closed to them because the main hall has a smaller
     * table. Within one hall the choice costs the restaurant a table; between
     * halls it is the guest choosing where to sit.
     *
     * Some table always holds the minimum, so this can never refuse every
     * table — it only ever moves a party onto a tighter one.
     */
    const tightest = listed.reduce((least: number | null, table) => {
      const taken = seated.get(table.id) ?? 0;

      if (hardRefusal(table, taken, guests)) {
        return least;
      }

      const spare = spareSeats(table, taken, guests);

      return least === null || spare < least ? spare : least;
    }, null);

    return {
      id: zone.id,
      name: zone.name,
      width: zone.width,
      height: zone.height,
      features: zone.features,
      tables: listed.map((table) => {
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
          unavailable: reasonUnavailable(table, taken, guests, tightest),
        };
      }),
      combinations: combineTables(zone.tables, seated, guests),
    };
  });
}

/**
 * The tables to push together for a party no single table can take.
 *
 * ## One answer per row, not a menu
 *
 * A row of four tables offers several stretches that would fit a party of five,
 * and a guest asked to choose between them is being asked to do the maitre
 * d's job. Each row therefore offers **one**: the fewest tables that will do,
 * and among those the fewest seats — so a party of five is given two four-tops
 * rather than three, and the third table is still there for somebody else.
 *
 * ## Only a stretch of the row
 *
 * Tables can only be pushed together with the tables they actually touch, so a
 * combination is a run of neighbours with nothing missing from the middle. A
 * table that is taken **breaks the row**: 11, 12 and 13 are three tables in a
 * line, but with 12 sold, 11 and 13 are not two tables pushed together — they
 * are two tables with somebody's dinner between them.
 *
 * ## Only when nothing else will do
 *
 * A combination is offered only if no single table in the hall fits the party.
 * Pushing tables together is work for staff and it takes tables out of the
 * room; offering it beside a four-top that would have done loses a table for
 * nothing.
 *
 * ## Whole tables only
 *
 * Every table in a row must be **completely free** — not merely free enough.
 * Half a table cannot be pushed against somebody else's dinner.
 */
function combineTables(
  tables: readonly FloorTable[],
  seated: Map<string, number>,
  guests: number,
): TableCombination[] {
  if (guests < 1) {
    return [];
  }

  // A table on its own would do, so nothing needs pushing together. Measured
  // against the hard refusals only: a table kept back for a larger party is
  // still a table that fits, and pushing two together instead would cost the
  // room more, not less.
  const fitsAlone = tables.some(
    (table) =>
      table.label.trim().length > 0 && !hardRefusal(table, seated.get(table.id) ?? 0, guests),
  );

  if (fitsAlone) {
    return [];
  }

  /** Not free, not labelled, not in service: the row stops here. */
  const unusable = (table: FloorTable) =>
    !table.active || !table.label.trim() || (seated.get(table.id) ?? 0) > 0;

  const combinations = new Map<string, TableCombination>();

  for (const axis of Object.keys(JOIN_AXES) as JoinAxis[]) {
    /**
     * Every table is asked which row it stands in, and every table of one row
     * gives that same row back — so they are collected by what they contain
     * rather than counted once per member.
     */
    const rows = new Map<string, FloorTable[]>();

    for (const table of tables) {
      const row = rowThrough(tables, table.id, axis, unusable);

      if (row.length > 1) {
        rows.set(row.map((entry) => entry.id).join("+"), row);
      }
    }

    for (const row of rows.values()) {
      const chosen = shortestStretchThatFits(row, guests);

      if (!chosen) {
        continue;
      }

      const id = chosen.map((table) => table.id).join("+");

      combinations.set(id, {
        id,
        tableIds: chosen.map((table) => table.id),
        labels: chosen.map((table) => table.label),
        seats: joinedSeats(chosen),
        axis,
      });
    }
  }

  // The tightest fit first: it is the one that costs the room least.
  return [...combinations.values()].sort(
    (a, b) => a.seats - b.seats || a.tableIds.length - b.tableIds.length,
  );
}

/**
 * The shortest stretch of one row that seats the party.
 *
 * Every stretch is tried, shortest first, and the first length that answers
 * wins — with the fewest seats breaking a tie, so a party of five in a row of
 * 4, 6, 4 is given the two four-tops rather than the four and the six.
 *
 * Tried rather than reasoned about, because the seat count of a stretch is not
 * the sum of its tables: each junction costs the chairs standing where the next
 * table now is, so adding a table to a stretch can add fewer seats than that
 * table has — and, for a two-seater joined on both sides, none at all.
 */
function shortestStretchThatFits(row: readonly FloorTable[], guests: number): FloorTable[] | null {
  for (let length = 2; length <= row.length; length += 1) {
    let best: FloorTable[] | null = null;
    let bestSeats = 0;

    for (let from = 0; from + length <= row.length; from += 1) {
      const stretch = row.slice(from, from + length);
      const seats = joinedSeats(stretch);

      if (seats < guests) {
        continue;
      }

      if (!best || seats < bestSeats) {
        best = stretch;
        bestSeats = seats;
      }
    }

    // Nothing shorter can win, so the search stops at the length that answered.
    if (best) {
      return best;
    }
  }

  return null;
}

/**
 * How many seats this party would leave unused at a table.
 *
 * The measure behind `kept-for-larger`: a party of two leaves two seats spare
 * at a four-top and none at a two-top, so the two-top is the one the room can
 * afford to sell them.
 *
 * Counted against the seats **still free** rather than the table's size, so a
 * party joining others already at a shared table is measured on what is
 * actually left of it.
 */
function spareSeats(table: FloorTable, taken: number, guests: number): number {
  return table.seats - taken - guests;
}

/**
 * Why a table cannot be had, when the reason is about the table itself.
 *
 * Kept apart from the right-sizing above it because the two answer different
 * questions. This one answers "could this party sit here at all", which is what
 * decides whether tables need pushing together — and that must not be swayed by
 * a table being held back for somebody bigger, or a room of four-tops would
 * start joining them for a party of two.
 */
function hardRefusal(
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

function reasonUnavailable(
  table: FloorTable,
  taken: number,
  guests: number,
  tightest: number | null,
): TableUnavailable | undefined {
  const refusal = hardRefusal(table, taken, guests);

  if (refusal) {
    return refusal;
  }

  // It fits, it is free, and something that fits the party better is free too.
  if (tightest !== null && spareSeats(table, taken, guests) > tightest) {
    return "kept-for-larger";
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
 * labelled, and — the point — **stand in a row**, each one linked to the next
 * on the same side, which is the plan's own statement that those tables meet.
 *
 * Checking the links rather than a shared group name is what makes 1 + 12
 * impossible in a row of 1, 11, 12, 13: they may be tables staff push together
 * every Saturday, but not with each other, and not with 11 still standing
 * between them.
 *
 * `seats` is what the row seats with the junctions paid for, never the sum —
 * the number a booking is measured against, so a party of eight cannot be sold
 * two four-tops that seat six once they are pushed together.
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

  /**
   * A row, and a straight one. Each table must name the next as its neighbour,
   * and always on the same side — so the tables are contiguous, in the order
   * given, and the row does not double back on itself through a table that
   * happens to be linked on two sides.
   */
  const sides = new Set<string>();

  for (let index = 1; index < tables.length; index += 1) {
    const link = (tables[index - 1].neighbours ?? []).find(
      (entry) => entry.tableId === tables[index].id,
    );

    if (!link) {
      return null;
    }

    sides.add(link.side);
  }

  if (sides.size > 1) {
    return null;
  }

  return {
    tables,
    seats: joinedSeats(tables),
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
