import { randomBytes } from "crypto";
import { RESERVATION_PREFIX } from "@/lib/brand";
import { isMongoConfigured, connectToDatabase } from "@/lib/db/connect";
import { ReservationModel } from "@/lib/models/reservation";
import { RestaurantDateModel } from "@/lib/models/restaurant-date";
import { toEveningOverrides, type EveningOverrides } from "@/lib/evening-features";
import {
  claimTable,
  releaseTable,
  seatsToClaim,
  tableNumberFrom,
  TableClaimError,
  type HeldTable,
} from "@/lib/services/table-claims";
import { getFloorPlan } from "@/lib/services/settings";
import { allTables } from "@/lib/floor-plan";
import {
  cancelLocalReservation,
  createLocalReservation,
  findLocalReservationsByPassKey,
  getLocalReservation,
  listLocalReservations,
  listLocalReservationsByDate,
  listLocalReservationsBetween,
  reservationNumberExists,
  deleteLocalReservation,
  restoreLocalReservation,
  setLocalReservationGroup,
  updateLocalReservationDetails,
  setLocalReservationTable,
  setLocalReservationPlanTable,
  updateLocalReservationSelections,
  updateLocalReservationAddOns,
  updateLocalReservationAttendance,
  updateLocalReservationStaffNote,
  updateLocalReservationCourseServed,
  updateLocalReservationGuestServed,
  updateLocalReservationCourseGuests,
  upsertLocalDate,
} from "@/lib/db/local-store";
import { getRestaurantDate } from "@/lib/services/restaurant";
import {
  withRemainingSeats,
  type CancellationRecord,
  type ReservationContact,
  type ReservationRecord,
  type ReservationSelection,
  type ReservationAddOn,
  type ReservationAttendance,
  type ReservationServiceProgress,
  type TableSource,
} from "@/types/booking";

export class BookingError extends Error {
  constructor(public readonly code: "DATE_CLOSED" | "DATE_FULL") {
    super(code);
    this.name = "BookingError";
  }
}

export function generateReservationNumber() {
  return `${RESERVATION_PREFIX}-${randomBytes(3).toString("hex").toUpperCase()}`;
}

/** Retries on the (rare) chance of generating a number that is already taken. */
async function allocateReservationNumber(isTaken: (candidate: string) => Promise<boolean>) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const candidate = generateReservationNumber();
    if (!(await isTaken(candidate))) {
      return candidate;
    }
  }

  // Fall back to a longer number rather than failing the guest's booking.
  return `${RESERVATION_PREFIX}-${randomBytes(5).toString("hex").toUpperCase()}`;
}

/**
 * Reserves a number before the booking exists.
 *
 * The pass-key has to be spent before the reservation is written — that is
 * what makes a key unusable twice — and the key records which booking it paid
 * for, so the number has to be known first. Checked for collisions exactly as
 * an internally allocated one is.
 */
export async function reserveReservationNumber(): Promise<string> {
  if (!isMongoConfigured()) {
    return allocateReservationNumber(reservationNumberExists);
  }

  await connectToDatabase();
  return allocateReservationNumber(
    async (candidate) => Boolean(await ReservationModel.exists({ reservationNumber: candidate })),
  );
}

type MongoReservationDocument = {
  _id: unknown;
  reservationNumber: unknown;
  roomNumber: unknown;
  additionalRooms?: unknown;
  guestCount: unknown;
  date: unknown;
  kind?: unknown;
  guestName?: unknown;
  selections?: unknown;
  addOns?: unknown;
  attendance?: unknown;
  service?: unknown;
  contact?: unknown;
  time?: unknown;
  endTime?: unknown;
  notes?: unknown;
  staffNote?: unknown;
  tableId?: unknown;
  tableIds?: unknown;
  tableGroupId?: unknown;
  tableNumber?: unknown;
  tableSource?: unknown;
  tableSetAt?: unknown;
  version?: unknown;
  status?: unknown;
  passKeyId?: unknown;
  cancellation?: unknown;
  createdAt?: unknown;
  updatedAt?: unknown;
};

function toReservationRecord(document: MongoReservationDocument): ReservationRecord {
  return {
    _id: String(document._id),
    reservationNumber: String(document.reservationNumber),
    kind: document.kind === "premium" ? "premium" : "standard",
    roomNumber: String(document.roomNumber ?? ""),
    // Absent, empty or written by an older version all read as "one room".
    additionalRooms:
      Array.isArray(document.additionalRooms) && document.additionalRooms.length > 0
        ? document.additionalRooms.map((room) => String(room))
        : undefined,
    guestName: document.guestName ? String(document.guestName) : undefined,
    guestCount: Number(document.guestCount),
    date: String(document.date),
    selections: Array.isArray(document.selections) ? (document.selections as ReservationSelection[]) : [],
    addOns: Array.isArray(document.addOns) ? (document.addOns as ReservationAddOn[]) : undefined,
    // Absent stays absent: unknown attendance is not "seated" (rule in
    // `docs/service-tracking.md` §2), and nothing may default it.
    attendance: (document.attendance as ReservationAttendance | undefined) ?? undefined,
    service: (document.service as ReservationServiceProgress | undefined) ?? undefined,
    contact: (document.contact as ReservationContact | undefined) ?? undefined,
    time: document.time ? String(document.time) : undefined,
    endTime: document.endTime ? String(document.endTime) : undefined,
    notes: document.notes ? String(document.notes) : undefined,
    staffNote: document.staffNote ? String(document.staffNote) : undefined,
    tableId: document.tableId ? String(document.tableId) : undefined,
    // Only meaningful with more than one: a list of one is a single table
    // wearing a list, and every reader would then have two ways to ask the
    // same question.
    tableIds:
      Array.isArray(document.tableIds) && document.tableIds.length > 1
        ? document.tableIds.map((id) => String(id))
        : undefined,
    tableGroupId: document.tableGroupId ? String(document.tableGroupId) : undefined,
    tableNumber: document.tableNumber ? String(document.tableNumber) : undefined,
    tableSource: (document.tableSource as ReservationRecord["tableSource"]) || undefined,
    tableSetAt: document.tableSetAt ? String(document.tableSetAt) : undefined,
    version: typeof document.version === "number" ? document.version : undefined,
    status: document.status === "cancelled" ? "cancelled" : "confirmed",
    passKeyId: document.passKeyId ? String(document.passKeyId) : undefined,
    cancellation: (document.cancellation as CancellationRecord | undefined) ?? undefined,
    createdAt: document.createdAt ? new Date(document.createdAt as string).toISOString() : undefined,
    updatedAt: document.updatedAt ? new Date(document.updatedAt as string).toISOString() : undefined,
  };
}

