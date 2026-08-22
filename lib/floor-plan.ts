/**
 * The room, as drawn by staff.
 *
 * The plan belongs to the **restaurant**, not to a date: tables do not move
 * nightly, and what changes per evening is which of them are in use. See
 * `docs/floor-plan.md` §3.
 *
 * Nothing here touches seat accounting. This module is the drawing and its
 * rules and nothing else — no booking reads it yet, and the feature is useful
 * before one does, because a drawn room can be printed and proves the model
 * (§9 step 1).
 *
 * Every type below is plain data with no Mongoose in sight, so the designer in
 * the browser and the service on the server share one definition of what a
 * table is.
 */

export const TABLE_SHAPES = ["round", "square", "rectangle"] as const;
export type TableShape = (typeof TABLE_SHAPES)[number];

/**
 * The grid the designer snaps to, in plan units.
 *
 * Free positioning produces a plan that looks drunk and that no two people ever
 * agree is finished (§5), so every position is a multiple of this.
 */
export const GRID = 10;

/** How large the drawable room is, in plan units. Wide enough for a terrace. */
export const PLAN_WIDTH = 1000;
export const PLAN_HEIGHT = 700;

export const MAX_SEATS_PER_TABLE = 20;
export const MAX_TABLES_PER_ROOM = 200;
export const MAX_ROOMS = 12;

export type FloorTable = {
  id: string;
  /**
   * What staff and guests call it. Maps onto the existing free-text
   * `tableNumber` on a reservation, which is what makes this feature cheap:
   * the sheet, the board and `groupRoomRowsByTable` already key on that string
   * and need no changes at all (§3).
   */
  label: string;
  seats: number;
  x: number;
  y: number;
  shape: TableShape;
  /** Degrees. Rectangles need it; rounds and squares ignore it. */
  rotation?: number;
  /** Out of service — a broken leg, a draught nobody will sit in. */
  active: boolean;
  /**
   * Window, quiet, near the door. Stored now because retrofitting an attribute
   * guests filter on is awkward once rooms are drawn (§8.4).
   */
  tags?: string[];
};

export type FloorRoom = {
  id: string;
  name: string;
  tables: FloorTable[];
};

/**
 * A list of rooms rather than a list of tables, decided before the first room
 * was drawn (§8.6). A terrace or a private room is a real thing restaurants
 * have, and making the plan a list later would mean rewriting every read.
 */
export type FloorPlan = {
  rooms: FloorRoom[];
};

export const EMPTY_PLAN: FloorPlan = { rooms: [] };

/** Sizes are fixed by shape for now: a plan is a map, not a scale drawing. */
export const TABLE_SIZE: Record<TableShape, { width: number; height: number }> = {
  round: { width: 60, height: 60 },
  square: { width: 60, height: 60 },
  rectangle: { width: 100, height: 60 },
};

export function snap(value: number, grid = GRID): number {
  return Math.round(value / grid) * grid;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** Keeps a table inside the room whatever the designer was asked to do. */
export function clampToPlan(table: Pick<FloorTable, "x" | "y" | "shape">): { x: number; y: number } {
  const size = TABLE_SIZE[table.shape] ?? TABLE_SIZE.square;

  return {
    x: clamp(snap(table.x), 0, PLAN_WIDTH - size.width),
    y: clamp(snap(table.y), 0, PLAN_HEIGHT - size.height),
  };
}

/**
 * Seats in a room, counting only tables that are in service.
 *
 * Read back to staff as "12 tables · 48 seats" and offered as *"set this
 * evening's capacity from the plan"* — never applied silently, because that
 * would change every existing date the moment somebody drew a room (§5).
 */
export function countRoom(room: FloorRoom): { tables: number; seats: number } {
  const live = room.tables.filter((table) => table.active);

  return {
    tables: live.length,
    seats: live.reduce((total, table) => total + Math.max(0, table.seats), 0),
  };
}

export function countPlan(plan: FloorPlan): { rooms: number; tables: number; seats: number } {
  return plan.rooms.reduce(
    (total, room) => {
      const counted = countRoom(room);
      return {
        rooms: total.rooms + 1,
        tables: total.tables + counted.tables,
        seats: total.seats + counted.seats,
      };
    },
    { rooms: 0, tables: 0, seats: 0 },
  );
}

/** Every table in the plan, with the room it belongs to. */
export function allTables(plan: FloorPlan): Array<FloorTable & { roomId: string; roomName: string }> {
  return plan.rooms.flatMap((room) =>
    room.tables.map((table) => ({ ...table, roomId: room.id, roomName: room.name })),
  );
}

/**
 * Labels that appear on more than one table, upper-cased and trimmed first.
 *
 * A duplicate is not a drawing mistake, it is a service one: the label becomes
 * a booking's `tableNumber`, and two tables answering to "7" makes the sheet
 * ambiguous about where a party is sitting. Compared **across rooms**, because
 * "table 7 on the terrace" and "table 7 inside" are read off the same sheet.
 */
export function duplicateLabels(plan: FloorPlan): string[] {
  const seen = new Map<string, number>();

  for (const table of allTables(plan)) {
    const key = table.label.trim().toUpperCase();
    if (key) {
      seen.set(key, (seen.get(key) ?? 0) + 1);
    }
  }

  return [...seen.entries()].filter(([, count]) => count > 1).map(([label]) => label).sort();
}

/** Tables with no label at all: they could never be written onto a booking. */
export function unlabelledTables(plan: FloorPlan): number {
  return allTables(plan).filter((table) => !table.label.trim()).length;
}

/**
 * What is wrong with the plan, in words meant for whoever drew it.
 *
 * Saving is not blocked on these — a half-drawn room is a legitimate thing to
 * come back to tomorrow — with the single exception of duplicate labels, which
 * the route refuses because of what the label becomes downstream.
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

/**
 * A stored value read back as a plan, whatever it actually turns out to be.
 *
 * The same contract as `toCurrency` and `toTimeZone`: the store holds whatever
 * was last written to it, which may be nothing, may predate a field, and may
 * have been written by a version of this app that did not exist yet. Nothing
 * here throws. Anything unrecognisable becomes an empty plan, and any single
 * unreadable table is dropped rather than taking its room down with it.
 *
 * It also runs on the way *in*, so a payload that passed the schema still gets
 * its positions snapped and clamped and its counts capped — the schema says the
 * shape is right, this says the values are sane.
 */
export function toFloorPlan(value: unknown): FloorPlan {
  if (!value || typeof value !== "object") {
    return EMPTY_PLAN;
  }

  const rooms = (value as { rooms?: unknown }).rooms;

  if (!Array.isArray(rooms)) {
    return EMPTY_PLAN;
  }

  return {
    rooms: rooms
      .slice(0, MAX_ROOMS)
      .map(toFloorRoom)
      .filter((room): room is FloorRoom => room !== null),
  };
}

function toFloorRoom(value: unknown): FloorRoom | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const room = value as { id?: unknown; name?: unknown; tables?: unknown };
  const tables = Array.isArray(room.tables) ? room.tables : [];

  return {
    id: asId(room.id),
    name: asText(room.name, 60) || "Room",
    tables: tables
      .slice(0, MAX_TABLES_PER_ROOM)
      .map(toFloorTable)
      .filter((table): table is FloorTable => table !== null),
  };
}

