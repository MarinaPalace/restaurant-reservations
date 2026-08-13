import { randomBytes } from "crypto";
import { isMongoConfigured, connectToDatabase } from "@/lib/db/connect";
import { ReservationModel } from "@/lib/models/reservation";
import { RestaurantDateModel } from "@/lib/models/restaurant-date";
import {
  getMockRestaurantDate,
  getMockReservation,
  getMockReservationList,
  addMockReservation,
  updateMockReservation,
  upsertMockRestaurantDate,
} from "@/lib/db/mock-store";
import type { ReservationRecord, ReservationSelection } from "@/types/booking";

export function generateReservationNumber() {
  const suffix = randomBytes(3).toString("hex").toUpperCase();
  return `ALC-${suffix}`;
}

export async function createReservationEntry(input: {
  roomNumber: number;
  guestCount: number;
  date: string;
  selections: ReservationSelection[];
}) {
  const reservationNumber = generateReservationNumber();

  if (!isMongoConfigured()) {
    const restaurantDate = getMockRestaurantDate(input.date);
    if (!restaurantDate || !restaurantDate.isOpen) {
      throw new Error("DATE_CLOSED");
    }
    if (restaurantDate.remainingSeats < input.guestCount) {
      throw new Error("DATE_FULL");
    }

    const record: ReservationRecord = {
      reservationNumber,
      roomNumber: input.roomNumber,
      guestCount: input.guestCount,
      date: input.date,
      selections: input.selections,
      status: "confirmed",
    };

    addMockReservation(record);
    return record;
  }

  await connectToDatabase();

  const session = await (await import("mongoose")).default.startSession();
  let result: ReservationRecord | null = null;

  try {
    await session.withTransaction(async () => {
      const restaurantDate = await RestaurantDateModel.findOne({ date: input.date }).session(session).lean();
      if (!restaurantDate || !restaurantDate.isOpen) {
        throw new Error("DATE_CLOSED");
      }

      const remainingSeats = Math.max(restaurantDate.capacity - restaurantDate.reservedSeats, 0);
      if (remainingSeats < input.guestCount) {
        throw new Error("DATE_FULL");
      }

      const reservationRecord = await ReservationModel.create([
        {
          reservationNumber,
          roomNumber: input.roomNumber,
          guestCount: input.guestCount,
          date: input.date,
          selections: input.selections,
          status: "confirmed",
        },
      ], { session });

      await RestaurantDateModel.updateOne(
        { date: input.date },
        { $inc: { reservedSeats: input.guestCount } },
        { session },
      );

      result = {
        reservationNumber,
        roomNumber: input.roomNumber,
        guestCount: input.guestCount,
        date: input.date,
        selections: input.selections,
        status: "confirmed",
      };

      if (reservationRecord[0]) {
        result = {
          ...result,
          _id: String(reservationRecord[0]._id),
        };
      }
    });
  } finally {
    await session.endSession();
  }

  return result;
}

export async function getReservationByNumber(reservationNumber: string) {
  if (!isMongoConfigured()) {
    return getMockReservation(reservationNumber);
  }

  await connectToDatabase();
  const reservation = await ReservationModel.findOne({ reservationNumber }).lean();
  if (!reservation) {
    return null;
  }

  return {
    _id: String(reservation._id),
    reservationNumber: String(reservation.reservationNumber),
    roomNumber: Number(reservation.roomNumber),
    guestCount: Number(reservation.guestCount),
    date: String(reservation.date),
    selections: Array.isArray(reservation.selections) ? reservation.selections : [],
    status: String(reservation.status),
    createdAt: reservation.createdAt ? new Date(reservation.createdAt).toISOString() : undefined,
    updatedAt: reservation.updatedAt ? new Date(reservation.updatedAt).toISOString() : undefined,
  };
}

export async function cancelReservation(reservationNumber: string) {
  if (!isMongoConfigured()) {
    const reservation = getMockReservation(reservationNumber);
    if (!reservation) return null;
    const updated = updateMockReservation(reservationNumber, { status: "cancelled" });
    return updated;
  }

  await connectToDatabase();
  const reservation = await ReservationModel.findOne({ reservationNumber }).lean();
  if (!reservation) return null;

  await ReservationModel.updateOne({ reservationNumber }, { status: "cancelled" });
  await RestaurantDateModel.updateOne(
    { date: reservation.date },
    { $inc: { reservedSeats: -Number(reservation.guestCount) } },
  );

  return {
    ...reservation,
    status: "cancelled",
  };
}

export async function getReservationsList() {
  if (!isMongoConfigured()) {
    return getMockReservationList();
  }

  await connectToDatabase();
  const reservations = await ReservationModel.find().sort({ createdAt: -1 }).lean();
  return reservations.map((reservation) => ({
    _id: String(reservation._id),
    reservationNumber: String(reservation.reservationNumber),
    roomNumber: Number(reservation.roomNumber),
    guestCount: Number(reservation.guestCount),
    date: String(reservation.date),
    selections: Array.isArray(reservation.selections) ? reservation.selections : [],
    status: String(reservation.status),
    createdAt: reservation.createdAt ? new Date(reservation.createdAt).toISOString() : undefined,
    updatedAt: reservation.updatedAt ? new Date(reservation.updatedAt).toISOString() : undefined,
  }));
}

export async function updateRestaurantDate(input: {
  date: string;
  isOpen: boolean;
  capacity: number;
}) {
  if (!isMongoConfigured()) {
    return upsertMockRestaurantDate({
      date: input.date,
      isOpen: input.isOpen,
      capacity: input.capacity,
      reservedSeats: getMockRestaurantDate(input.date)?.reservedSeats ?? 0,
      remainingSeats: Math.max(input.capacity - (getMockRestaurantDate(input.date)?.reservedSeats ?? 0), 0),
    });
  }

  await connectToDatabase();
  const existing = await RestaurantDateModel.findOne({ date: input.date });
  if (!existing) {
    const created = await RestaurantDateModel.create({
      date: input.date,
      isOpen: input.isOpen,
      capacity: input.capacity,
      reservedSeats: 0,
    });
    return {
      date: String(created.date),
      isOpen: Boolean(created.isOpen),
      capacity: Number(created.capacity),
      reservedSeats: Number(created.reservedSeats),
      remainingSeats: Math.max(Number(created.capacity) - Number(created.reservedSeats), 0),
    };
  }

  existing.isOpen = input.isOpen;
  existing.capacity = input.capacity;
  await existing.save();

  return {
    date: String(existing.date),
    isOpen: Boolean(existing.isOpen),
    capacity: Number(existing.capacity),
    reservedSeats: Number(existing.reservedSeats),
    remainingSeats: Math.max(Number(existing.capacity) - Number(existing.reservedSeats), 0),
  };
}