/**
 * Every write to a booking moves it on one version.
 *
 * ## Why a counter at all
 *
 * The audit log says what changed; the version says **which booking it changed
 * to**. Reading a history without one, you can see six entries and still not be
 * sure whether the record in front of you is the one the last entry produced or
 * something written since. With it, every entry names the version it made, and
 * the record names the version it is: "this is v7, and the log's last entry made
 * v7" is a question anybody can answer at a glance.
 *
 * ## $inc, not read-then-write
 *
 * Rule 2.7. Two waiters marking different courses on the same table must not
 * lose each other's bump, and a counter incremented in the same atomic update as
 * the change it counts cannot drift from it.
 *
 * Absent on every booking written before this existed, which reads as "no
 * version recorded" — never as version 0, and never as 1, because claiming a
 * booking is untouched when nobody knows is exactly the lie this is meant to
 * prevent.
 */
function bumped(update: Record<string, unknown>): Record<string, unknown> {
  const existing = (update.$inc as Record<string, number> | undefined) ?? {};

  return { ...update, $inc: { ...existing, version: 1 } };
}

export class TableJoinError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TableJoinError";
  }
}

/**
 * Works out which table group a new booking belongs to.
 *
 * The party being joined must exist, be for the same evening and still be
 * live; otherwise rooms could be attached to a cancelled or unrelated table.
 */
async function resolveTableGroup(joinReservationNumber: string | undefined, date: string) {
  if (!joinReservationNumber) {
    return undefined;
  }

  const target = await getReservationByNumber(joinReservationNumber.trim().toUpperCase());

  if (!target) {
    throw new TableJoinError("We could not find that reservation number. Please check it and try again.");
  }

  if (target.date !== date) {
    throw new TableJoinError("That reservation is for a different evening, so you cannot share a table.");
  }

  if (target.status !== "confirmed") {
    throw new TableJoinError("That reservation has been cancelled, so you cannot share a table with it.");
  }

  if (target.tableGroupId) {
    return target.tableGroupId;
  }

  // First time this party is joined: it becomes the anchor of the group.
  const groupId = target.reservationNumber;
  await setReservationGroup(target.reservationNumber, groupId);
  return groupId;
}

async function setReservationGroup(reservationNumber: string, tableGroupId: string) {
  if (!isMongoConfigured()) {
    await setLocalReservationGroup(reservationNumber, tableGroupId);
    return;
  }

  await connectToDatabase();
  await ReservationModel.updateOne({ reservationNumber }, bumped({ $set: { tableGroupId } }));
}

/**
 * Sets a table number across everyone sharing that table.
 *
 * `source` says who decided, and travels with the number itself rather than
 * being written separately afterwards: the two must never disagree, and a
 * table cleared without its source cleared would claim a guest had picked a
 * table that is no longer there.
 */
export async function assignTableNumber(
  reservationNumber: string,
  tableNumber: string,
  source: TableSource,
) {
  if (!isMongoConfigured()) {
    return setLocalReservationTable(reservationNumber, tableNumber, source);
  }

  await connectToDatabase();
  const target = await ReservationModel.findOne({ reservationNumber }).lean();
  if (!target) {
    return null;
  }

  const filter = target.tableGroupId ? { tableGroupId: target.tableGroupId } : { reservationNumber };
  const written = tableNumber.trim()
    ? { tableNumber, tableSource: source, tableSetAt: new Date().toISOString() }
    : { tableNumber, tableSource: null, tableSetAt: null };

  await ReservationModel.updateMany(filter, bumped({ $set: written }));

  const updated = await ReservationModel.find(filter).lean();
  return updated.map((entry) => toReservationRecord(entry as MongoReservationDocument));
}

/**
 * Moves a booking from one plan table to another, claims and all.
 *
 * The guest's own table change (`/api/booking/manage/table`) and nothing else
 * yet. Staff assign by *label* through `assignTableNumber`, which is a
 * different thing: a label typed at the desk may name a table that is not on
 * the plan at all, and it moves everybody sharing the table.
 *
 * ## The order is the whole design
 *
 * 1. **Claim the new table first.** A guest who cannot have table 9 must still
 *    have table 7 — the one they already hold — when they are told so.
 * 2. Write the booking.
 * 3. **Release the old table last**, and only once the write succeeded.
 *
 * Claiming before releasing means the two can briefly be held at once, which
 * costs one table's worth of availability for a few milliseconds. Releasing
 * first would mean a failure in the middle leaves the guest with no table at
 * all, and somebody else may have taken theirs in between. One of those is an
 * inconvenience and the other is a booking nobody can honour.
 *
 * A failed release is logged and not raised: the write has happened, the guest
 * has their new table, and a claim left behind on the old one holds a table
 * that is really free — worth an alert, never worth failing the change the
 * guest can see.
 */
export async function moveReservationTable(input: {
  reservationNumber: string;
  date: string;
  guests: number;
  /** The plan tables currently held, if any. */
  from?: HeldTable[];
  /** Where it is going, or `null` to hand the tables back and be seated. */
  to: HeldTable[] | null;
  source: TableSource;
}): Promise<ReservationRecord | null> {
  const wanted = input.to ?? [];
  const claimed: HeldTable[] = [];

  for (const table of wanted) {
    // Claimed one at a time, and a failure part way through gives back what was
    // already taken: a party that fits on the first of two tables and not the
    // second must end up holding neither.
    try {
      await claimTable({
        date: input.date,
        tableId: table.id,
        seats: table.seats,
        guests: seatsToClaim(wanted, table, input.guests),
        reservationNumber: input.reservationNumber,
        // A row is taken whole here too, and its party is counted against the
        // first of its tables rather than being made to fit at each of them.
        whole: wanted.length > 1,
      });
    } catch (error) {
      await releaseHeldTables(input.date, claimed, input.guests, input.reservationNumber, wanted);
      throw error;
    }

    claimed.push(table);
  }

  let saved: ReservationRecord | null = null;

  try {
    saved = await writePlanTable(input.reservationNumber, wanted, input.source);
  } catch (error) {
    await releaseHeldTables(input.date, claimed, input.guests, input.reservationNumber, wanted);
    throw error;
  }

  if (!saved) {
    // The booking vanished between being read and being written. Give the new
    // claims back rather than holding tables for nobody.
    await releaseHeldTables(input.date, claimed, input.guests, input.reservationNumber, wanted);
    return null;
  }

  const keeping = new Set(wanted.map((table) => table.id));
  const leaving = (input.from ?? []).filter((table) => !keeping.has(table.id));

  if (leaving.length > 0) {
    // Released against what the booking *was* holding, not what it holds now:
    // a party coming off two pushed-together tables claimed both whole, and
    // releasing either for the party size would leave the count wrong.
    await releaseHeldTables(input.date, leaving, input.guests, input.reservationNumber, input.from ?? []);
  }

  return saved;
}

