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
  upsertLocalDate,
} from "@/lib/db/local-store";
import { withRemainingSeats, type ReservationRecord, type ReservationSelection } from "@/types/booking";

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
    status: document.status === "cancelled" ? "cancelled" : "confirmed",
    createdAt: document.createdAt ? new Date(document.createdAt as string).toISOString() : undefined,
    updatedAt: document.updatedAt ? new Date(document.updatedAt as string).toISOString() : undefined,
  };
}

export async function createReservationEntry(input: {
  roomNumber: number;
  guestCount: number;
  date: string;
  selections: ReservationSelection[];
}): Promise<ReservationRecord> {
  if (!isMongoConfigured()) {
    const reservationNumber = await allocateReservationNumber(reservationNumberExists);
    const result = await createLocalReservation({ reservationNumber, ...input });

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
    { new: true },
  ).lean();

  if (!claimedDate) {
    const existing = await RestaurantDateModel.findOne({ date: input.date }).lean();
    throw new BookingError(!existing || !existing.isOpen ? "DATE_CLOSED" : "DATE_FULL");
  }

  try {
    const created = await ReservationModel.create({
      reservationNumber,
      roomNumber: input.roomNumber,
      guestCount: input.guestCount,
      date: input.date,
      selections: input.selections,
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
    { new: true },
  ).lean();

  if (!cancelled) {
    const existing = await ReservationModel.findOne({ reservationNumber }).lean();
    return existing ? toReservationRecord(existing as MongoReservationDocument) : null;
  }

  const record = toReservationRecord(cancelled as MongoReservationDocument);
  await RestaurantDateModel.updateOne({ date: record.date }, { $inc: { reservedSeats: -record.guestCount } });

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

export async function updateRestaurantDate(input: { date: string; isOpen: boolean; capacity: number }) {
  if (!isMongoConfigured()) {
    return upsertLocalDate(input);
  }

  await connectToDatabase();

  const updated = await RestaurantDateModel.findOneAndUpdate(
    { date: input.date },
    { $set: { isOpen: input.isOpen, capacity: input.capacity }, $setOnInsert: { reservedSeats: 0 } },
    { new: true, upsert: true },
  ).lean();

  return withRemainingSeats({
    date: String(updated.date),
    isOpen: Boolean(updated.isOpen),
    capacity: Number(updated.capacity),
    reservedSeats: Number(updated.reservedSeats),
  });
}
