/**
 * The restaurant floor, as drawn by staff.
 *
 * The plan belongs to the **restaurant**, not to a date: tables do not move
 * nightly, and what changes per evening is which of them are in use. See
 * `docs/floor-plan.md` §3.
 *
 * ## Zones, not rooms
 *
 * A zone is a **hall of the restaurant** — the main hall, the terrace, a
 * private dining room. It is emphatically *not* a hotel room: this app already
 * uses "room" for where the guest is staying (`roomNumber`, `additionalRooms`),
 * and one word meaning two things in one codebase is how a wrong number ends
 * up on a booking. Nothing here is ever called a room.
 *
 * ## Tables and features
 *
 * Two kinds of thing stand in a zone, and they are separate because they mean
 * different things rather than because they draw differently:
 *
 * - **Tables** seat guests. They carry a label that becomes a booking's
 *   `tableNumber` (§3), a seat count, and eventually a claim. They are the
 *   only things a guest will ever be able to pick.
 * - **Features** are the rest of the room — walls, windows, the door, the bar,
 *   the stage the musician plays from, a plant, a walkway. They are how staff
 *   recognise the drawing as their own restaurant, and nothing books them.
 *
 * Nothing in this module touches seat accounting. No booking reads the plan
 * yet (§9 step 1), and the next step is the one that can corrupt data.
 */

export const TABLE_SHAPES = ["round", "square", "rectangle", "oval"] as const;
export type TableShape = (typeof TABLE_SHAPES)[number];

/**
 * The furniture and architecture that is not a table.
 *
 * `stage` is where the musician plays. It is a feature rather than a table
 * because nobody dines at it — but it is worth drawing, since which tables are
 * next to the music is exactly the thing a guest asks about.
 */
export const FEATURE_KINDS = [
  "wall",
  "window",
  "door",
  "stage",
  "bar",
  "plant",
  "path",
  "screen",
  "text",
] as const;
export type FeatureKind = (typeof FEATURE_KINDS)[number];

export const FEATURE_LABELS: Record<FeatureKind, string> = {
  wall: "Wall",
  window: "Window",
  door: "Door",
  stage: "Stage",
  bar: "Bar",
  plant: "Plant",
  path: "Walkway",
  screen: "Screen",
  text: "Label",
};

/**
 * **Every measurement in this module is centimetres of real restaurant.**
 *
 * A table 120 wide is 1.2 metres wide, and a zone 1400 by 900 is fourteen
 * metres by nine. Staff measure their room with a tape and type what they
 * measured; nothing has to be converted in anybody's head, and a plan drawn to
 * real dimensions is the only kind that can answer whether a table actually
 * fits where it is drawn.
 *
 * The numbers the first version stored were already in this range — a table of
 * 70, a bar of 300 — so reading them as centimetres needs no migration and
 * makes them mean what they always looked like they meant.
 */
export const CM_PER_M = 100;

/** The grid everything snaps to (§5). Free positioning produces a drunk plan. */
export const GRID = 10;

/** Default zone: 14m x 9m. Every zone carries its own, editable. */
export const DEFAULT_ZONE_WIDTH = 1400;
export const DEFAULT_ZONE_HEIGHT = 900;

/** From a two-metre alcove to a sixty-metre hall. */
export const MIN_ZONE_SIDE = 200;
export const MAX_ZONE_SIDE = 6000;

/** A chair, drawn around a table rather than placed by hand. */
export const CHAIR_SIZE = 42;
export const CHAIR_GAP = 8;
export const MAX_CHAIRS_PER_TABLE = 24;

/**
 * The sides of a table chairs may be drawn on.
 *
 * Sides of the **table**, not of the room: they are named before the table's
 * rotation is applied, so they turn with it. Push a table against the right
 * wall and turn it, and the side you cleared stays the side you cleared.
 *
 * Absent means all four, which is the normal case and exactly what every table
 * drawn before this existed gets — so no plan changes by being read again.
 */
export const CHAIR_SIDES = ["top", "right", "bottom", "left"] as const;
export type ChairSide = (typeof CHAIR_SIDES)[number];

export const CHAIR_SIDE_LABELS: Record<ChairSide, string> = {
  top: "Top",
  right: "Right",
  bottom: "Bottom",
  left: "Left",
};

/** What the rotation control steps by. Free entry is allowed in between. */
export const ROTATION_STEP = 15;

export const MAX_SEATS_PER_TABLE = 20;
export const MAX_TABLES_PER_ZONE = 200;
export const MAX_FEATURES_PER_ZONE = 300;
export const MAX_ZONES = 12;