/** The write half of a move: the plan tables on the booking, and who chose them. */
async function writePlanTable(
  reservationNumber: string,
  tables: readonly HeldTable[],
  source: TableSource,
): Promise<ReservationRecord | null> {
  if (!isMongoConfigured()) {
    return setLocalReservationPlanTable(reservationNumber, tables, source);
  }

  await connectToDatabase();

  const update = tables.length
    ? {
        $set: {
          tableId: tables[0].id,
          tableNumber: tableNumberFrom(tables),
          tableSource: source,
          tableSetAt: new Date().toISOString(),
          // Written as an empty list rather than unset for one table, so the
          // two fields cannot disagree about how many tables a booking holds.
          tableIds: tables.length > 1 ? tables.map((table) => table.id) : [],
        },
      }
    : { $unset: { tableId: "", tableIds: "", tableNumber: "", tableSource: "", tableSetAt: "" } };

  const saved = await ReservationModel.findOneAndUpdate({ reservationNumber }, bumped(update), {
    returnDocument: "after",
  }).lean();

  return saved ? toReservationRecord(saved as MongoReservationDocument) : null;
}

export async function createReservationEntry(input: {
  roomNumber: string;
  /** Other rooms sharing this table, from a ticket that named several. */
  additionalRooms?: string[];
  guestCount: number;
  date: string;
  selections: ReservationSelection[];
  contact?: ReservationContact;
  notes?: string;
  tableNumber?: string;
  /**
   * The table this booking picked, resolved from the plan by the caller.
   *
   * Present only when the evening has table selection on and the guest chose.
   * The caller looks the table up so this module needs to know nothing about
   * floor plans — and so a request cannot claim against a table nobody checked
   * exists, or lie about how many it seats.
   *
   * When present, `tableNumber` is set from its label, which is the continuity
   * point the whole feature rests on: the sheet, the board and
   * `groupRoomRowsByTable` already key on that string and need no changes
   * (`docs/floor-plan.md` §3).
   */
  tables?: HeldTable[];
  /**
   * Who chose the table on this booking.
   *
   * A booking made through the guest flow with `table` set is a guest's own
   * pick; one taken at the desk with `tableNumber` typed in is not. The caller
   * knows which it is and this module does not, so it is passed rather than
   * guessed. Absent when no table was set either way.
   */
  tableSource?: TableSource;
  kind?: ReservationRecord["kind"];
  guestName?: string;
  /** Reservation number of a party this booking should share a table with. */
  joinReservationNumber?: string;
  /**
   * The pass-key spent on this booking. It is already marked used by the time
   * we get here; storing the id is what lets the guest come back to it.
   */
  passKeyId?: string;
  /**
   * Pre-allocated by the caller when something else already had to know it —
   * the pass-key is spent, and records the booking it paid for, before the
   * booking itself is written.
   */
  reservationNumber?: string;
}): Promise<ReservationRecord> {
  const tableGroupId = await resolveTableGroup(input.joinReservationNumber, input.date);

  if (!isMongoConfigured()) {
    const reservationNumber =
      input.reservationNumber ?? (await allocateReservationNumber(reservationNumberExists));
    const result = await createLocalReservation({ ...input, reservationNumber, tableGroupId });

    if (!result.ok) {
      throw new BookingError(result.reason);
    }

    return result.reservation;
  }

  await connectToDatabase();

  const reservationNumber =
    input.reservationNumber ??
    (await allocateReservationNumber(
      async (candidate) => Boolean(await ReservationModel.exists({ reservationNumber: candidate })),
    ));

  /**
   * Claim the seats with a single conditional update. The filter only matches
   * while the date is open and still has room, so concurrent bookings cannot
   * oversell — and unlike a transaction this also works on a standalone
   * mongod, which has no replica set to run transactions on.
   */
  const claimedDate = await RestaurantDateModel.findOneAndUpdate(
    {
      date: input.date,
      isOpen: true,
      $expr: { $gte: [{ $subtract: ["$capacity", "$reservedSeats"] }, input.guestCount] },
    },
    { $inc: { reservedSeats: input.guestCount } },
    { returnDocument: "after" },
  ).lean();

  if (!claimedDate) {
    const existing = await RestaurantDateModel.findOne({ date: input.date }).lean();
    throw new BookingError(!existing || !existing.isOpen ? "DATE_CLOSED" : "DATE_FULL");
  }

  const bookedDate = await getRestaurantDate(input.date);

  /**
   * The second claim.
   *
   * Two things can be exhausted once guests pick their own table, and the seat
   * count cannot answer the second: a room can have twenty free seats and no
   * free table that fits four. So the seats are claimed above, the table here,
   * and **a failure hands the seats straight back** — the same unwinding this
   * function already does when the write itself fails.
   *
   * `docs/floor-plan.md` §2: never a read-then-write. `claimTable` is
   * conditional all the way down.
   */
  if (input.tables?.length) {
    const claimed: HeldTable[] = [];

    try {
      for (const table of input.tables) {
        await claimTable({
          date: input.date,
          tableId: table.id,
          seats: table.seats,
          guests: seatsToClaim(input.tables, table, input.guestCount),
          reservationNumber,
          /**
           * A row is taken whole; a single shared table is an ordinary shared
           * table, where two rooms take a seat each and both counts are real.
           */
          whole: (input.tables?.length ?? 0) > 1,
          /**
           * And when the row is being pushed onto the booking this party said
           * they are sitting with, their claim is the one to join rather than
           * a table to be refused.
           */
          joiningWith: (input.tables?.length ?? 0) > 1 ? (tableGroupId ?? undefined) : undefined,
        });

        claimed.push(table);
      }
    } catch (error) {
      // Tables pushed together are claimed one at a time, so the second can
      // fail with the first already held. Give back whatever was taken before
      // handing the seats back, or the room loses a table to a booking that
      // never happened.
      await releaseHeldTables(input.date, claimed, input.guestCount, reservationNumber, input.tables);
      await RestaurantDateModel.updateOne({ date: input.date }, { $inc: { reservedSeats: -input.guestCount } });
      throw error;
    }
  }

  try {
    const created = await ReservationModel.create({
      reservationNumber,
      roomNumber: input.roomNumber,
      additionalRooms: input.additionalRooms?.length ? input.additionalRooms : undefined,
      guestCount: input.guestCount,
      date: input.date,
      kind: input.kind ?? "standard",
      guestName: input.guestName,
      selections: input.selections,
      contact: input.contact,
      // Copied from the date so the booking keeps the times it was made for.
      time: bookedDate?.serviceTime,
      endTime: bookedDate?.serviceEndTime,
      notes: input.notes,
      // The claimed table's label becomes the booking's table number, which is
      // what every downstream screen already reads.
      tableNumber: tableNumberFrom(input.tables) ?? input.tableNumber,
      tableId: input.tables?.[0]?.id,
      // Only the several-table case stores a list; one table keeps reading as
      // one table, on every booking ever written.
      tableIds: (input.tables?.length ?? 0) > 1 ? input.tables?.map((table) => table.id) : undefined,
      // Only when there is a table to attribute: a booking with no table has
      // nobody who chose it.
      tableSource: tableNumberFrom(input.tables) ?? input.tableNumber ? input.tableSource : undefined,
      tableSetAt: tableNumberFrom(input.tables) ?? input.tableNumber ? new Date().toISOString() : undefined,
      tableGroupId,
      status: "confirmed",
      passKeyId: input.passKeyId,
      // Every booking starts at one, so "no version" can only ever mean a
      // record written before versions existed.
      version: 1,
    });

    return toReservationRecord(created.toObject() as MongoReservationDocument);
  } catch (error) {
    // Give back both claims if the reservation itself could not be written.
    await RestaurantDateModel.updateOne({ date: input.date }, { $inc: { reservedSeats: -input.guestCount } });

    if (input.tables?.length) {
      await releaseHeldTables(input.date, input.tables, input.guestCount, reservationNumber, input.tables);
    }

    throw error;
  }
}

