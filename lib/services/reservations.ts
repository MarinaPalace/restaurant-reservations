import { randomBytes } from "crypto";
import { RESERVATION_PREFIX } from "@/lib/brand";
import { isMongoConfigured, connectToDatabase } from "@/lib/db/connect";
import { ReservationModel } from "@/lib/models/reservation";
import { RestaurantDateModel } from "@/lib/models/restaurant-date";
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
  updateLocalReservationSelections,
  updateLocalReservationAddOns,
  updateLocalReservationAttendance,
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
  tableGroupId?: unknown;
  tableNumber?: unknown;
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
    tableGroupId: document.tableGroupId ? String(document.tableGroupId) : undefined,
    tableNumber: document.tableNumber ? String(document.tableNumber) : undefined,
    status: document.status === "cancelled" ? "cancelled" : "confirmed",
    passKeyId: document.passKeyId ? String(document.passKeyId) : undefined,
    cancellation: (document.cancellation as CancellationRecord | undefined) ?? undefined,
    createdAt: document.createdAt ? new Date(document.createdAt as string).toISOString() : undefined,
    updatedAt: document.updatedAt ? new Date(document.updatedAt as string).toISOString() : undefined,
  };
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
  await ReservationModel.updateOne({ reservationNumber }, { $set: { tableGroupId } });
}

/** Sets a table number across everyone sharing that table. */
export async function assignTableNumber(reservationNumber: string, tableNumber: string) {
  if (!isMongoConfigured()) {
    return setLocalReservationTable(reservationNumber, tableNumber);
  }

  await connectToDatabase();
  const target = await ReservationModel.findOne({ reservationNumber }).lean();
  if (!target) {
    return null;
  }

  const filter = target.tableGroupId ? { tableGroupId: target.tableGroupId } : { reservationNumber };
  await ReservationModel.updateMany(filter, { $set: { tableNumber } });

  const updated = await ReservationModel.find(filter).lean();
  return updated.map((entry) => toReservationRecord(entry as MongoReservationDocument));
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
      tableNumber: input.tableNumber,
      tableGroupId,
      status: "confirmed",
      passKeyId: input.passKeyId,
    });

    return toReservationRecord(created.toObject() as MongoReservationDocument);
  } catch (error) {
    // Give the seats back if the reservation itself could not be written.
    await RestaurantDateModel.updateOne({ date: input.date }, { $inc: { reservedSeats: -input.guestCount } });
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
    { $set: { status: "cancelled", ...(cancellation ? { cancellation } : {}) } },
    { returnDocument: "after" },
  ).lean();

  if (!cancelled) {
    const existing = await ReservationModel.findOne({ reservationNumber }).lean();
    return existing ? toReservationRecord(existing as MongoReservationDocument) : null;
  }

  const record = toReservationRecord(cancelled as MongoReservationDocument);
  await RestaurantDateModel.updateOne({ date: record.date }, { $inc: { reservedSeats: -record.guestCount } });

  return record;
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

  try {
    /**
     * The status filter makes this safe against two restores at once: the
     * second finds nothing to update and gives its seats back below.
     */
    const restored = await ReservationModel.findOneAndUpdate(
      { reservationNumber, status: "cancelled" },
      // The cancellation snapshot goes with the cancellation it described.
      // The audit log keeps both the cancellation and this restore.
      { $set: { status: "confirmed" }, $unset: { cancellation: "" } },
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
  if (!isMongoConfigured()) {
    const result = await updateLocalReservationDetails(reservationNumber, patch);

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
  if (patch.tableNumber !== undefined) update.tableNumber = patch.tableNumber;

  if (dateChanged) {
    // Moving evenings adopts that evening's sitting times.
    update.time = targetDate?.serviceTime ?? null;
    update.endTime = targetDate?.serviceEndTime ?? null;
  }

  try {
    const saved = await ReservationModel.findOneAndUpdate(
      { reservationNumber },
      { $set: update },
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
    { $set: { selections } },
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
    { $set: { addOns } },
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
    attendance ? { $set: { attendance } } : { $unset: { attendance: "" } },
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
    servedAt ? { $set: { [path]: servedAt } } : { $unset: { [path]: "" } },
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

  const updated = await ReservationModel.findOneAndUpdate({ reservationNumber }, update, {
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
    servedAt ? { $set: { [path]: servedAt } } : { $unset: { [path]: "" } },
    { returnDocument: "after" },
  ).lean();

  return updated ? toReservationRecord(updated as MongoReservationDocument) : null;
}

/**
 * Removes a booking outright. Seats are released only when it was still
 * confirmed, since a cancelled booking already gave them back.
 */
export async function deleteReservation(reservationNumber: string): Promise<ReservationRecord | null> {
  if (!isMongoConfigured()) {
    return deleteLocalReservation(reservationNumber);
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
  });
}
