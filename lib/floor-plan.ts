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

/** The grid everything snaps to (§5). Free positioning produces a drunk plan. */
export const GRID = 10;

export const PLAN_WIDTH = 1400;
export const PLAN_HEIGHT = 900;

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
  /** Degrees, quarter turns only. */
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
  tables: FloorTable[];
  features: FloorFeature[];
};

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

/** A size snapped to the grid and kept within what can be drawn. */
export function clampSize(width: number, height: number): { width: number; height: number } {
  return {
    width: clamp(snap(width), MIN_SIZE, Math.min(MAX_SIZE, PLAN_WIDTH)),
    height: clamp(snap(height), MIN_SIZE, Math.min(MAX_SIZE, PLAN_HEIGHT)),
  };
}

/** Keeps something inside the zone whatever the designer was asked to do. */
export function clampPosition(placed: Pick<Placed, "x" | "y" | "width" | "height">): { x: number; y: number } {
  return {
    x: clamp(snap(placed.x), 0, Math.max(0, PLAN_WIDTH - placed.width)),
    y: clamp(snap(placed.y), 0, Math.max(0, PLAN_HEIGHT - placed.height)),
  };
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

  const zone = value as { id?: unknown; name?: unknown; tables?: unknown; features?: unknown };

  return {
    id: asId(zone.id),
    name: asText(zone.name, 60) || "Main hall",
    tables: (Array.isArray(zone.tables) ? zone.tables : [])
      .slice(0, MAX_TABLES_PER_ZONE)
      .map(toFloorTable)
      .filter((table): table is FloorTable => table !== null),
    // Absent on a plan drawn before features existed, which reads as a zone of
    // bare tables rather than as an unreadable zone.
    features: (Array.isArray(zone.features) ? zone.features : [])
      .slice(0, MAX_FEATURES_PER_ZONE)
      .map(toFloorFeature)
      .filter((feature): feature is FloorFeature => feature !== null),
  };
}

/** Position, size and rotation, made sane. Shared by tables and features. */
function toPlaced(value: Record<string, unknown>, fallback: { width: number; height: number }): Placed {
  const size = clampSize(
    value.width === undefined ? fallback.width : asNumber(value.width),
    value.height === undefined ? fallback.height : asNumber(value.height),
  );
  const position = clampPosition({ x: asNumber(value.x), y: asNumber(value.y), ...size });

  return {
    ...position,
    ...size,
    // Quarter turns: something at 37° is a drawing nobody meant.
    rotation: (((Math.round(asNumber(value.rotation) / 90) * 90) % 360) + 360) % 360,
  };
}

function toFloorTable(value: unknown): FloorTable | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const table = value as Record<string, unknown>;
  const shape = TABLE_SHAPES.includes(table.shape as TableShape) ? (table.shape as TableShape) : "round";

  return {
    ...toPlaced(table, DEFAULT_TABLE_SIZE[shape]),
    id: asId(table.id),
    label: asText(table.label, 12),
    seats: Math.min(Math.max(Math.round(asNumber(table.seats)), 0), MAX_SEATS_PER_TABLE),
    shape,
    // Absent reads as in service, so a table written before the field existed
    // does not silently vanish from the floor.
    active: table.active !== false,
    tags: Array.isArray(table.tags)
      ? [...new Set(table.tags.map((tag) => asText(tag, 24)).filter(Boolean))].slice(0, 8)
      : undefined,
  };
}

function toFloorFeature(value: unknown): FloorFeature | null {
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
    ...toPlaced(feature, DEFAULT_FEATURE_SIZE[kind]),
    id: asId(feature.id),
    kind,
    label: label || undefined,
  };
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
function freeSpot(taken: Placed[], size: { width: number; height: number }): { x: number; y: number } {
  const used = new Set(taken.map((entry) => `${entry.x},${entry.y}`));

  for (let y = GRID * 2; y + size.height <= PLAN_HEIGHT; y += size.height + GRID) {
    for (let x = GRID * 2; x + size.width <= PLAN_WIDTH; x += size.width + GRID) {
      if (!used.has(`${x},${y}`)) {
        return { x: snap(x), y: snap(y) };
      }
    }
  }

  return { x: GRID, y: GRID };
}

export function newTable(zone: FloorZone, shape: TableShape = "round"): FloorTable {
  const size = DEFAULT_TABLE_SIZE[shape];

  return {
    id: asId(undefined),
    label: nextLabel(zone),
    seats: shape === "rectangle" || shape === "oval" ? 6 : 4,
    shape,
    active: true,
    rotation: 0,
    ...size,
    ...freeSpot([...zone.tables, ...zone.features], size),
  };
}

export function newFeature(zone: FloorZone, kind: FeatureKind): FloorFeature {
  const size = DEFAULT_FEATURE_SIZE[kind];

  return {
    id: asId(undefined),
    kind,
    // The stage is the one feature that is always worth naming, because "who
    // is next to the music" is a question guests actually ask.
    label: kind === "stage" ? "Musician" : undefined,
    rotation: 0,
    ...size,
    ...freeSpot([...zone.tables, ...zone.features], size),
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

  return { id: asId(undefined), name, tables: [], features: [] };
}