export async function getReservationByNumber(reservationNumber: string): Promise<ReservationRecord | null> {
  if (!isMongoConfigured()) {
    return getLocalReservation(reservationNumber);
  }

  await connectToDatabase();
  const reservation = await ReservationModel.findOne({ reservationNumber }).lean();
  return reservation ? toReservationRecord(reservation as MongoReservationDocument) : null;
}

/**
 * Cancels a confirmed reservation and releases its seats. The status filter
 * makes this idempotent: cancelling an already-cancelled booking returns the
 * record without refunding the seats a second time.
 *
 * `cancellation` records who did it. It is written onto the booking in the
 * same update as the status, so a cancelled record always says who cancelled
 * it even if the audit log write later fails.
 */
export async function cancelReservation(
  reservationNumber: string,
  cancellation?: CancellationRecord,
): Promise<ReservationRecord | null> {
  if (!isMongoConfigured()) {
    return cancelLocalReservation(reservationNumber, cancellation);
  }

  await connectToDatabase();

  const cancelled = await ReservationModel.findOneAndUpdate(
    { reservationNumber, status: "confirmed" },
    bumped({ $set: { status: "cancelled", ...(cancellation ? { cancellation } : {}) } }),
    { returnDocument: "after" },
  ).lean();

  if (!cancelled) {
    const existing = await ReservationModel.findOne({ reservationNumber }).lean();
    return existing ? toReservationRecord(existing as MongoReservationDocument) : null;
  }

  const record = toReservationRecord(cancelled as MongoReservationDocument);
  await RestaurantDateModel.updateOne({ date: record.date }, { $inc: { reservedSeats: -record.guestCount } });

  /**
   * Both claims come back, not just the seats.
   *
   * A cancelled booking that kept its table would block it for the rest of the
   * evening with nobody sitting there and nothing on any screen to explain it.
   * `releaseTable` is idempotent (rule 2.7's habit), so the status filter above
   * already making this safe to run twice extends to the table as well.
   */
  await releaseClaimedTable(record);

  return record;
}

/**
 * Hands back the tables a booking held. Safe to call twice.
 *
 * One table releases the party's own guests, which is what it claimed and what
 * lets a second room sharing the table keep its seats. Several tables were
 * claimed **whole**, so they are released whole — and finding out how many
 * seats each has means reading the plan, which is why that read happens here
 * and only for the bookings that need it. A single-table booking cancels with
 * exactly the reads it always did.
 */
async function releaseClaimedTable(record: ReservationRecord): Promise<void> {
  const ids = record.tableIds?.length ? record.tableIds : record.tableId ? [record.tableId] : [];

  if (ids.length === 0) {
    return;
  }

  if (ids.length === 1) {
    await releaseTable({
      date: record.date,
      tableId: ids[0],
      guests: record.guestCount,
      reservationNumber: record.reservationNumber,
    }).catch((error) => {
      // The booking is already cancelled and its seats are back. A table that
      // failed to release is a table that reads busy — visible and fixable —
      // rather than a cancellation that half happened.
      console.error("[reservations] failed to release a table on cancellation", error);
    });

    return;
  }

  const plan = await getFloorPlan();
  const onPlan = allTables(plan).filter((table) => ids.includes(table.id));

  /**
   * In the order the booking holds them, because what a row counted against
   * each table depends on which one came first (`seatsToClaim`) — and giving
   * back a different number than was taken is how a table ends up reading busy
   * with nobody at it.
   *
   * A table missing from the plan since the booking was made still has to be
   * let go of, so it stands in with the seats it was recorded with.
   */
  const held = ids.map(
    (id) => onPlan.find((table) => table.id === id) ?? { id, label: "", seats: 0 },
  );

  for (const table of held) {
    await releaseTable({
      date: record.date,
      tableId: table.id,
      guests: seatsToClaim(held, table, record.guestCount),
      reservationNumber: record.reservationNumber,
    }).catch((error) => {
      console.error("[reservations] failed to release a table on cancellation", error);
    });
  }
}

/**
 * Gives back tables a half-finished booking had already taken.
 *
 * `held` is what was actually claimed; `all` is what the booking was trying to
 * hold, which is what decides whether each was claimed whole or for the party.
 * Failures are logged and swallowed — this runs while something else is already
 * going wrong, and a stale claim is a table that reads busy rather than a
 * booking that half happened.
 */