/** Anything drawn on the plan sits somewhere and has a size. */
export type Placed = {
  x: number;
  y: number;
  width: number;
  height: number;
  /**
   * Degrees clockwise, 0–359.
   *
   * Any angle, not only quarter turns: tables set on the diagonal, a bar
   * following a slanted wall and a stage in a corner are all ordinary things in
   * a real room, and a plan that can only draw right angles cannot describe
   * them. The designer offers 15° steps and free entry.
   */
  rotation: number;
};

export type FloorTable = Placed & {
  id: string;
  /**
   * What staff and guests call it. Maps onto the existing free-text
   * `tableNumber` on a reservation, which is what makes this feature cheap:
   * the sheet, the board and `groupRoomRowsByTable` already key on that string
   * and need no changes at all (§3).
   */
  label: string;
  seats: number;
  shape: TableShape;
  /** Out of service — a broken leg, a draught nobody will sit in. */
  active: boolean;
  /**
   * Draw chairs around this table.
   *
   * Chairs are **arranged**, never placed by hand: they sit where the shape
   * says, and they move, rotate, resize and duplicate with the table because
   * they are not separate objects that could be left behind.
   *
   * Absent reads as on, so a table drawn before chairs existed grows them.
   */
  chairs?: boolean;
  /**
   * How many chairs to draw, when that is not simply the seat count.
   *
   * Absent means "as many as it seats", which is the normal case and the one
   * nobody should have to think about. It is set when the room disagrees with
   * the arithmetic: a four-top laid with two chairs against a wall, or a table
   * that seats six with an extra chair pulled up for a child. The seat count
   * stays the truth for booking; this is only what is drawn.
   */
  chairCount?: number;
  /**
   * Which sides of the table the chairs go on.
   *
   * Absent means all four. It is set when the room says otherwise: a table
   * pushed against a wall is laid on three sides, a banquette seats one side
   * only, two tables pushed together are not laid where they meet.
   *
   * The chairs stay **derived** — this says which sides are available, and the
   * count is still shared out between them from the seat count. There is still
   * no such thing as a chair somebody placed by hand and could leave behind.
   */
  chairSides?: ChairSide[];
  /** Window, quiet, by the music. Nothing reads these yet (§8.4). */
  tags?: string[];
};

export type FloorFeature = Placed & {
  id: string;
  kind: FeatureKind;
  /** "Musician", "Main entrance", "Kitchen door". Drawn on the plan. */
  label?: string;
};

export type FloorZone = {
  id: string;
  /** "Main hall", "Terrace", "Private dining". */
  name: string;
  /** The hall itself, in centimetres. Measured with a tape, not guessed. */
  width: number;
  height: number;
  tables: FloorTable[];
  features: FloorFeature[];
};

/**
 * A hall is a rectangle of a given size. An L-shaped or irregular room is drawn
 * by taking the bounding rectangle and walling off the part that is not there —
 * which is what the `wall` feature is for, and is far less to get wrong than a
 * polygon editor nobody asked for.
 */
export type ZoneSize = Pick<FloorZone, "width" | "height">;

/**
 * A list of zones rather than a list of tables, decided before the first zone
 * was drawn (§8.6). A terrace or a private hall is a real thing restaurants
 * have, and making the plan a list later would mean rewriting every read.
 */
export type FloorPlan = {
  zones: FloorZone[];
};

export const EMPTY_PLAN: FloorPlan = { zones: [] };

/** Starting size for each table shape. Every one of them is resizable after. */
export const DEFAULT_TABLE_SIZE: Record<TableShape, { width: number; height: number }> = {
  round: { width: 70, height: 70 },
  square: { width: 70, height: 70 },
  rectangle: { width: 120, height: 70 },
  oval: { width: 140, height: 80 },
};

export const DEFAULT_FEATURE_SIZE: Record<FeatureKind, { width: number; height: number }> = {
  wall: { width: 240, height: 20 },
  window: { width: 160, height: 20 },
  door: { width: 80, height: 20 },
  stage: { width: 180, height: 120 },
  bar: { width: 300, height: 60 },
  plant: { width: 40, height: 40 },
  path: { width: 300, height: 80 },
  screen: { width: 160, height: 20 },
  text: { width: 140, height: 40 },
};

export const MIN_SIZE = 20;
export const MAX_SIZE = 800;

