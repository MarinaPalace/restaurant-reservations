import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import mongoose from "mongoose";

/**
 * Exercises the real MongoDB code path against an actual server.
 *
 * These paths were previously untested, which is why defects like the dropped
 * guestIndex and the double seat refund survived. A standalone in-memory
 * mongod (no replica set) is used deliberately: it proves the booking flow
 * works without transactions.
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
  { guestIndex: 1, courseId: "c1", courseName: "Starter", optionId: "o2", optionName: "Velouté" },
];

async function openDate(date: string, capacity: number) {
  const { reservations } = await loadServices();
  await reservations.updateRestaurantDate({ date, isOpen: true, capacity });
}

describe("mongo connection handling", () => {
  it("reuses one connection instead of opening a new one per call", async () => {
    const { connectToDatabase } = await import("@/lib/db/connect");
    const connectSpy = vi.spyOn(mongoose, "connect");

    await Promise.all([connectToDatabase(), connectToDatabase(), connectToDatabase()]);

    // The cached promise means concurrent callers share a single connect().
    expect(connectSpy.mock.calls.length).toBeLessThanOrEqual(1);
    expect(mongoose.connection.readyState).toBe(1);

    connectSpy.mockRestore();
  });

  it("reports a bad connection string instead of silently carrying on", async () => {
    const { connectToDatabase } = await import("@/lib/db/connect");
    const goodUri = process.env.MONGODB_URI;

    // Must start from a disconnected client, otherwise the live connection is
    // reused (correctly) and the failure path is never reached.
    await mongoose.disconnect();
    globalThis.__mongoosePromise = undefined;
    process.env.MONGODB_URI = "mongodb://127.0.0.1:1/nope?serverSelectionTimeoutMS=500";

    await expect(connectToDatabase()).rejects.toThrow();

    // A rejected attempt must not poison the cache: the next call retries.
    expect(globalThis.__mongoosePromise).toBeUndefined();

    process.env.MONGODB_URI = goodUri;
    await connectToDatabase();
    expect(mongoose.connection.readyState).toBe(1);
  }, 30_000);
});

describe("reservations against MongoDB", () => {
  it("stores the per-guest index with each selection", async () => {
    const { reservations } = await loadServices();
    await openDate("2026-09-10", 40);

    const created = await reservations.createReservationEntry({
      roomNumber: 402,
      guestCount: 2,
      date: "2026-09-10",
      selections: SELECTIONS,
    });

    const loaded = await reservations.getReservationByNumber(created.reservationNumber);
    expect(loaded?.selections.map((entry) => entry.guestIndex)).toEqual([0, 1]);
  });

  it("consumes seats when booking and releases them on cancellation", async () => {
    const { reservations, restaurant } = await loadServices();
    await openDate("2026-09-11", 10);

    const created = await reservations.createReservationEntry({
      roomNumber: 402,
      guestCount: 4,
      date: "2026-09-11",
      selections: SELECTIONS,
    });

    expect((await restaurant.getRestaurantDate("2026-09-11"))?.reservedSeats).toBe(4);

    await reservations.cancelReservation(created.reservationNumber);
    expect((await restaurant.getRestaurantDate("2026-09-11"))?.reservedSeats).toBe(0);
  });

  it("does not refund seats twice when cancelled twice", async () => {
    const { reservations, restaurant } = await loadServices();
    await openDate("2026-09-12", 10);

    const created = await reservations.createReservationEntry({
      roomNumber: 402,
      guestCount: 3,
      date: "2026-09-12",
      selections: SELECTIONS,
    });

    await reservations.cancelReservation(created.reservationNumber);
    await reservations.cancelReservation(created.reservationNumber);

    expect((await restaurant.getRestaurantDate("2026-09-12"))?.reservedSeats).toBe(0);
  });

  it("refuses to oversell a date", async () => {
    const { reservations } = await loadServices();
    await openDate("2026-09-13", 4);

    await reservations.createReservationEntry({
      roomNumber: 401,
      guestCount: 3,
      date: "2026-09-13",
      selections: SELECTIONS,
    });

    await expect(
      reservations.createReservationEntry({
        roomNumber: 402,
        guestCount: 2,
        date: "2026-09-13",
        selections: SELECTIONS,
      }),
    ).rejects.toThrow("DATE_FULL");
  });

  /** Works without transactions, so a standalone mongod is enough. */
  it("cannot oversell the last table to simultaneous bookings", async () => {
    const { reservations, restaurant } = await loadServices();
    await openDate("2026-09-14", 2);

    const results = await Promise.allSettled([
      reservations.createReservationEntry({
        roomNumber: 401,
        guestCount: 2,
        date: "2026-09-14",
        selections: SELECTIONS,
      }),
      reservations.createReservationEntry({
        roomNumber: 402,
        guestCount: 2,
        date: "2026-09-14",
        selections: SELECTIONS,
      }),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect((await restaurant.getRestaurantDate("2026-09-14"))?.reservedSeats).toBe(2);
  });

  it("refuses a closed date", async () => {
    const { reservations } = await loadServices();
    await reservations.updateRestaurantDate({ date: "2026-09-15", isOpen: false, capacity: 40 });

    await expect(
      reservations.createReservationEntry({
        roomNumber: 402,
        guestCount: 2,
        date: "2026-09-15",
        selections: SELECTIONS,
      }),
    ).rejects.toThrow("DATE_CLOSED");
  });
});

describe("menu catalogue against MongoDB", () => {
  it("keeps course and option ids across a save, so reservations stay linked", async () => {
    const { restaurant } = await loadServices();

    const saved = await restaurant.saveMenuCatalog([
      {
        id: "",
        order: 1,
        name: "Starter",
        description: "",
        required: true,
        active: true,
        imageUrl: "",
        translations: { fr: { name: "Entrée" } },
        options: [
          {
            id: "",
            courseId: "",
            name: "Salmon",
            description: "",
            allergens: ["Fish"],
            active: true,
            imageUrl: "",
            translations: {},
          },
        ],
      },
    ]);

    const courseId = saved[0].id;
    const optionId = saved[0].options[0].id;

    const resaved = await restaurant.saveMenuCatalog([{ ...saved[0], name: "Renamed" }]);

    expect(resaved[0].id).toBe(courseId);
    expect(resaved[0].options[0].id).toBe(optionId);
    expect(resaved[0].name).toBe("Renamed");
  });

  it("hides inactive courses from guests but keeps them for the editor", async () => {
    const { restaurant } = await loadServices();

    await restaurant.saveMenuCatalog([
      {
        id: "",
        order: 1,
        name: "Hidden course",
        description: "",
        required: true,
        active: false,
        imageUrl: "",
        translations: {},
        options: [],
      },
    ]);

    expect(await restaurant.getMenuCatalog()).toHaveLength(0);
    expect(await restaurant.getFullMenuCatalog()).toHaveLength(1);
  });

  it("serves translations to guests", async () => {
    const { restaurant } = await loadServices();

    await restaurant.saveMenuCatalog([
      {
        id: "",
        order: 1,
        name: "Starter",
        description: "Fresh",
        required: true,
        active: true,
        imageUrl: "",
        translations: { fr: { name: "Entrée" } },
        options: [],
      },
    ]);

    expect((await restaurant.getMenuCatalog("fr"))[0].name).toBe("Entrée");
    // Falls back to English where no translation exists.
    expect((await restaurant.getMenuCatalog("fr"))[0].description).toBe("Fresh");
  });
});