async function releaseHeldTables(
  date: string,
  held: readonly HeldTable[],
  guests: number,
  reservationNumber: string,
  all: readonly HeldTable[],
): Promise<void> {
  for (const table of held) {
    await releaseTable({
      date,
      tableId: table.id,
      guests: seatsToClaim(all, table, guests),
      reservationNumber,
    }).catch((error) => {
      console.error("[reservations] failed to release a table after a failed booking", error);
    });
  }
}

export class RestoreError extends Error {
  constructor(public readonly code: "NOT_CANCELLED" | "DATE_CLOSED" | "DATE_FULL") {
    super(code);
    this.name = "RestoreError";
  }
}

/**
 * Undoes a cancellation.
 *
 * This is not simply flipping the status back. The seats were handed to the
 * pool when the booking was cancelled and somebody else may have taken them,
 * so they must be claimed again — with the same single conditional update used
 * when a booking is made, so a restore and a new booking racing for the last
 * table cannot both win. If the record write then fails, the seats go back.
 *
 * **The table is a fresh claim too** (`docs/floor-plan.md` §7). It was released
 * on cancellation and somebody else may be sitting there now, so a restore that
 * assumed it back would double-book the room. If the table has gone, the
 * restore fails cleanly and hands the seats back rather than restoring a
 * booking to a table that is taken — the guest can be given another one, but
 * two parties at one table is not recoverable at the door.
 */
export async function restoreReservation(reservationNumber: string): Promise<ReservationRecord | null> {
  if (!isMongoConfigured()) {
    const result = await restoreLocalReservation(reservationNumber);

    if (!result.ok) {
      if (result.reason === "NOT_FOUND") {
        return null;
      }
      throw new RestoreError(result.reason);
    }

    return result.reservation;
  }

  await connectToDatabase();

  const existingDocument = await ReservationModel.findOne({ reservationNumber }).lean();
  if (!existingDocument) {
    return null;
  }

  const existing = toReservationRecord(existingDocument as MongoReservationDocument);

  if (existing.status !== "cancelled") {
    throw new RestoreError("NOT_CANCELLED");
  }

  const claimed = await RestaurantDateModel.findOneAndUpdate(
    {
      date: existing.date,
      isOpen: true,
      $expr: { $gte: [{ $subtract: ["$capacity", "$reservedSeats"] }, existing.guestCount] },
    },
    { $inc: { reservedSeats: existing.guestCount } },
    { returnDocument: "after" },
  ).lean();

  if (!claimed) {
    const target = await RestaurantDateModel.findOne({ date: existing.date }).lean();
    throw new RestoreError(!target || !target.isOpen ? "DATE_CLOSED" : "DATE_FULL");
  }

  /**
   * The table, claimed fresh — see the note above. It was given back when the
   * booking was cancelled, so it has to be won again like any other, and a
   * failure hands the seats straight back.
   */
  if (existing.tableId) {
    const plan = await getFloorPlan();
    const table = allTables(plan).find((entry) => entry.id === existing.tableId);

    try {
      // A table that has since been deleted from the plan cannot be claimed,
      // and the restore has to say so rather than quietly restoring a booking
      // to a table that no longer exists.
      if (!table) {
        throw new TableClaimError("TABLE_TAKEN");
      }

      await claimTable({
        date: existing.date,
        tableId: table.id,
        seats: table.seats,
        guests: existing.guestCount,
        reservationNumber,
      });
    } catch (error) {
      await RestaurantDateModel.updateOne(
        { date: existing.date },
        { $inc: { reservedSeats: -existing.guestCount } },
      );
      throw error;
    }
  }

  try {
    /**
     * The status filter makes this safe against two restores at once: the
     * second finds nothing to update and gives its seats back below.
     */
    const restored = await ReservationModel.findOneAndUpdate(
      { reservationNumber, status: "cancelled" },
      // The cancellation snapshot goes with the cancellation it described.
      // The audit log keeps both the cancellation and this restore.
      bumped({ $set: { status: "confirmed" }, $unset: { cancellation: "" } }),
      { returnDocument: "after" },
    ).lean();

    if (!restored) {
      throw new RestoreError("NOT_CANCELLED");
    }

    return toReservationRecord(restored as MongoReservationDocument);
  } catch (error) {
    await RestaurantDateModel.updateOne(
      { date: existing.date },
      { $inc: { reservedSeats: -existing.guestCount } },
    );
    throw error;
  }
}

/**
 * Every booking made with a pass-key, newest first.
 *
 * A key can carry more than one dinner now, so this is a list. It is how a
 * guest reaches their own reservations: the key is a secret, the reservation
 * number is not.
 */
export async function getReservationsByPassKey(passKeyId: string): Promise<ReservationRecord[]> {
  if (!passKeyId) {
    return [];
  }

  if (!isMongoConfigured()) {
    return findLocalReservationsByPassKey(passKeyId);
  }

  await connectToDatabase();

  const reservations = await ReservationModel.find({ passKeyId }).sort({ createdAt: -1 }).lean();
  return reservations.map((entry) => toReservationRecord(entry as MongoReservationDocument));
}

export type StaffReservationPatch = {
  roomNumber?: string;
  additionalRooms?: string[];
  guestCount?: number;
  date?: string;
  selections?: ReservationSelection[];
  notes?: string;
  contact?: ReservationContact;
  tableNumber?: string;
  /**
   * Who is setting that table. Required whenever `tableNumber` is, and ignored
   * otherwise — an edit that does not touch the table must not rewrite who
   * chose it.
   */
  tableSource?: TableSource;
  /**
   * Seat this booking with another one, named by its reservation number.
   *
   * A different thing from `additionalRooms`, and the difference is the whole
   * point. Extra rooms are more rooms on *this* booking — one ticket, one line
   * of dish counts, no separate order to show. A join links two bookings that
   * each ordered for themselves, so the sheet columns both parties under one
   * table and the kitchen sees what each of them asked for.
   *
   * An empty string leaves whatever table this booking is on. Undefined
   * changes nothing.
   */
  joinReservationNumber?: string;
};

/**
 * Staff edit of a booking: any field, including moving it to another evening
 * or changing the party size.
 *
 * Seat accounting is the delicate part. On Mongo the new date is claimed with
 * a single conditional update before the old one is released, so a concurrent
 * booking cannot take the seats in between; if anything downstream fails the
 * claim is handed back.
 */