export function snap(value: number, grid = GRID): number {
  return Math.round(value / grid) * grid;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export const DEFAULT_ZONE: ZoneSize = { width: DEFAULT_ZONE_WIDTH, height: DEFAULT_ZONE_HEIGHT };

/** The hall itself, snapped and held between an alcove and a banqueting hall. */
export function clampZoneSize(width: number, height: number): ZoneSize {
  return {
    width: clamp(snap(width), MIN_ZONE_SIDE, MAX_ZONE_SIDE),
    height: clamp(snap(height), MIN_ZONE_SIDE, MAX_ZONE_SIDE),
  };
}

/**
 * A size snapped to the grid and kept within the hall it stands in.
 *
 * Nothing may be larger than the zone that holds it — a four-metre bar in a
 * three-metre alcove is not a drawing anybody can act on.
 */
export function clampSize(width: number, height: number, zone: ZoneSize = DEFAULT_ZONE): { width: number; height: number } {
  return {
    width: clamp(snap(width), MIN_SIZE, zone.width),
    height: clamp(snap(height), MIN_SIZE, zone.height),
  };
}

/**
 * How much floor something actually covers once it has been turned.
 *
 * A window 160 x 20 laid flat covers 160 x 20. Stand it on end against a side
 * wall and it covers 20 x 160 — the same object, a different footprint. This is
 * the axis-aligned box around the rotated shape, and it is what has to fit in
 * the hall, because it is what a tape measure would find.
 */
export function rotatedExtent(
  size: { width: number; height: number },
  rotation = 0,
): { width: number; height: number } {
  const radians = (rotation * Math.PI) / 180;
  const cos = Math.abs(Math.cos(radians));
  const sin = Math.abs(Math.sin(radians));

  return {
    width: size.width * cos + size.height * sin,
    height: size.width * sin + size.height * cos,
  };
}

/**
 * Keeps something inside its zone whatever the designer was asked to do.
 *
 * The far edge is reachable: something 120 wide in a 1400 zone may sit at
 * exactly 1280, flush against the wall. There is no dead band at the end.
 *
 * **Rotation counts.** Everything is drawn turned about the centre of its
 * unrotated box, so the stored `x`/`y` is not where the shape appears once it
 * has been turned. Clamping the unrotated box was a real bug: a 160-long
 * window stood on end against the right wall could get no closer than 70 cm to
 * it — half the difference between its length and its depth — and a longer
 * window was held further out still. The bound is the **rotated** footprint,
 * which is why `x` may legitimately come back negative: a window standing on
 * end at `x = -70` has its glass exactly on the wall.
 */
export function clampPosition(
  placed: Pick<Placed, "x" | "y" | "width" | "height"> & { rotation?: number },
  zone: ZoneSize = DEFAULT_ZONE,
): { x: number; y: number } {
  const extent = rotatedExtent(placed, placed.rotation ?? 0);

  // Half the difference between what it covers and what it stores: zero for
  // anything square to the room, so nothing unrotated moves by a millimetre.
  const overhangX = (extent.width - placed.width) / 2;
  const overhangY = (extent.height - placed.height) / 2;

  const minX = overhangX;
  const minY = overhangY;
  // Something too big for the hall pins to the near wall rather than going
  // somewhere nonsensical — the same answer the unrotated case always gave.
  const maxX = Math.max(minX, zone.width - placed.width - overhangX);
  const maxY = Math.max(minY, zone.height - placed.height - overhangY);

  return {
    x: clamp(snap(placed.x), minX, maxX),
    y: clamp(snap(placed.y), minY, maxY),
  };
}

/* ------------------------------------------------------------------ *
 * Real-world dimensions
 * ------------------------------------------------------------------ */

/** Centimetres as a person would say them: 70 cm, 1.2 m, 14 m. */
export function formatLength(cm: number): string {
  if (cm < CM_PER_M) {
    return `${Math.round(cm)} cm`;
  }

  const metres = cm / CM_PER_M;
  // A whole number of metres does not need a decimal point after it.
  return `${Number.isInteger(metres) ? metres : metres.toFixed(2).replace(/0$/, "")} m`;
}

export function formatSize(size: { width: number; height: number }): string {
  return `${formatLength(size.width)} × ${formatLength(size.height)}`;
}

/** Floor area in square metres, for the zone header. */
export function zoneArea(zone: ZoneSize): number {
  return Math.round(((zone.width / CM_PER_M) * (zone.height / CM_PER_M) + Number.EPSILON) * 10) / 10;
}

/* ------------------------------------------------------------------ *
 * Chairs
 * ------------------------------------------------------------------ */

/**
 * The sides chairs may go on, as a list that always says something usable.
 *
 * Absent, empty or unrecognisable all read as **all four sides** — the same
 * lenient direction as `active` and `chairs`, and for the same reason: a plan
 * that cannot be understood should draw an ordinary table, not a bare one.
 * Turning chairs off entirely is what the `chairs` switch is for.
 */
export function chairSidesOf(table: { chairSides?: ChairSide[] }): ChairSide[] {
  const chosen = Array.isArray(table.chairSides)
    ? CHAIR_SIDES.filter((side) => table.chairSides!.includes(side))
    : [];

  return chosen.length > 0 ? chosen : [...CHAIR_SIDES];
}

/**
 * `total` shared out between weighted places, as whole chairs.
 *
 * Largest remainder, ties going to the earlier place — which is why callers
 * order the sides top, bottom, left, right: an odd chair lands on a long side,
 * and an exact tie is split across facing sides rather than adjacent ones. A
 * square laid for six comes out two, two, one, one rather than crowding one
 * side and leaving another bare.
 */
function share(total: number, weights: number[]): number[] {
  const sum = weights.reduce((running, weight) => running + weight, 0);

  if (total <= 0 || sum <= 0) {
    return weights.map(() => 0);
  }

  const exact = weights.map((weight) => (total * weight) / sum);
  const counts = exact.map((value) => Math.floor(value));
  let left = total - counts.reduce((running, count) => running + count, 0);

  const byRemainder = exact
    .map((value, index) => ({ index, remainder: value - Math.floor(value) }))
    .sort((a, b) => b.remainder - a.remainder || a.index - b.index);

  for (const place of byRemainder) {
    if (left <= 0) break;
    counts[place.index] += 1;
    left -= 1;
  }

  return counts;
}

/**
 * Where the chairs go, worked out from the seat count, the shape and the sides.
 *
 * Derived rather than stored, which is the whole point: chairs cannot be left
 * behind when a table moves, cannot be forgotten when it is duplicated, and
 * cannot disagree with the number of people the table seats. Change the seats
 * and the chairs follow.
 *
 * `chairSides` narrows *where* they may go without making them placeable: a
 * table against a wall is laid on three sides, a banquette on one. The count is
 * still shared out, just between fewer sides — so a four-top laid on two sides
 * puts two on each rather than dropping two chairs on the floor.
 *
 * Positions are in the table's own coordinates, before its rotation is applied,
 * so the caller draws them inside the same transform as the table and they turn
 * with it. That is also why the sides are the table's own: clear the side
 * facing the wall, turn the table, and it is still the side facing the wall.
 */
export function chairPositions(
  table: Pick<FloorTable, "seats" | "shape" | "width" | "height"> & {
    chairCount?: number;
    chairSides?: ChairSide[];
  },
): Array<{ x: number; y: number; rotation: number }> {
  // Absent means "as many as it seats", which is the normal case.
  const wanted = table.chairCount === undefined ? table.seats : table.chairCount;
  const seats = Math.max(0, Math.min(Math.round(wanted), MAX_CHAIRS_PER_TABLE));

  if (seats === 0) {
    return [];
  }

  const halfChair = CHAIR_SIZE / 2;
  const out = CHAIR_SIZE / 2 + CHAIR_GAP;
  const sides = chairSidesOf(table);
  const allRound = sides.length === CHAIR_SIDES.length;

  if (table.shape === "round" || table.shape === "oval") {
    const rx = table.width / 2 + out;
    const ry = table.height / 2 + out;

    const at = (degrees: number) => {
      const angle = (degrees * Math.PI) / 180;
      return {
        x: table.width / 2 + Math.cos(angle) * rx - halfChair,
        y: table.height / 2 + Math.sin(angle) * ry - halfChair,
        rotation: degrees + 90,
      };
    };

    if (allRound) {
      // Evenly around the ellipse, each chair facing the middle. Untouched by
      // the sides work, so every round table already drawn is drawn the same.
      return Array.from({ length: seats }, (_, index) => at((index / seats) * 360 - 90));
    }

    /**
     * Part of the way round, then. Each side owns the quarter of the circle
     * facing it — top is the 90° centred on straight up — and sides next to
     * each other make one arc rather than two, so chairs across "top and
     * right" flow round the corner instead of bunching at the middle of each.
     */
    const order: ChairSide[] = ["top", "right", "bottom", "left"];
    const on = order.map((side) => sides.includes(side));
    // At least one side is off here, so there is a gap to start the sweep
    // after and no run can wrap round onto itself.
    const first = on.findIndex((enabled, index) => enabled && !on[(index + order.length - 1) % order.length]);

    const arcs: Array<{ start: number; span: number }> = [];
    let running = false;

    for (let step = 0; step < order.length; step += 1) {
      const index = (first + step) % order.length;

      if (!on[index]) {
        running = false;
        continue;
      }

      if (running) {
        arcs[arcs.length - 1].span += 90;
      } else {
        // -135 is where the top side's quarter begins, a corner of the table.
        arcs.push({ start: -135 + index * 90, span: 90 });
        running = true;
      }
    }

    const counts = share(seats, arcs.map((arc) => arc.span));

    return arcs.flatMap((arc, index) =>
      // Half a step in from each end, so an arc of three sits evenly across it
      // rather than with a chair pinned to the corner it stops at.
      Array.from({ length: counts[index] }, (_, seat) => at(arc.start + ((seat + 0.5) / counts[index]) * arc.span)),
    );
  }

  /**
   * Rectangles seat people along their sides, and the long sides take more —
   * which is how anybody actually lays a table up. Shared out by side length,
   * then spaced evenly along each side.
   *
   * Ordered top, bottom, left, right so that a tie goes to a facing pair.
   */
  const order: ChairSide[] = ["top", "bottom", "left", "right"];
  const laid = order.filter((side) => sides.includes(side));
  const counts = share(
    seats,
    laid.map((side) => (side === "top" || side === "bottom" ? table.width : table.height)),
  );

  const along = (count: number, length: number) =>
    Array.from({ length: count }, (_, index) => ((index + 1) / (count + 1)) * length);

  return laid.flatMap((side, index) => {
    const count = counts[index];

    switch (side) {
      case "top":
        return along(count, table.width).map((position) => ({
          x: position - halfChair,
          y: -out - halfChair,
          rotation: 180,
        }));
      case "bottom":
        return along(count, table.width).map((position) => ({
          x: position - halfChair,
          y: table.height + out - halfChair,
          rotation: 0,
        }));
      case "left":
        return along(count, table.height).map((position) => ({
          x: -out - halfChair,
          y: position - halfChair,
          rotation: 90,
        }));
      default:
        return along(count, table.height).map((position) => ({
          x: table.width + out - halfChair,
          y: position - halfChair,
          rotation: 270,
        }));
    }
  });
}

/**
 * Seats in a zone, counting only tables that are in service.
 *
 * Read back to staff as "12 tables · 48 seats" and never applied silently —
 * that would change every existing date the moment somebody drew a zone (§5).
 */
export function countZone(zone: FloorZone): { tables: number; seats: number } {
  const live = zone.tables.filter((table) => table.active);

  return {
    tables: live.length,
    seats: live.reduce((total, table) => total + Math.max(0, table.seats), 0),
  };
}

export function countPlan(plan: FloorPlan): { zones: number; tables: number; seats: number } {
  return plan.zones.reduce(
    (total, zone) => {
      const counted = countZone(zone);
      return {
        zones: total.zones + 1,
        tables: total.tables + counted.tables,
        seats: total.seats + counted.seats,
      };
    },
    { zones: 0, tables: 0, seats: 0 },
  );
}

/** Every table in the plan, with the zone it stands in. */
export function allTables(plan: FloorPlan): Array<FloorTable & { zoneId: string; zoneName: string }> {
  return plan.zones.flatMap((zone) =>
    zone.tables.map((table) => ({ ...table, zoneId: zone.id, zoneName: zone.name })),
  );
}

/**
 * Labels used by more than one table, upper-cased and trimmed first.
 *
 * A duplicate is not a drawing mistake, it is a service one: the label becomes
 * a booking's `tableNumber`, and two tables answering to "7" makes the sheet
 * ambiguous about where a party is sitting. Compared **across zones**, because
 * "7 on the terrace" and "7 in the main hall" are read off the same sheet.
 */
export function duplicateLabels(plan: FloorPlan): string[] {
  const seen = new Map<string, number>();

  for (const table of allTables(plan)) {
    const key = table.label.trim().toUpperCase();
    if (key) {
      seen.set(key, (seen.get(key) ?? 0) + 1);
    }
  }

  return [...seen.entries()]
    .filter(([, count]) => count > 1)
    .map(([label]) => label)
    .sort();
}

/** Tables with no label: they could never be written onto a booking. */
export function unlabelledTables(plan: FloorPlan): number {
  return allTables(plan).filter((table) => !table.label.trim()).length;
}

/**
 * What is wrong with the plan, in words meant for whoever drew it.
 *
 * Saving is not blocked on these — a half-drawn hall is a legitimate thing to
 * come back to tomorrow — except duplicate labels, which the route refuses
 * because of what the label becomes downstream.
 */
export function describePlanProblems(plan: FloorPlan): string[] {
  const problems: string[] = [];
  const duplicates = duplicateLabels(plan);
  const unlabelled = unlabelledTables(plan);

  if (duplicates.length > 0) {
    problems.push(
      `Two tables share the label ${duplicates.map((label) => `“${label}”`).join(", ")}. ` +
        "A booking records the label, so the sheet could not say which table a party is at.",
    );
  }

  if (unlabelled > 0) {
    problems.push(
      `${unlabelled} table${unlabelled === 1 ? " has" : "s have"} no label yet, so ${
        unlabelled === 1 ? "it" : "they"
      } cannot be written onto a booking.`,
    );
  }

  return problems;
}

/* ------------------------------------------------------------------ *
 * Reading a stored plan
 * ------------------------------------------------------------------ */

/**
 * A stored value read back as a plan, whatever it actually turns out to be.
 *
 * The same contract as `toCurrency` and `toTimeZone`: the store holds whatever
 * was last written to it, which may be nothing, may predate a field, and may
 * have been written by a version of this app that no longer exists. Nothing
 * here throws. Anything unrecognisable becomes an empty plan, and a single
 * unreadable table is dropped rather than taking its zone down with it.
 *
 * It also runs on the way *in*, so a payload that passed the schema still gets
 * its geometry snapped and clamped — the schema says the shape is right, this
 * says the values are sane.
 */
export function toFloorPlan(value: unknown): FloorPlan {
  if (!value || typeof value !== "object") {
    return EMPTY_PLAN;
  }

  const source = value as { zones?: unknown; rooms?: unknown };

  /**
   * `rooms` is read as well as `zones`, because the first version of this
   * feature called them rooms before the word was found to collide with the
   * hotel's own. A plan saved under the old name still loads (rule 2.2) and is
   * written back under the new one the next time it is saved.
   */
  const zones = Array.isArray(source.zones) ? source.zones : Array.isArray(source.rooms) ? source.rooms : null;

  if (!zones) {
    return EMPTY_PLAN;
  }

  return {
    zones: zones
      .slice(0, MAX_ZONES)
      .map(toFloorZone)
      .filter((zone): zone is FloorZone => zone !== null),
  };
}

function toFloorZone(value: unknown): FloorZone | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const zone = value as {
    id?: unknown;
    name?: unknown;
    width?: unknown;
    height?: unknown;
    tables?: unknown;
    features?: unknown;
  };

  /**
   * A zone drawn before halls had their own dimensions takes the default,
   * which is the size everything was implicitly laid out in — so an existing
   * plan keeps every table exactly where it was put.
   */
  const size = clampZoneSize(
    zone.width === undefined ? DEFAULT_ZONE_WIDTH : asNumber(zone.width),
    zone.height === undefined ? DEFAULT_ZONE_HEIGHT : asNumber(zone.height),
  );

  return {
    id: asId(zone.id),
    name: asText(zone.name, 60) || "Main hall",
    ...size,
    tables: (Array.isArray(zone.tables) ? zone.tables : [])
      .slice(0, MAX_TABLES_PER_ZONE)
      .map((table) => toFloorTable(table, size))
      .filter((table): table is FloorTable => table !== null),
    // Absent on a plan drawn before features existed, which reads as a zone of
    // bare tables rather than as an unreadable zone.
    features: (Array.isArray(zone.features) ? zone.features : [])
      .slice(0, MAX_FEATURES_PER_ZONE)
      .map((feature) => toFloorFeature(feature, size))
      .filter((feature): feature is FloorFeature => feature !== null),
  };
}

