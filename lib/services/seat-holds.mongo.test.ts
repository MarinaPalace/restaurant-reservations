import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import mongoose from "mongoose";

/**
 * Seats held while a guest finishes booking, and the race they exist to settle.
 *
 * The bug this feature was written for: an evening with four seats left, two
 * guests booking at once. The first finished; the second was sent back to the
 * calendar with nothing said, having chosen a table and six courses for seats
 * that were never theirs. Nothing in the app was wrong except *when* the seats
 * were claimed — at the very end, so everything before it was a guess.
 *
 * These are rule 2.7's properties applied to a third thing that can be
 * exhausted, and checked one at a time: the claim is conditional, the release
 * is idempotent, and the conversion never lets go of the seats in between.
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

  const { resetSweepThrottle } = await import("@/lib/services/seat-holds");
  resetSweepThrottle();
});

async function load() {
  // Connect before touching a model: mongoose buffers server commands silently
  // against a connection that does not exist yet, which looks exactly like
  // every test hanging for no reason.
  const { connectToDatabase } = await import("@/lib/db/connect");
  await connectToDatabase();

  const { SeatHoldModel } = await import("@/lib/models/seat-hold");
  // The unique index on holdId is the mechanism behind "exactly one winner",
  // not decoration: without it built, the contention tests pass for the wrong
  // reason.
  await SeatHoldModel.syncIndexes();

  return import("@/lib/services/seat-holds");
}

const DATE = "2026-09-18";

/** An evening with a given number of seats and nobody in them yet. */
async function openEvening(capacity: number, reservedSeats = 0) {
  const { RestaurantDateModel } = await import("@/lib/models/restaurant-date");

  await RestaurantDateModel.create({
    date: DATE,
    isOpen: true,
    capacity,
    reservedSeats,
    serviceTime: "19:00",
  });
}

async function evening() {
  const { RestaurantDateModel } = await import("@/lib/models/restaurant-date");
  const record = await RestaurantDateModel.findOne({ date: DATE }).lean();

  return {
    reservedSeats: Number(record?.reservedSeats ?? 0),
    heldSeats: Number(record?.heldSeats ?? 0),
  };
}