export async function updateReservationDetails(
  reservationNumber: string,
  patch: StaffReservationPatch,
): Promise<ReservationRecord | null> {
  /**
   * The table group is settled before anything is written, and before either
   * store is touched.
   *
   * Two reasons for doing it out here rather than inside each path. It must
   * happen before the seats are claimed, so a mistyped reservation number
   * fails without leaving a seat claim to unwind. And on the local store the
   * write below runs inside `withStoreLock`, which `setLocalReservationGroup`
   * also takes — resolving in there would wait on a lock it already holds.
   *
   * `undefined` leaves the booking's table alone; `null` takes it off one.
   */
  let tableGroupId: string | null | undefined;

  if (patch.joinReservationNumber !== undefined) {
    const current = await getReservationByNumber(reservationNumber);

    if (!current) {
      return null;
    }

    const wanted = patch.joinReservationNumber.trim().toUpperCase();

    if (!wanted) {
      tableGroupId = null;
    } else if (wanted === current.reservationNumber.toUpperCase()) {
      throw new TableJoinError("A booking cannot be seated with itself.");
    } else {
      // Judged against the evening it is moving to, not the one it is leaving.
      tableGroupId = (await resolveTableGroup(wanted, patch.date ?? current.date)) ?? null;
    }
  }

  if (!isMongoConfigured()) {
    const result = await updateLocalReservationDetails(reservationNumber, { ...patch, tableGroupId });

    if (!result.ok) {
      if (result.reason === "NOT_FOUND") {
        return null;
      }
      throw new BookingError(result.reason);
    }

    return result.reservation;
  }

  await connectToDatabase();

  const existingDocument = await ReservationModel.findOne({ reservationNumber }).lean();
  if (!existingDocument) {
    return null;
  }

  const existing = toReservationRecord(existingDocument as MongoReservationDocument);
  const nextDate = patch.date ?? existing.date;
  const nextGuestCount = patch.guestCount ?? existing.guestCount;

  const holdsSeats = existing.status === "confirmed";
  const dateChanged = nextDate !== existing.date;
  const countChanged = nextGuestCount !== existing.guestCount;
  const seatsMoved = holdsSeats && (dateChanged || countChanged);

  if (seatsMoved) {
    // Seats already held on the target date do not count against the booking,
    // otherwise growing a party by one would need room for the whole table.
    const seatsAlreadyHeld = dateChanged ? 0 : existing.guestCount;
    const seatsNeeded = nextGuestCount - seatsAlreadyHeld;

    const claimed = await RestaurantDateModel.findOneAndUpdate(
      {
        date: nextDate,
        isOpen: true,
        $expr: { $gte: [{ $subtract: ["$capacity", "$reservedSeats"] }, seatsNeeded] },
      },
      { $inc: { reservedSeats: seatsNeeded } },
      { returnDocument: "after" },
    ).lean();

    if (!claimed) {
      const target = await RestaurantDateModel.findOne({ date: nextDate }).lean();
      throw new BookingError(!target || !target.isOpen ? "DATE_CLOSED" : "DATE_FULL");
    }

    if (dateChanged) {
      await RestaurantDateModel.updateOne(
        { date: existing.date },
        { $inc: { reservedSeats: -existing.guestCount } },
      );
    }
  }

  const targetDate = dateChanged ? await RestaurantDateModel.findOne({ date: nextDate }).lean() : null;

  const update: Record<string, unknown> = {
    roomNumber: patch.roomNumber ?? existing.roomNumber,
    guestCount: nextGuestCount,
    date: nextDate,
  };

  // An empty list is stored as such and read back as "one room", so dropping
  // the extra rooms from a booking needs no separate unset.
  if (patch.additionalRooms !== undefined) update.additionalRooms = patch.additionalRooms;
  if (patch.selections !== undefined) update.selections = patch.selections;
  if (patch.notes !== undefined) update.notes = patch.notes;
  if (patch.contact !== undefined) update.contact = patch.contact;
  if (patch.tableNumber !== undefined) {
    update.tableNumber = patch.tableNumber;
    // Cleared together: a table with no number cannot have been chosen by
    // anybody, and a stale source would be read as one.
    const set = patch.tableNumber.trim().length > 0;
    update.tableSource = set ? patch.tableSource ?? "staff" : null;
    update.tableSetAt = set ? new Date().toISOString() : null;
  }
  // null is stored as such and read back as "no table group", so leaving a
  // table needs no separate unset.
  if (tableGroupId !== undefined) update.tableGroupId = tableGroupId;

  if (dateChanged) {
    // Moving evenings adopts that evening's sitting times.
    update.time = targetDate?.serviceTime ?? null;
    update.endTime = targetDate?.serviceEndTime ?? null;
  }

  try {
    const saved = await ReservationModel.findOneAndUpdate(
      { reservationNumber },
      bumped({ $set: update }),
      { returnDocument: "after" },
    ).lean();

    return saved ? toReservationRecord(saved as MongoReservationDocument) : null;
  } catch (error) {
    if (seatsMoved) {
      // Hand the claimed seats back rather than leaving them stranded.
      const seatsAlreadyHeld = dateChanged ? 0 : existing.guestCount;
      await RestaurantDateModel.updateOne(
        { date: nextDate },
        { $inc: { reservedSeats: -(nextGuestCount - seatsAlreadyHeld) } },
      );
      if (dateChanged) {
        await RestaurantDateModel.updateOne(
          { date: existing.date },
          { $inc: { reservedSeats: existing.guestCount } },
        );
      }
    }
    throw error;
  }
}

/** Replaces the menu choices on a booking. Seats are unaffected. */
export async function updateReservationSelections(
  reservationNumber: string,
  selections: ReservationSelection[],
): Promise<ReservationRecord | null> {
  if (!isMongoConfigured()) {
    return updateLocalReservationSelections(reservationNumber, selections);
  }

  await connectToDatabase();
  const updated = await ReservationModel.findOneAndUpdate(
    { reservationNumber },
    bumped({ $set: { selections } }),
    { returnDocument: "after" },
  ).lean();

  return updated ? toReservationRecord(updated as MongoReservationDocument) : null;
}

export async function updateReservationAddOns(
  reservationNumber: string,
  addOns: ReservationAddOn[],
): Promise<ReservationRecord | null> {
  if (!isMongoConfigured()) {
    return updateLocalReservationAddOns(reservationNumber, addOns);
  }

  await connectToDatabase();
  const updated = await ReservationModel.findOneAndUpdate(
    { reservationNumber },
    bumped({ $set: { addOns } }),
    { returnDocument: "after" },
  ).lean();

  return updated ? toReservationRecord(updated as MongoReservationDocument) : null;
}

