import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import mongoose from "mongoose";

/**
 * Seating two bookings together *after* they were taken.
 *
 * Guests regularly fail to pair themselves when booking, so reception has to be
 * able to do it afterwards — and until now could not: the join existed only on
 * the create path, and the editor could offer `additionalRooms`, which is a
 * different thing. Extra rooms are more rooms on one ticket, sharing one line
 * of dish counts. A join links two bookings that each ordered for themselves,
 * and the point of it is that *both* orders reach the kitchen.
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
  return import("@/lib/services/reservations");
}

const SELECTIONS = [
  { guestIndex: 0, courseId: "c1", courseName: "Starter", optionId: "o1", optionName: "Salmon" },
];

async function book(date: string, roomNumber: string) {
  const reservations = await loadServices();
  await reservations.updateRestaurantDate({ date, isOpen: true, capacity: 40 });
  return reservations.createReservationEntry({
    roomNumber,
    guestCount: 1,
    date,
    selections: SELECTIONS,
  });
}

describe("seating one booking with another", () => {
  it("puts both on the same table, anchored on the one they joined", async () => {
    const reservations = await loadServices();
    const anchor = await book("2026-09-10", "401");
    const joiner = await book("2026-09-10", "402");

    const updated = await reservations.updateReservationDetails(joiner.reservationNumber, {
      joinReservationNumber: anchor.reservationNumber,
    });

    expect(updated?.tableGroupId).toBe(anchor.reservationNumber);

    // The booking that was joined is now on the table too, not merely named by it.
    const anchorAfter = await reservations.getReservationByNumber(anchor.reservationNumber);
    expect(anchorAfter?.tableGroupId).toBe(anchor.reservationNumber);
  });

  it("keeps each booking's own dishes, which is the whole point", async () => {
    const reservations = await loadServices();
    const anchor = await book("2026-09-10", "401");
    const joiner = await book("2026-09-10", "402");

    await reservations.updateReservationDetails(joiner.reservationNumber, {
      joinReservationNumber: anchor.reservationNumber,
    });

    const evening = await reservations.getReservationsByDate("2026-09-10");
    const table = evening.filter((entry) => entry.tableGroupId === anchor.reservationNumber);

    expect(table).toHaveLength(2);
    // Two separate bookings, each with its own order — not one merged ticket.
    expect(table.every((entry) => entry.selections.length === 1)).toBe(true);
    expect(table.map((entry) => entry.roomNumber).sort()).toEqual(["401", "402"]);
  });

  it("accepts a number typed in lower case", async () => {
    const reservations = await loadServices();
    const anchor = await book("2026-09-10", "401");
    const joiner = await book("2026-09-10", "402");

    const updated = await reservations.updateReservationDetails(joiner.reservationNumber, {
      joinReservationNumber: anchor.reservationNumber.toLowerCase(),
    });

    expect(updated?.tableGroupId).toBe(anchor.reservationNumber);
  });

  it("adds a third booking to a table that already exists", async () => {
    const reservations = await loadServices();
    const anchor = await book("2026-09-10", "401");
    const second = await book("2026-09-10", "402");
    const third = await book("2026-09-10", "403");

    await reservations.updateReservationDetails(second.reservationNumber, {
      joinReservationNumber: anchor.reservationNumber,
    });

    // Naming the *member* rather than the anchor still lands on the same table.
    const updated = await reservations.updateReservationDetails(third.reservationNumber, {
      joinReservationNumber: second.reservationNumber,
    });

    expect(updated?.tableGroupId).toBe(anchor.reservationNumber);
  });

  it("takes a booking off the table when the number is cleared", async () => {
    const reservations = await loadServices();
    const anchor = await book("2026-09-10", "401");
    const joiner = await book("2026-09-10", "402");

    await reservations.updateReservationDetails(joiner.reservationNumber, {
      joinReservationNumber: anchor.reservationNumber,
    });

    const updated = await reservations.updateReservationDetails(joiner.reservationNumber, {
      joinReservationNumber: "",
    });

    expect(updated?.tableGroupId).toBeUndefined();
  });

  it("leaves the table alone when the field is not sent at all", async () => {
    const reservations = await loadServices();
    const anchor = await book("2026-09-10", "401");
    const joiner = await book("2026-09-10", "402");

    await reservations.updateReservationDetails(joiner.reservationNumber, {
      joinReservationNumber: anchor.reservationNumber,
    });

    // An ordinary edit of something else must not disturb the seating.
    const updated = await reservations.updateReservationDetails(joiner.reservationNumber, {
      notes: "By the window",
    });

    expect(updated?.tableGroupId).toBe(anchor.reservationNumber);
  });
});

describe("what a join refuses", () => {
  it("refuses a reservation number that does not exist", async () => {
    const reservations = await loadServices();
    const joiner = await book("2026-09-10", "402");

    await expect(
      reservations.updateReservationDetails(joiner.reservationNumber, {
        joinReservationNumber: "VDM-NOPE99",
      }),
    ).rejects.toThrow(reservations.TableJoinError);
  });

  it("refuses a booking on another evening", async () => {
    const reservations = await loadServices();
    const other = await book("2026-09-11", "401");
    const joiner = await book("2026-09-10", "402");

    await expect(
      reservations.updateReservationDetails(joiner.reservationNumber, {
        joinReservationNumber: other.reservationNumber,
      }),
    ).rejects.toThrow(/different evening/i);
  });

  it("refuses a cancelled booking", async () => {
    const reservations = await loadServices();
    const anchor = await book("2026-09-10", "401");
    const joiner = await book("2026-09-10", "402");
    await reservations.cancelReservation(anchor.reservationNumber);

    await expect(
      reservations.updateReservationDetails(joiner.reservationNumber, {
        joinReservationNumber: anchor.reservationNumber,
      }),
    ).rejects.toThrow(/cancelled/i);
  });

  it("refuses seating a booking with itself", async () => {
    const reservations = await loadServices();
    const joiner = await book("2026-09-10", "402");

    await expect(
      reservations.updateReservationDetails(joiner.reservationNumber, {
        joinReservationNumber: joiner.reservationNumber,
      }),
    ).rejects.toThrow(/itself/i);
  });

  /**
   * The join is judged against the evening the booking is *moving to*. Both
   * changes arrive in one edit, and checking the old date would refuse a
   * perfectly good pairing — or worse, allow one across two evenings.
   */
  it("judges the join against the new evening when the date moves too", async () => {
    const reservations = await loadServices();
    const anchor = await book("2026-09-11", "401");
    const joiner = await book("2026-09-10", "402");

    const updated = await reservations.updateReservationDetails(joiner.reservationNumber, {
      date: "2026-09-11",
      joinReservationNumber: anchor.reservationNumber,
    });

    expect(updated?.date).toBe("2026-09-11");
    expect(updated?.tableGroupId).toBe(anchor.reservationNumber);
  });

  /**
   * A refused join must not leave the evening's seat count changed. The group
   * is resolved before any seats are claimed precisely so this holds.
   */
  it("does not move any seats when the join is refused", async () => {
    const reservations = await loadServices();
    const restaurant = await import("@/lib/services/restaurant");
    await book("2026-09-10", "401");
    const joiner = await book("2026-09-10", "402");

    const before = await restaurant.getRestaurantDate("2026-09-10");

    await expect(
      reservations.updateReservationDetails(joiner.reservationNumber, {
        guestCount: 4,
        joinReservationNumber: "VDM-NOPE99",
      }),
    ).rejects.toThrow(reservations.TableJoinError);

    const after = await restaurant.getRestaurantDate("2026-09-10");
    expect(after?.reservedSeats).toBe(before?.reservedSeats);
  });
});