describe("holding seats", () => {
  it("takes them out of the room straight away", async () => {
    const { holdSeats } = await load();
    await openEvening(10);

    const hold = await holdSeats({ date: DATE, guests: 4, passKeyId: "key-1" });

    expect(hold.guests).toBe(4);
    expect(hold.date).toBe(DATE);
    // Held, not booked. The two are kept apart because they mean different
    // things to everybody downstream.
    expect(await evening()).toEqual({ reservedSeats: 0, heldSeats: 4 });
  });

  it("refuses a party the evening cannot seat", async () => {
    const { holdSeats, SeatHoldError } = await load();
    await openEvening(10, 8);

    await expect(holdSeats({ date: DATE, guests: 4, passKeyId: "key-1" })).rejects.toThrow(SeatHoldError);
    expect(await evening()).toEqual({ reservedSeats: 8, heldSeats: 0 });
  });

  it("counts held seats against the room, not just booked ones", async () => {
    const { holdSeats, SeatHoldError } = await load();
    await openEvening(6);

    await holdSeats({ date: DATE, guests: 4, passKeyId: "key-1" });

    // Two seats left, so a party of four cannot have them — even though
    // nothing has actually been booked yet. That is the whole point.
    await expect(holdSeats({ date: DATE, guests: 4, passKeyId: "key-2" })).rejects.toThrow(SeatHoldError);
    await expect(holdSeats({ date: DATE, guests: 2, passKeyId: "key-2" })).resolves.toMatchObject({
      guests: 2,
    });
  });

  it("will not hold seats on a closed evening", async () => {
    const { holdSeats } = await load();
    const { RestaurantDateModel } = await import("@/lib/models/restaurant-date");
    await RestaurantDateModel.create({ date: DATE, isOpen: false, capacity: 40, reservedSeats: 0 });

    await expect(holdSeats({ date: DATE, guests: 2, passKeyId: "key-1" })).rejects.toMatchObject({
      code: "DATE_CLOSED",
    });
  });

  /**
   * The race, stated plainly. Both parties ask for the last four seats at the
   * same instant; one gets them and one is told so — *now*, on the calendar,
   * rather than after choosing a table and six courses.
   */
  it("lets exactly one of two simultaneous parties have the last seats", async () => {
    const { holdSeats } = await load();
    await openEvening(4);

    const results = await Promise.allSettled([
      holdSeats({ date: DATE, guests: 4, passKeyId: "key-1" }),
      holdSeats({ date: DATE, guests: 4, passKeyId: "key-2" }),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect(await evening()).toEqual({ reservedSeats: 0, heldSeats: 4 });
  });

  it("never oversells under a crowd", async () => {
    const { holdSeats } = await load();
    await openEvening(10);

    const results = await Promise.allSettled(
      Array.from({ length: 12 }, (_, index) =>
        holdSeats({ date: DATE, guests: 2, passKeyId: `key-${index}` }),
      ),
    );

    const held = results.filter((result) => result.status === "fulfilled").length;

    expect(held).toBe(5);
    expect(await evening()).toEqual({ reservedSeats: 0, heldSeats: 10 });
  });

  /**
   * A guest changing the date or the party size must move their hold rather
   * than take a second one — otherwise three changes of mind would shut an
   * evening on nobody's behalf.
   */
  it("moves a hold rather than stacking a second one", async () => {
    const { holdSeats } = await load();
    await openEvening(10);

    const first = await holdSeats({ date: DATE, guests: 4, passKeyId: "key-1" });
    const second = await holdSeats({
      date: DATE,
      guests: 2,
      passKeyId: "key-1",
      previousHoldId: first.holdId,
    });

    expect(second.holdId).not.toBe(first.holdId);
    expect(await evening()).toEqual({ reservedSeats: 0, heldSeats: 2 });
  });

  /**
   * And the old hold is released *first*, so a party shrinking on a nearly full
   * evening is not refused by seats it is holding itself.
   */
  it("lets a party shrink into an evening its own hold had filled", async () => {
    const { holdSeats } = await load();
    await openEvening(4);

    const first = await holdSeats({ date: DATE, guests: 4, passKeyId: "key-1" });

    await expect(
      holdSeats({ date: DATE, guests: 3, passKeyId: "key-1", previousHoldId: first.holdId }),
    ).resolves.toMatchObject({ guests: 3 });

    expect(await evening()).toEqual({ reservedSeats: 0, heldSeats: 3 });
  });
});

describe("letting seats go", () => {
  it("puts them back in the room", async () => {
    const { holdSeats, releaseSeatHold } = await load();
    await openEvening(10);

    const hold = await holdSeats({ date: DATE, guests: 4, passKeyId: "key-1" });
    await releaseSeatHold(hold.holdId);

    expect(await evening()).toEqual({ reservedSeats: 0, heldSeats: 0 });
  });

  /**
   * Idempotent by filter, exactly as cancelling a booking is: the document is
   * the thing being competed for, so a second release finds nothing and gives
   * nothing back. Without this, a release racing an expiry sweep would hand the
   * same four seats back twice and the evening would oversell.
   */
  it("gives the same seats back only once", async () => {
    const { holdSeats, releaseSeatHold } = await load();
    await openEvening(10, 2);

    const hold = await holdSeats({ date: DATE, guests: 4, passKeyId: "key-1" });

    await Promise.all([
      releaseSeatHold(hold.holdId),
      releaseSeatHold(hold.holdId),
      releaseSeatHold(hold.holdId),
    ]);

    expect(await evening()).toEqual({ reservedSeats: 2, heldSeats: 0 });
  });

  it("shrugs at a hold that was never there", async () => {
    const { releaseSeatHold } = await load();
    await openEvening(10);

    await expect(releaseSeatHold("no-such-hold")).resolves.toBeNull();
    expect(await evening()).toEqual({ reservedSeats: 0, heldSeats: 0 });
  });
});

describe("running out of time", () => {
  /** Fifteen minutes ago, so the sweep has something to find. */
  async function expireHold(holdId: string) {
    const { SeatHoldModel } = await import("@/lib/models/seat-hold");
    await SeatHoldModel.updateOne({ holdId }, { $set: { expiresAt: new Date(Date.now() - 60_000) } });
  }

  it("gives an expired hold's seats back to the room", async () => {
    const { holdSeats, sweepExpiredHolds } = await load();
    await openEvening(10);

    const hold = await holdSeats({ date: DATE, guests: 4, passKeyId: "key-1" });
    await expireHold(hold.holdId);
    await sweepExpiredHolds(DATE);

    expect(await evening()).toEqual({ reservedSeats: 0, heldSeats: 0 });
  });

  /**
   * The guest who was waiting is the one who has to see the seats come back, so
   * taking a hold sweeps first. Without this, an evening could sit shut behind
   * three abandoned tabs until somebody happened to load the calendar.
   */
  it("frees seats for the next guest without waiting for anybody to look", async () => {
    const { holdSeats } = await load();
    await openEvening(4);

    const first = await holdSeats({ date: DATE, guests: 4, passKeyId: "key-1" });
    await expireHold(first.holdId);

    await expect(holdSeats({ date: DATE, guests: 4, passKeyId: "key-2" })).resolves.toMatchObject({
      guests: 4,
    });

    expect(await evening()).toEqual({ reservedSeats: 0, heldSeats: 4 });
  });

  it("cannot be spent once it has run out", async () => {
    const { holdSeats, consumeSeatHold } = await load();
    await openEvening(10);

    const hold = await holdSeats({ date: DATE, guests: 4, passKeyId: "key-1" });
    await expireHold(hold.holdId);

    await expect(
      consumeSeatHold({ holdId: hold.holdId, date: DATE, guests: 4, passKeyId: "key-1" }),
    ).resolves.toBeNull();
  });

  /**
   * The safety net. A crash between deleting a receipt and decrementing the
   * counter would hold seats no document accounts for; since every hold stamps
   * the evening as it takes its seats, held seats with no live hold and no
   * activity for longer than a hold can last are stranded rather than busy.
   */
  it("recovers seats stranded by a crash", async () => {
    const { sweepExpiredHolds } = await load();
    const { RestaurantDateModel } = await import("@/lib/models/restaurant-date");

    await RestaurantDateModel.create({
      date: DATE,
      isOpen: true,
      capacity: 10,
      reservedSeats: 2,
      heldSeats: 4,
      heldSeatsTouchedAt: new Date(Date.now() - 60 * 60_000),
    });

    await sweepExpiredHolds(DATE);

    expect(await evening()).toEqual({ reservedSeats: 2, heldSeats: 0 });
  });

  /** And never touches an evening somebody is actually holding seats on. */
  it("leaves a live hold alone", async () => {
    const { holdSeats, sweepExpiredHolds } = await load();
    await openEvening(10);

    await holdSeats({ date: DATE, guests: 4, passKeyId: "key-1" });
    await sweepExpiredHolds(DATE);

    expect(await evening()).toEqual({ reservedSeats: 0, heldSeats: 4 });
  });
});

describe("spending a hold on a booking", () => {
  it("moves the seats from held to booked", async () => {
    const { holdSeats, consumeSeatHold } = await load();
    await openEvening(10);

    const hold = await holdSeats({ date: DATE, guests: 4, passKeyId: "key-1" });
    const spent = await consumeSeatHold({ holdId: hold.holdId, date: DATE, guests: 4, passKeyId: "key-1" });

    expect(spent?.holdId).toBe(hold.holdId);
    // The seats never left the room in between, which is what stops anybody
    // taking them while the guest is pressing Confirm.
    expect(await evening()).toEqual({ reservedSeats: 4, heldSeats: 0 });
  });

  /**
   * A guest who dropped a diner between the calendar and the summary booked for
   * three on a hold for four. The booking takes three; the fourth seat goes
   * back to the room rather than being quietly kept off the market.
   */
  it("hands back the seats a shrunken party no longer needs", async () => {
    const { holdSeats, consumeSeatHold } = await load();
    await openEvening(10);

    const hold = await holdSeats({ date: DATE, guests: 4, passKeyId: "key-1" });
    await consumeSeatHold({ holdId: hold.holdId, date: DATE, guests: 3, passKeyId: "key-1" });

    expect(await evening()).toEqual({ reservedSeats: 3, heldSeats: 0 });
  });

  /** A double-tapped Confirm must not book the same seats twice. */
  it("can be spent exactly once", async () => {
    const { holdSeats, consumeSeatHold } = await load();
    await openEvening(10);

    const hold = await holdSeats({ date: DATE, guests: 4, passKeyId: "key-1" });

    const results = await Promise.all([
      consumeSeatHold({ holdId: hold.holdId, date: DATE, guests: 4, passKeyId: "key-1" }),
      consumeSeatHold({ holdId: hold.holdId, date: DATE, guests: 4, passKeyId: "key-1" }),
    ]);

    expect(results.filter(Boolean)).toHaveLength(1);
    expect(await evening()).toEqual({ reservedSeats: 4, heldSeats: 0 });
  });

  /** The id alone proves nothing: it has to be this key's hold, on this night. */
  it("refuses a hold belonging to somebody else", async () => {
    const { holdSeats, consumeSeatHold } = await load();
    await openEvening(10);

    const hold = await holdSeats({ date: DATE, guests: 4, passKeyId: "key-1" });

    await expect(
      consumeSeatHold({ holdId: hold.holdId, date: DATE, guests: 4, passKeyId: "key-2" }),
    ).resolves.toBeNull();
    await expect(
      consumeSeatHold({ holdId: hold.holdId, date: "2026-09-19", guests: 4, passKeyId: "key-1" }),
    ).resolves.toBeNull();
    // And it cannot be stretched to cover more people than it was taken for.
    await expect(
      consumeSeatHold({ holdId: hold.holdId, date: DATE, guests: 6, passKeyId: "key-1" }),
    ).resolves.toBeNull();

    // None of those touched the evening.
    expect(await evening()).toEqual({ reservedSeats: 0, heldSeats: 4 });
  });

  /**
   * The booking failed after the hold was spent. The hold is gone, so the seats
   * go back to the room rather than to a receipt that no longer exists — the
   * same shape as the pass-key being handed back on that path.
   */
  it("hands the seats back when the booking then fails", async () => {
    const { holdSeats, consumeSeatHold, refundConsumedHold } = await load();
    await openEvening(10);

    const hold = await holdSeats({ date: DATE, guests: 4, passKeyId: "key-1" });
    await consumeSeatHold({ holdId: hold.holdId, date: DATE, guests: 4, passKeyId: "key-1" });
    await refundConsumedHold(DATE, 4);

    expect(await evening()).toEqual({ reservedSeats: 0, heldSeats: 0 });
  });
});