/**
 * Records whether a table turned up.
 *
 * A permanent fact, so `null` **clears** it back to unknown rather than
 * standing for "no-show" — undoing a mis-tap must not leave a different claim
 * behind.
 */
/**
 * The note staff leave on a booking. Never shown to a guest.
 *
 * An empty note **unsets** the field rather than storing "", so "nobody has
 * written anything" has one representation and a cleared note leaves nothing
 * behind on the document.
 *
 * One key, last write wins — the same shape as the attendance mark beside it.
 * Two people typing a note on the same booking is not a race worth a
 * transaction; the later one is the one that meant it.
 */
export async function setReservationStaffNote(
  reservationNumber: string,
  note: string,
): Promise<ReservationRecord | null> {
  const trimmed = note.trim();

  if (!isMongoConfigured()) {
    return updateLocalReservationStaffNote(reservationNumber, trimmed);
  }

  await connectToDatabase();
  const updated = await ReservationModel.findOneAndUpdate(
    { reservationNumber },
    bumped(trimmed ? { $set: { staffNote: trimmed } } : { $unset: { staffNote: "" } }),
    { returnDocument: "after" },
  ).lean();

  return updated ? toReservationRecord(updated as MongoReservationDocument) : null;
}

export async function setReservationAttendance(
  reservationNumber: string,
  attendance: ReservationAttendance | null,
): Promise<ReservationRecord | null> {
  if (!isMongoConfigured()) {
    return updateLocalReservationAttendance(reservationNumber, attendance);
  }

  await connectToDatabase();
  const updated = await ReservationModel.findOneAndUpdate(
    { reservationNumber },
    bumped(attendance ? { $set: { attendance } } : { $unset: { attendance: "" } }),
    { returnDocument: "after" },
  ).lean();

  return updated ? toReservationRecord(updated as MongoReservationDocument) : null;
}

/**
 * Marks one course served, or not.
 *
 * **One key, never the whole map.** Two waiters marking different courses on
 * the same table at the same moment must both succeed — a read-modify-write
 * would have the later one overwrite the earlier. This is a single conditional
 * update on a single key, the same shape as the seat claims (rule 2.7), so it
 * is idempotent and last-write-wins per course rather than per table.
 */
/**
 * Marks one guest's plate served, or not.
 *
 * **One key per plate.** `service.servedGuests.<courseId>.<guestIndex>` is its
 * own document key, so two waiters marking different guests on the same course
 * both land — the write never reads the map back first. That is the same
 * property the seat claims have (rule 2.7), and it is why the shape is nested
 * maps rather than an array of indices.
 */
export async function setReservationGuestServed(
  reservationNumber: string,
  courseId: string,
  guestIndex: number,
  servedAt: string | null,
): Promise<ReservationRecord | null> {
  if (!isMongoConfigured()) {
    return updateLocalReservationGuestServed(reservationNumber, courseId, guestIndex, servedAt);
  }

  await connectToDatabase();
  const path = `service.servedGuests.${courseId}.${guestIndex}`;
  const updated = await ReservationModel.findOneAndUpdate(
    { reservationNumber },
    bumped(servedAt ? { $set: { [path]: servedAt } } : { $unset: { [path]: "" } }),
    { returnDocument: "after" },
  ).lean();

  return updated ? toReservationRecord(updated as MongoReservationDocument) : null;
}

/**
 * Marks every guest's plate of one course at once — the fast path, for a
 * waiter carrying the whole course out in one trip.
 *
 * Still one update, so it is as atomic as a single-plate mark; the difference
 * is only how many keys it names. The legacy whole-course `servedAt` key is
 * cleared alongside, so a record written by the first version of the board
 * cannot linger and contradict the per-guest detail.
 */
export async function setReservationCourseServedForGuests(
  reservationNumber: string,
  courseId: string,
  guestIndexes: readonly number[],
  servedAt: string | null,
): Promise<ReservationRecord | null> {
  if (!isMongoConfigured()) {
    return updateLocalReservationCourseGuests(reservationNumber, courseId, guestIndexes, servedAt);
  }

  await connectToDatabase();
  const update = servedAt
    ? {
        $set: Object.fromEntries(
          guestIndexes.map((index) => [`service.servedGuests.${courseId}.${index}`, servedAt]),
        ),
        $unset: { [`service.servedAt.${courseId}`]: "" },
      }
    : {
        $unset: {
          ...Object.fromEntries(
            guestIndexes.map((index) => [`service.servedGuests.${courseId}.${index}`, ""]),
          ),
          [`service.servedAt.${courseId}`]: "",
        },
      };

  const updated = await ReservationModel.findOneAndUpdate({ reservationNumber }, bumped(update), {
    returnDocument: "after",
  }).lean();

  return updated ? toReservationRecord(updated as MongoReservationDocument) : null;
}

export async function setReservationCourseServed(
  reservationNumber: string,
  courseId: string,
  servedAt: string | null,
): Promise<ReservationRecord | null> {
  if (!isMongoConfigured()) {
    return updateLocalReservationCourseServed(reservationNumber, courseId, servedAt);
  }

  await connectToDatabase();
  // The dotted path is the point: it touches this course and nothing else.
  const path = `service.servedAt.${courseId}`;
  const updated = await ReservationModel.findOneAndUpdate(
    { reservationNumber },
    bumped(servedAt ? { $set: { [path]: servedAt } } : { $unset: { [path]: "" } }),
    { returnDocument: "after" },
  ).lean();

  return updated ? toReservationRecord(updated as MongoReservationDocument) : null;
}

/**
 * Removes a booking outright. Seats are released only when it was still
 * confirmed, since a cancelled booking already gave them back.
 *
 * **The table comes back too**, and unconditionally. Deleting used to give back
 * the seats and keep the table, which left a claim nobody could ever reach: the
 * booking that held it no longer existed, so the table read busy for the rest
 * of the evening with nobody sitting there and nothing on any screen to explain
 * it. Cancelling had always released both (`releaseClaimedTable`); deleting
 * simply never called it.
 *
 * Not guarded by the status the way the seats are, because releasing is
 * idempotent by filter — the claim must still name this booking for the update
 * to match — so a booking that was cancelled first releases nothing here rather
 * than releasing twice.
 */