function toFloorTable(value: unknown): FloorTable | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const table = value as Record<string, unknown>;
  const shape = TABLE_SHAPES.includes(table.shape as TableShape) ? (table.shape as TableShape) : "round";
  const position = clampToPlan({ x: asNumber(table.x), y: asNumber(table.y), shape });

  return {
    id: asId(table.id),
    label: asText(table.label, 12),
    seats: Math.min(Math.max(Math.round(asNumber(table.seats)), 0), MAX_SEATS_PER_TABLE),
    x: position.x,
    y: position.y,
    shape,
    // Stored in quarter turns: a table at 37° is a drawing nobody meant.
    rotation: ((Math.round(asNumber(table.rotation) / 90) * 90) % 360 + 360) % 360,
    // Absent reads as in service, so a table written before the field existed
    // does not silently vanish from the room.
    active: table.active !== false,
    tags: Array.isArray(table.tags)
      ? [...new Set(table.tags.map((tag) => asText(tag, 24)).filter(Boolean))].slice(0, 8)
      : undefined,
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
  return existing || `t-${Math.random().toString(36).slice(2, 10)}`;
}

/** A new table, dropped somewhere sensible rather than on top of the last one. */
export function newTable(room: FloorRoom, shape: TableShape = "round"): FloorTable {
  const taken = new Set(room.tables.map((table) => `${table.x},${table.y}`));
  const size = TABLE_SIZE[shape];

  for (let y = GRID; y < PLAN_HEIGHT - size.height; y += size.height + GRID) {
    for (let x = GRID; x < PLAN_WIDTH - size.width; x += size.width + GRID) {
      if (!taken.has(`${x},${y}`)) {
        return {
          id: asId(undefined),
          label: nextLabel(room),
          seats: shape === "rectangle" ? 6 : 4,
          x,
          y,
          shape,
          rotation: 0,
          active: true,
        };
      }
    }
  }

  // A full room still gets its table; the designer can move it.
  return { id: asId(undefined), label: nextLabel(room), seats: 4, x: GRID, y: GRID, shape, rotation: 0, active: true };
}

/**
 * The next free number, counting from one.
 *
 * Only purely numeric labels are considered, so a room of "T1"/"T2" or of
 * named tables is left alone rather than being given a number that clashes
 * with a scheme somebody chose on purpose.
 */
function nextLabel(room: FloorRoom): string {
  const numbers = room.tables
    .map((table) => Number(table.label.trim()))
    .filter((value) => Number.isInteger(value) && value > 0);

  for (let candidate = 1; candidate <= numbers.length + 1; candidate += 1) {
    if (!numbers.includes(candidate)) {
      return String(candidate);
    }
  }

  return String(numbers.length + 1);
}

export function newRoom(plan: FloorPlan): FloorRoom {
  const names = new Set(plan.rooms.map((room) => room.name.toLowerCase()));
  const base = plan.rooms.length === 0 ? "Main room" : "New room";

  let name = base;
  for (let suffix = 2; names.has(name.toLowerCase()); suffix += 1) {
    name = `${base} ${suffix}`;
  }

  return { id: asId(undefined), name, tables: [] };
}
