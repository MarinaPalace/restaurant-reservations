import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import mongoose from "mongoose";

/**
 * The narrowed reads behind the service board and analytics.
 *
 * Both pages used to load every reservation ever taken and throw away all but
 * one evening (the board) or one month (analytics) in JavaScript — see
 * docs/performance.md §3.1. Narrowing that to a `date` query is only safe if it
 * selects *exactly* the same rows the JavaScript filter did, so that is what
 * these check: the boundaries are inclusive, neighbouring evenings are not
 * dragged in, and the newest-first order the lists rely on still holds.
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
    restaurant: await import("@/lib/services/restaurant"),
  };
}

const SELECTIONS = [
  { guestIndex: 0, courseId: "c1", courseName: "Starter", optionId: "o1", optionName: "Salmon" },
];

/** Books one room on `date`, opening the evening first if it is not already. */
async function book(date: string, roomNumber: string) {
  const { reservations } = await loadServices();
  await reservations.updateRestaurantDate({ date, isOpen: true, capacity: 40 });
  return reservations.createReservationEntry({
    roomNumber,
    guestCount: 1,
    date,
    selections: SELECTIONS,
  });
}

describe("getReservationsByDate", () => {
  it("returns one evening and not the ones either side of it", async () => {
    const { reservations } = await loadServices();

    await book("2026-09-09", "401");
    await book("2026-09-10", "402");
    await book("2026-09-10", "403");
    await book("2026-09-11", "404");

    const evening = await reservations.getReservationsByDate("2026-09-10");

    expect(evening.map((entry) => entry.roomNumber).sort()).toEqual(["402", "403"]);
    expect(evening.every((entry) => entry.date === "2026-09-10")).toBe(true);
  });

  it("agrees with filtering the full list, which is what it replaced", async () => {
    const { reservations } = await loadServices();

    await book("2026-09-09", "401");
    await book("2026-09-10", "402");
    await book("2026-09-11", "403");

    const everything = await reservations.getReservationsList();
    const filtered = everything.filter((entry) => entry.date === "2026-09-10");
    const queried = await reservations.getReservationsByDate("2026-09-10");

    expect(queried.map((entry) => entry.reservationNumber)).toEqual(
      filtered.map((entry) => entry.reservationNumber),
    );
  });

  it("returns nothing for an evening with no bookings", async () => {
    const { reservations } = await loadServices();
    await book("2026-09-10", "402");

    expect(await reservations.getReservationsByDate("2026-09-12")).toEqual([]);
  });
});

describe("getReservationsBetween", () => {
  it("includes both ends of the range", async () => {
    const { reservations } = await loadServices();

    await book("2026-09-09", "401");
    await book("2026-09-10", "402");
    await book("2026-09-11", "403");

    const window = await reservations.getReservationsBetween("2026-09-09", "2026-09-11");

    expect(window.map((entry) => entry.roomNumber).sort()).toEqual(["401", "402", "403"]);
  });

  it("excludes the days just outside it", async () => {
    const { reservations } = await loadServices();

    await book("2026-09-08", "400");
    await book("2026-09-09", "401");
    await book("2026-09-11", "403");
    await book("2026-09-12", "404");

    const window = await reservations.getReservationsBetween("2026-09-09", "2026-09-11");

    expect(window.map((entry) => entry.roomNumber).sort()).toEqual(["401", "403"]);
  });

  it("spans a month and a year boundary, because the keys are compared as strings", async () => {
    const { reservations } = await loadServices();

    await book("2026-12-31", "401");
    await book("2027-01-01", "402");

    const window = await reservations.getReservationsBetween("2026-12-30", "2027-01-02");

    expect(window.map((entry) => entry.roomNumber).sort()).toEqual(["401", "402"]);
  });

  it("hands back the newest booking first", async () => {
    const { reservations } = await loadServices();

    const first = await book("2026-09-09", "401");
    const second = await book("2026-09-10", "402");

    const window = await reservations.getReservationsBetween("2026-09-09", "2026-09-10");

    expect(window.map((entry) => entry.reservationNumber)).toEqual([
      second.reservationNumber,
      first.reservationNumber,
    ]);
  });

  it("returns nothing when the range holds no evenings", async () => {
    const { reservations } = await loadServices();
    await book("2026-09-10", "402");

    expect(await reservations.getReservationsBetween("2026-10-01", "2026-10-31")).toEqual([]);
  });
});

describe("getDashboardCounts", () => {
  it("adds up tonight's covers and counts what is still ahead", async () => {
    const { reservations } = await loadServices();

    await book("2026-09-10", "401");
    await book("2026-09-10", "402");
    await book("2026-09-11", "403");
    await book("2026-09-09", "404");

    const counts = await reservations.getDashboardCounts("2026-09-10");

    // One guest each, so tonight is two covers across the two rooms.
    expect(counts.guestsTonight).toBe(2);
    // Tonight and tomorrow, but not yesterday.
    expect(counts.upcomingReservations).toBe(3);
  });

  it("leaves cancelled bookings out of both figures", async () => {
    const { reservations } = await loadServices();

    await book("2026-09-10", "401");
    const cancelled = await book("2026-09-10", "402");
    await reservations.cancelReservation(cancelled.reservationNumber);

    const counts = await reservations.getDashboardCounts("2026-09-10");

    expect(counts.guestsTonight).toBe(1);
    expect(counts.upcomingReservations).toBe(1);
  });

  /**
   * `status` is one of the optional fields of HANDOVER §2.2. A booking taken
   * before it existed has none at all, and the record reader treats that as
   * confirmed — so the counts must too, or the dashboard would silently
   * under-report every old booking.
   */
  it("counts a legacy booking that has no status field", async () => {
    const { reservations } = await loadServices();

    const legacy = await book("2026-09-10", "401");
    await mongoose.connection
      .collection("reservations")
      .updateOne({ reservationNumber: legacy.reservationNumber }, { $unset: { status: "" } });

    const counts = await reservations.getDashboardCounts("2026-09-10");

    expect(counts.guestsTonight).toBe(1);
    expect(counts.upcomingReservations).toBe(1);
  });

  it("reports zero rather than nothing when the evening is empty", async () => {
    const { reservations } = await loadServices();

    expect(await reservations.getDashboardCounts("2026-09-10")).toEqual({
      guestsTonight: 0,
      upcomingReservations: 0,
    });
  });
});