/** Position, size and rotation, made sane. Shared by tables and features. */
function toPlaced(
  value: Record<string, unknown>,
  fallback: { width: number; height: number },
  zone: ZoneSize,
): Placed {
  const size = clampSize(
    value.width === undefined ? fallback.width : asNumber(value.width),
    value.height === undefined ? fallback.height : asNumber(value.height),
    zone,
  );
  // Whole degrees, wrapped into a single turn. -90 is 270, 370 is 10. Read
  // before the position, because how far something has been turned is part of
  // how much floor it covers and so part of where it is allowed to stand.
  const rotation = ((Math.round(asNumber(value.rotation)) % 360) + 360) % 360;
  const position = clampPosition({ x: asNumber(value.x), y: asNumber(value.y), ...size, rotation }, zone);

  return { ...position, ...size, rotation };
}

function toFloorTable(value: unknown, zone: ZoneSize): FloorTable | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const table = value as Record<string, unknown>;
  const shape = TABLE_SHAPES.includes(table.shape as TableShape) ? (table.shape as TableShape) : "round";

  return {
    ...toPlaced(table, DEFAULT_TABLE_SIZE[shape], zone),
    id: asId(table.id),
    label: asText(table.label, 12),
    seats: Math.min(Math.max(Math.round(asNumber(table.seats)), 0), MAX_SEATS_PER_TABLE),
    shape,
    // Absent reads as in service, so a table written before the field existed
    // does not silently vanish from the floor.
    active: table.active !== false,
    // Absent reads as on, so a table drawn before chairs existed grows them.
    chairs: table.chairs !== false,
    chairCount:
      table.chairCount === undefined || table.chairCount === null
        ? undefined
        : Math.min(Math.max(Math.round(asNumber(table.chairCount)), 0), MAX_CHAIRS_PER_TABLE),
    chairSides: toChairSides(table.chairSides),
    tags: Array.isArray(table.tags)
      ? [...new Set(table.tags.map((tag) => asText(tag, 24)).filter(Boolean))].slice(0, 8)
      : undefined,
  };
}