export async function deleteReservation(reservationNumber: string): Promise<ReservationRecord | null> {
  if (!isMongoConfigured()) {
    const removed = await deleteLocalReservation(reservationNumber);

    if (removed) {
      await releaseClaimedTable(removed as ReservationRecord);
    }

    return removed;
  }

  await connectToDatabase();
  const removed = await ReservationModel.findOneAndDelete({ reservationNumber }).lean();
  if (!removed) {
    return null;
  }

  const record = toReservationRecord(removed as MongoReservationDocument);

  if (record.status === "confirmed") {
    await RestaurantDateModel.updateOne({ date: record.date }, { $inc: { reservedSeats: -record.guestCount } });
  }

  await releaseClaimedTable(record);

  return record;
}

export async function getReservationsList(): Promise<ReservationRecord[]> {
  if (!isMongoConfigured()) {
    return listLocalReservations();
  }

  await connectToDatabase();
  const reservations = await ReservationModel.find().sort({ createdAt: -1 }).lean();
  return reservations.map((reservation) => toReservationRecord(reservation as MongoReservationDocument));
}

/**
 * Every reservation for a single evening, newest-first.
 *
 * `date` is indexed, so this is a range walk rather than the full-collection
 * scan `getReservationsList` does. The service board needs exactly one evening
 * and is re-read on a poll — see docs/performance.md §3.1.
 */
export async function getReservationsByDate(date: string): Promise<ReservationRecord[]> {
  if (!isMongoConfigured()) {
    return listLocalReservationsByDate(date);
  }

  await connectToDatabase();
  const reservations = await ReservationModel.find({ date }).sort({ createdAt: -1 }).lean();
  return reservations.map((reservation) => toReservationRecord(reservation as MongoReservationDocument));
}

/**
 * Reservations whose evening falls in `[fromKey, toKey]` inclusive, newest-first.
 *
 * `date` keys are `YYYY-MM-DD`, so a string range is a chronological range and
 * the `date` index carries it. Analytics folds a window on read; it should fold
 * this month, not everything since the restaurant opened — docs/performance.md
 * §3.1 and docs/analytics.md §5.4.
 */
export async function getReservationsBetween(fromKey: string, toKey: string): Promise<ReservationRecord[]> {
  if (!isMongoConfigured()) {
    return listLocalReservationsBetween(fromKey, toKey);
  }

  await connectToDatabase();
  const reservations = await ReservationModel.find({ date: { $gte: fromKey, $lte: toKey } })
    .sort({ createdAt: -1 })
    .lean();
  return reservations.map((reservation) => toReservationRecord(reservation as MongoReservationDocument));
}

/**
 * The two figures on the dashboard, counted in the database.
 *
 * These were folded in JavaScript from every reservation ever taken, which is
 * why the dashboard had to load the lot. Both are answered off the `date`
 * index instead — see docs/performance.md §3.1.
 *
 * `status` is matched as *not cancelled* rather than equal to `confirmed`,
 * because it is one of the optional fields of HANDOVER §2.2: bookings taken
 * before it existed have no `status` at all, and `toReservationRecord` reads
 * their absence as confirmed. Asking for `confirmed` would quietly drop them.
 */
export async function getDashboardCounts(today: string): Promise<{
  guestsTonight: number;
  upcomingReservations: number;
}> {
  if (!isMongoConfigured()) {
    const live = (await listLocalReservations()).filter((entry) => entry.status !== "cancelled");

    return {
      guestsTonight: live
        .filter((entry) => entry.date === today)
        .reduce((total, entry) => total + entry.guestCount, 0),
      upcomingReservations: live.filter((entry) => entry.date >= today).length,
    };
  }

  await connectToDatabase();

  const [tonight, upcoming] = await Promise.all([
    ReservationModel.aggregate<{ guests: number }>([
      { $match: { date: today, status: { $ne: "cancelled" } } },
      { $group: { _id: null, guests: { $sum: "$guestCount" } } },
    ]),
    ReservationModel.countDocuments({ date: { $gte: today }, status: { $ne: "cancelled" } }),
  ]);

  return {
    guestsTonight: tonight[0]?.guests ?? 0,
    upcomingReservations: upcoming,
  };
}

export async function updateRestaurantDate(input: {
  date: string;
  isOpen: boolean;
  capacity: number;
  serviceTime?: string;
  serviceEndTime?: string;
  premium?: boolean;
  /** How many hours before the sitting guest bookings close. 0 = at the sitting. */
  bookingCutoffHours?: number;
  tableCutoffHours?: number;
  /**
   * What this evening switches on for itself.
   *
   * Three-way, like the switches inside it: **absent leaves what the evening
   * already said**, null clears it back to following the restaurant, and an
   * object replaces it. A caller that knows nothing about overrides therefore
   * cannot wipe them by omission — which is the failure
   * `toRestaurantDatePayload` exists to prevent one layer up, and is worth
   * defending twice.
   */
  features?: EveningOverrides | null;
}) {
  if (!isMongoConfigured()) {
    return upsertLocalDate(input);
  }

  await connectToDatabase();

  const updated = await RestaurantDateModel.findOneAndUpdate(
    { date: input.date },
    {
      $set: {
        isOpen: input.isOpen,
        capacity: input.capacity,
        serviceTime: input.serviceTime ?? null,
        serviceEndTime: input.serviceEndTime ?? null,
        premium: input.premium ?? false,
        bookingCutoffHours: Math.max(0, Math.round(Number(input.bookingCutoffHours ?? 0))),
        tableCutoffHours: Math.max(0, Math.round(Number(input.tableCutoffHours ?? 0))),
        // Only written when the caller said something about it, so omitting it
        // leaves the evening as it was rather than clearing it.
        ...(input.features === undefined ? {} : { features: toEveningOverrides(input.features) ?? null }),
      },
      $setOnInsert: { reservedSeats: 0 },
    },
    { returnDocument: "after", upsert: true },
  ).lean();

  return withRemainingSeats({
    date: String(updated.date),
    isOpen: Boolean(updated.isOpen),
    capacity: Number(updated.capacity),
    reservedSeats: Number(updated.reservedSeats),
    serviceTime: updated.serviceTime ? String(updated.serviceTime) : undefined,
    serviceEndTime: updated.serviceEndTime ? String(updated.serviceEndTime) : undefined,
    premium: Boolean(updated.premium),
    bookingCutoffHours: Number(updated.bookingCutoffHours ?? 0),
    tableCutoffHours: Number(updated.tableCutoffHours ?? 0),
    features: toEveningOverrides(updated.features),
  });
}
