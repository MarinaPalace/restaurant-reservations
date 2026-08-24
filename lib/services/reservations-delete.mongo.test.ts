import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import mongoose from "mongoose";

/**
 * Deleting a booking, against a real MongoDB.
 *
 * Cancelling had always handed back both claims — the seats and the table.
 * Deleting handed back only the seats, and the table it kept could never be
 * reached again: the booking that held it was gone, so nothing on any screen
 * could explain why the table read busy for the rest of the evening. Staff
 * deleting a test booking is exactly how it was found.
 */

let mongod: MongoMemoryServer;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongod.getUri();
}, 120_000);

afterAll(async () => {
  await mongoose.disconnect();
  await mongod?.stop();
  delete process.env.MONGODB_URI;
});

afterEach(async () => {
  const { collections } = mongoose.connection;
  for (const collection of Object.values(collections)) {
    await collection.deleteMany({});
  }
});

async function loadServices() {
  return {
    reservations: await import("@/lib/services/reservations"),
    claims: await import("@/lib/services/table-claims"),
  };
}

async function openDate(date: string, capacity: number) {
  const { reservations } = await loadServices();
  await reservations.updateRestaurantDate({ date, isOpen: true, capacity });
}

describe("deleting a booking that held a table", () => {
  it("gives a single table back", async () => {
    const { reservations, claims } = await loadServices();
    await openDate("2026-11-01", 20);

    const created = await reservations.createReservationEntry({
      roomNumber: "402",
      guestCount: 2,
      date: "2026-11-01",
      guestName: "Petrov",
      selections: [],
      tables: [{ id: "f-aaaaaaaa", label: "7", seats: 4 }],
    });

    expect(await claims.listTableClaims("2026-11-01")).toHaveLength(1);

    await reservations.deleteReservation(created.reservationNumber);

    expect(await claims.listTableClaims("2026-11-01")).toEqual([]);
  });

  it("gives every table of a merged holding back", async () => {
    const { reservations, claims } = await loadServices();
    await openDate("2026-11-02", 20);

    const created = await reservations.createReservationEntry({
      roomNumber: "402",
      guestCount: 6,
      date: "2026-11-02",
      guestName: "Petrov",
      selections: [],
      tables: [
        { id: "f-aaaaaaaa", label: "1", seats: 2 },
        { id: "f-bbbbbbbb", label: "2", seats: 2 },
        { id: "f-cccccccc", label: "3", seats: 2 },
      ],
    });

    expect(created.tableNumber).toBe("1 + 2 + 3");
    expect(await claims.listTableClaims("2026-11-02")).toHaveLength(3);

    await reservations.deleteReservation(created.reservationNumber);

    expect(await claims.listTableClaims("2026-11-02")).toEqual([]);
  });

  it("releases nothing twice when the booking was cancelled first", async () => {
    // Cancelling already gave the table back, and releasing is idempotent by
    // filter — so deleting afterwards must not decrement a claim somebody else
    // has since opened on the same table.
    const { reservations, claims } = await loadServices();
    await openDate("2026-11-03", 20);

    const mine = await reservations.createReservationEntry({
      roomNumber: "402",
      guestCount: 2,
      date: "2026-11-03",
      guestName: "Petrov",
      selections: [],
      tables: [{ id: "f-aaaaaaaa", label: "7", seats: 4 }],
    });

    await reservations.cancelReservation(mine.reservationNumber);

    const theirs = await reservations.createReservationEntry({
      roomNumber: "118",
      guestCount: 3,
      date: "2026-11-03",
      guestName: "Ivanova",
      selections: [],
      tables: [{ id: "f-aaaaaaaa", label: "7", seats: 4 }],
    });

    await reservations.deleteReservation(mine.reservationNumber);

    const [claim] = await claims.listTableClaims("2026-11-03");

    expect(claim?.guests).toBe(3);
    expect(claim?.reservationNumbers).toEqual([theirs.reservationNumber]);
  });
});