function toFloorFeature(value: unknown, zone: ZoneSize): FloorFeature | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const feature = value as Record<string, unknown>;

  // An unknown kind is dropped rather than guessed at: drawing a mystery
  // rectangle in the middle of somebody's restaurant helps nobody.
  if (!FEATURE_KINDS.includes(feature.kind as FeatureKind)) {
    return null;
  }

  const kind = feature.kind as FeatureKind;
  const label = asText(feature.label, 40);

  return {
    ...toPlaced(feature, DEFAULT_FEATURE_SIZE[kind], zone),
    id: asId(feature.id),
    kind,
    label: label || undefined,
  };
}

/**
 * The stored sides, or nothing at all when they say "all four".
 *
 * All four is the absent case, so it is stored as absent however it arrives —
 * one representation of the ordinary table, and a plan that does not grow a
 * field for every table that never needed one. Nothing usable also reads as
 * absent, which is all four: see `chairSidesOf`.
 */
function toChairSides(value: unknown): ChairSide[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const kept = CHAIR_SIDES.filter((side) => value.includes(side));
  return kept.length > 0 && kept.length < CHAIR_SIDES.length ? kept : undefined;
}

function asNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function asText(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

/** Ids only have to be unique within a plan; nothing security-sensitive rests on them. */
function asId(value: unknown): string {
  const existing = asText(value, 64);
  return existing || `f-${Math.random().toString(36).slice(2, 10)}`;
}

/* ------------------------------------------------------------------ *
 * Adding things
 * ------------------------------------------------------------------ */

/** A free spot for something of this size, so new things do not stack up. */
function freeSpot(
  taken: Placed[],
  size: { width: number; height: number },
  zone: ZoneSize,
): { x: number; y: number } {
  const used = new Set(taken.map((entry) => `${entry.x},${entry.y}`));

  for (let y = GRID * 2; y + size.height <= zone.height; y += size.height + GRID) {
    for (let x = GRID * 2; x + size.width <= zone.width; x += size.width + GRID) {
      if (!used.has(`${x},${y}`)) {
        return { x: snap(x), y: snap(y) };
      }
    }
  }

  return { x: GRID, y: GRID };
}

export function newTable(zone: FloorZone, shape: TableShape = "round"): FloorTable {
  const size = clampSize(DEFAULT_TABLE_SIZE[shape].width, DEFAULT_TABLE_SIZE[shape].height, zone);

  return {
    id: asId(undefined),
    label: nextLabel(zone),
    seats: shape === "rectangle" || shape === "oval" ? 6 : 4,
    shape,
    active: true,
    chairs: true,
    rotation: 0,
    ...size,
    ...freeSpot([...zone.tables, ...zone.features], size, zone),
  };
}

export function newFeature(zone: FloorZone, kind: FeatureKind): FloorFeature {
  const size = clampSize(DEFAULT_FEATURE_SIZE[kind].width, DEFAULT_FEATURE_SIZE[kind].height, zone);

  return {
    id: asId(undefined),
    kind,
    // The stage is the one feature that is always worth naming, because "who
    // is next to the music" is a question guests actually ask.
    label: kind === "stage" ? "Musician" : undefined,
    rotation: 0,
    ...size,
    ...freeSpot([...zone.tables, ...zone.features], size, zone),
  };
}

/**
 * The next free number, counting from one.
 *
 * Only purely numeric labels are considered, so a zone of "T1"/"T2" or of named
 * tables is left alone rather than given a number that clashes with a scheme
 * somebody chose on purpose.
 */
function nextLabel(zone: FloorZone): string {
  const numbers = zone.tables
    .map((table) => Number(table.label.trim()))
    .filter((value) => Number.isInteger(value) && value > 0);

  for (let candidate = 1; candidate <= numbers.length + 1; candidate += 1) {
    if (!numbers.includes(candidate)) {
      return String(candidate);
    }
  }

  return String(numbers.length + 1);
}

export function newZone(plan: FloorPlan): FloorZone {
  const names = new Set(plan.zones.map((zone) => zone.name.toLowerCase()));
  const base = plan.zones.length === 0 ? "Main hall" : "New zone";

  let name = base;
  for (let suffix = 2; names.has(name.toLowerCase()); suffix += 1) {
    name = `${base} ${suffix}`;
  }

  return { id: asId(undefined), name, ...DEFAULT_ZONE, tables: [], features: [] };
}

/**
 * Whether guests choose their own table — `docs/floor-plan.md` §4, §9 step 2.
 *
 * Three states rather than a boolean, because "guests may pick, or may leave
 * it to us" is a real restaurant policy and not a half-configured one. §4 says
 * to decide this now: every call site added later would otherwise have to be
 * revisited to tell "may pick" from "must pick".
 *
 * - `off` — the plan is a drawing staff keep for themselves. **Off must be
 *   indistinguishable from the app as it was before the plan existed**, which
 *   is the acceptance criterion for the whole feature.
 * - `optional` — a guest may pick a table, and "any table" stays the default.
 * - `required` — a guest must pick one before the booking can be made.
 *
 * Nothing books against this yet. The claim it will gate is §9 step 3, and §2
 * is the section to read before writing it.
 */
export const FLOOR_PLAN_MODES = ["off", "optional", "required"] as const;
export type FloorPlanMode = (typeof FLOOR_PLAN_MODES)[number];

/** Off, and off is what a restaurant that never touches this setting gets. */
export const DEFAULT_FLOOR_PLAN_MODE: FloorPlanMode = "off";

export const FLOOR_PLAN_MODE_LABELS: Record<FloorPlanMode, string> = {
  off: "Staff only",
  optional: "Guests may choose",
  required: "Guests must choose",
};

export const FLOOR_PLAN_MODE_DESCRIPTIONS: Record<FloorPlanMode, string> = {
  off: "The plan is yours. Booking works exactly as it does today and no guest sees the room.",
  optional: "Guests are shown the room and may pick a table. “Any table” stays the default.",
  required: "Guests must pick a table before the booking can be made.",
};

export function isFloorPlanMode(value: unknown): value is FloorPlanMode {
  return typeof value === "string" && (FLOOR_PLAN_MODES as readonly string[]).includes(value);
}

/**
 * Anything unrecognised reads as `off`.
 *
 * The lenient direction matters more here than anywhere else in this module: a
 * stored value nobody can parse must not leave guests picking tables against a
 * plan the app does not understand, and it must not break a screen either.
 */
export function toFloorPlanMode(value: unknown): FloorPlanMode {
  return isFloorPlanMode(value) ? value : DEFAULT_FLOOR_PLAN_MODE;
}

/**
 * The tables a guest could actually be given.
 *
 * In service, and labelled — the label is what becomes a booking's
 * `tableNumber` (§3), so an unlabelled table could be picked and then not be
 * nameable on the sheet. An unlabelled table is a room somebody is still
 * drawing (§10), which is precisely why saving allows it and booking must not.
 */
export function bookableTables(plan: FloorPlan): Array<FloorTable & { zoneId: string; zoneName: string }> {
  return allTables(plan).filter((table) => table.active && table.label.trim().length > 0);
}

/**
 * The mode as it actually applies tonight, given the plan.
 *
 * A mode of `optional` or `required` against a plan with nothing bookable in
 * it is not a policy, it is a broken booking flow — `required` in particular
 * would ask every guest to pick from an empty room and then refuse them.
 * Saving the mode refuses that case, but the plan can be emptied afterwards,
 * so every reader resolves through here rather than trusting the stored value.
 */
export function resolveFloorPlanMode(mode: FloorPlanMode, plan: FloorPlan): FloorPlanMode {
  return bookableTables(plan).length === 0 ? "off" : mode;
}
