import { randomBytes } from "crypto";
import { isMongoConfigured, connectToDatabase } from "@/lib/db/connect";
import { ReservationModel } from "@/lib/models/reservation";
import { RestaurantDateModel } from "@/lib/models/restaurant-date";
import {
  cancelLocalReservation,
  createLocalReservation,
  getLocalReservation,
  listLocalReservations,
  reservationNumberExists,
  deleteLocalReservation,
  setLocalReservationGroup,
  setLocalReservationTable,
  updateLocalReservationSelections,
  upsertLocalDate,
} from "@/lib/db/local-store";
import { getRestaurantDate } from "@/lib/services/restaurant";
import {
  withRemainingSeats,
  type ReservationContact,
  type ReservationRecord,
  type ReservationSelection,
} from "@/types/booking";

export class BookingError extends Error {
  constructor(public readonly code: "DATE_CLOSED" | "DATE_FULL") {
    super(code);
    this.name = "BookingError";
  }
}

export function generateReservationNumber() {
  return `ALC-${randomBytes(3).toString("hex").toUpperCase()}`;
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
  return `ALC-${randomBytes(5).toString("hex").toUpperCase()}`;
}

type MongoReservationDocument = {
  _id: unknown;
  reservationNumber: unknown;
  roomNumber: unknown;
  guestCount: unknown;
  date: unknown;
  selections?: unknown;
  contact?: unknown;
  time?: unknown;
  endTime?: unknown;
  notes?: unknown;
  tableGroupId?: unknown;
  tableNumber?: unknown;
  status?: unknown;
  createdAt?: unknown;
  updatedAt?: unknown;
};

function toReservationRecord(document: MongoReservationDocument): ReservationRecord {
  return {
    _id: String(document._id),
    reservationNumber: String(document.reservationNumber),
    roomNumber: Number(document.roomNumber),
    guestCount: Number(document.guestCount),
    date: String(document.date),
    selections: Array.isArray(document.selections) ? (document.selections as ReservationSelection[]) : [],
    contact: (document.contact as ReservationContact | undefined) ?? undefined,
    time: document.time ? String(document.time) : undefined,
    endTime: document.endTime ? String(document.endTime) : undefined,
    notes: document.notes ? String(document.notes) : undefined,
    tableGroupId: document.tableGroupId ? String(document.tableGroupId) : undefined,
    tableNumber: document.tableNumber ? String(document.tableNumber) : undefined,
    status: document.status === "cancelled" ? "cancelled" : "confirmed",
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
  roomNumber: number;
  guestCount: number;
  date: string;
  selections: ReservationSelection[];
  contact?: ReservationContact;
  notes?: string;
  /** Reservation number of a party this booking should share a table with. */
  joinReservationNumber?: string;
}): Promise<ReservationRecord> {
  const tableGroupId = await resolveTableGroup(input.joinReservationNumber, input.date);

  if (!isMongoConfigured()) {
    const reservationNumber = await allocateReservationNumber(reservationNumberExists);
    const result = await createLocalReservation({ reservationNumber, ...input, tableGroupId });

    if (!result.ok) {
      throw new BookingError(result.reason);
    }

    return result.reservation;
  }

  await connectToDatabase();

  const reservationNumber = await allocateReservationNumber(
    async (candidate) => Boolean(await ReservationModel.exists({ reservationNumber: candidate })),
  );

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
      guestCount: input.guestCount,
      date: input.date,
      selections: input.selections,
      contact: input.contact,
      // Copied from the date so the booking keeps the times it was made for.
      time: bookedDate?.serviceTime,
      endTime: bookedDate?.serviceEndTime,
      notes: input.notes,
      tableGroupId,
      status: "confirmed",
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
 */
export async function cancelReservation(reservationNumber: string): Promise<ReservationRecord | null> {
  if (!isMongoConfigured()) {
    return cancelLocalReservation(reservationNumber);
  }

  await connectToDatabase();

  const cancelled = await ReservationModel.findOneAndUpdate(
    { reservationNumber, status: "confirmed" },
    { status: "cancelled" },
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

export async function updateRestaurantDate(input: {
  date: string;
  isOpen: boolean;
  capacity: number;
  serviceTime?: string;
  serviceEndTime?: string;
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
  });
}
