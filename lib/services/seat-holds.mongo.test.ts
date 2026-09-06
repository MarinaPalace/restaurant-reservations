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

  /**
   * The attempt is kept, not deleted — that is the whole footprint. A guest at
   * the desk saying they booked can be answered from this row.
   */
  it("keeps the attempt on the record as abandoned", async () => {
    const { holdSeats, sweepExpiredHolds, getSeatHold } = await load();
    await openEvening(10);

    const hold = await holdSeats({ date: DATE, guests: 4, passKeyId: "key-1", roomNumber: "402" });
    await expireHold(hold.holdId);
    await sweepExpiredHolds(DATE);

    const after = await getSeatHold(hold.holdId);
    expect(after).toMatchObject({ status: "abandoned", roomNumber: "402", guests: 4, date: DATE });
    expect(after?.closedAt).toBeTruthy();
  });

  /** And it says so in the log, where the desk actually looks. */
  it("writes a line into the log saying who did not finish", async () => {
    const { holdSeats, sweepExpiredHolds } = await load();
    const { getAuditEntries } = await import("@/lib/services/audit-log");
    await openEvening(10);

    const hold = await holdSeats({ date: DATE, guests: 2, passKeyId: "key-1", roomNumber: "402" });
    await expireHold(hold.holdId);
    await sweepExpiredHolds(DATE);

    const entries = await getAuditEntries({ limit: 10 });
    const abandoned = entries.find((entry) => entry.action === "booking:abandoned");

    expect(abandoned).toBeDefined();
    expect(abandoned?.summary).toContain("Room 402");
    expect(abandoned?.summary).toContain(DATE);
  });

  /** Swept twice, logged once: the status filter is what decides the winner. */
  it("does not log the same abandoned attempt twice", async () => {
    const { holdSeats, sweepExpiredHolds } = await load();
    const { getAuditEntries } = await import("@/lib/services/audit-log");
    await openEvening(10);

    const hold = await holdSeats({ date: DATE, guests: 2, passKeyId: "key-1", roomNumber: "402" });
    await expireHold(hold.holdId);

    await sweepExpiredHolds(DATE);
    await sweepExpiredHolds(DATE);

    const entries = await getAuditEntries({ limit: 20 });
    expect(entries.filter((entry) => entry.action === "booking:abandoned")).toHaveLength(1);
    expect(await evening()).toEqual({ reservedSeats: 0, heldSeats: 0 });
  });

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
   * A finished booking must never appear in the unfinished list — that is the
   * difference the desk is reading it for.
   */
  it("is recorded as booked, not abandoned", async () => {
    const { holdSeats, consumeSeatHold, listSeatHolds } = await load();
    await openEvening(10);

    const hold = await holdSeats({ date: DATE, guests: 4, passKeyId: "key-1", roomNumber: "402" });
    await consumeSeatHold({
      holdId: hold.holdId,
      date: DATE,
      guests: 4,
      passKeyId: "key-1",
      reservationNumber: "VDM-1",
    });

    expect(await listSeatHolds(DATE)).toEqual([]);
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

describe("what an evening can say about unfinished bookings", () => {
  /** Fifteen minutes ago, so the sweep has something to find. */
  async function expireHold(holdId: string) {
    const { SeatHoldModel } = await import("@/lib/models/seat-hold");
    await SeatHoldModel.updateOne({ holdId }, { $set: { expiresAt: new Date(Date.now() - 60_000) } });
  }

  it("lists who is holding seats now and who walked away", async () => {
    const { holdSeats, sweepExpiredHolds, listSeatHolds } = await load();
    await openEvening(20);

    const gone = await holdSeats({ date: DATE, guests: 2, passKeyId: "key-1", roomNumber: "402" });
    await expireHold(gone.holdId);
    await sweepExpiredHolds(DATE);

    await holdSeats({ date: DATE, guests: 3, passKeyId: "key-2", roomNumber: "403" });

    const holds = await listSeatHolds(DATE);

    expect(holds).toHaveLength(2);
    expect(holds.map((hold) => hold.status).sort()).toEqual(["abandoned", "live"]);
  });

  /**
   * How far they got is the difference between "they glanced at the calendar"
   * and "they were choosing dessert", which is what settles the conversation.
   */
  it("remembers how far the guest got", async () => {
    const { holdSeats, advanceSeatHoldStep, sweepExpiredHolds, getSeatHold } = await load();
    await openEvening(10);

    const hold = await holdSeats({ date: DATE, guests: 2, passKeyId: "key-1", roomNumber: "402" });
    await advanceSeatHoldStep(hold.holdId, "menu");
    await expireHold(hold.holdId);
    await sweepExpiredHolds(DATE);

    expect((await getSeatHold(hold.holdId))?.step).toBe("menu");
  });

  /** Tapping Back must not make the footprint shrink. */
  it("never walks the step backwards", async () => {
    const { holdSeats, advanceSeatHoldStep, getSeatHold } = await load();
    await openEvening(10);

    const hold = await holdSeats({ date: DATE, guests: 2, passKeyId: "key-1" });
    await advanceSeatHoldStep(hold.holdId, "summary");
    await advanceSeatHoldStep(hold.holdId, "table");

    expect((await getSeatHold(hold.holdId))?.step).toBe("summary");
  });

  /**
   * And changing the date carries it across. Otherwise every change of mind
   * would reset the record to "chose a date" and hide how far they really got.
   */
  it("carries the step across a change of date", async () => {
    const { holdSeats, advanceSeatHoldStep } = await load();
    await openEvening(10);

    const first = await holdSeats({ date: DATE, guests: 2, passKeyId: "key-1" });
    await advanceSeatHoldStep(first.holdId, "menu");

    const second = await holdSeats({
      date: DATE,
      guests: 2,
      passKeyId: "key-1",
      previousHoldId: first.holdId,
    });

    expect(second.step).toBe("menu");
  });
});

describe("what the calendar is told", () => {
  /**
   * The reader used to whitelist its fields, so `heldSeats` was silently
   * dropped on the way out of Mongo and `remainingSeats` counted held seats as
   * free. The calendar offered seats a guest was in the middle of booking, and
   * nothing looked wrong anywhere — the drop is indistinguishable from the
   * field not existing.
   */
  it("carries held seats out of the database, so remaining seats are true", async () => {
    const { holdSeats } = await load();
    const { getRestaurantDate, getRestaurantDates } = await import("@/lib/services/restaurant");
    await openEvening(10);

    await holdSeats({ date: DATE, guests: 4, passKeyId: "key-1" });

    const one = await getRestaurantDate(DATE);
    expect(one?.heldSeats).toBe(4);
    expect(one?.remainingSeats).toBe(6);

    const listed = (await getRestaurantDates()).find((entry) => entry.date === DATE);
    expect(listed?.heldSeats).toBe(4);
    expect(listed?.remainingSeats).toBe(6);
  });
});

describe("one key, one evening", () => {
  /**
   * The invariant the model claims, now actually enforced on the server.
   *
   * It used to rest on the browser sending `previousHoldId`, and several
   * ordinary things break that: a reply lost on lobby wi-fi, a refusal that
   * returns before a hold is taken while the screen clears its copy anyway, or
   * simply two tabs. Each left a live hold nobody could name — and the guest's
   * next attempt was then refused by their own abandoned seats.
   */
  it("closes a hold the browser forgot to mention", async () => {
    const { holdSeats } = await load();
    await openEvening(10);

    // The guest's first attempt. The reply is lost, so the browser keeps no id.
    await holdSeats({ date: DATE, guests: 4, passKeyId: "key-1" });

    // They tap Continue again, with nothing to hand back.
    await holdSeats({ date: DATE, guests: 4, passKeyId: "key-1" });

    // Four seats held, not eight.
    expect(await evening()).toEqual({ reservedSeats: 0, heldSeats: 4 });
  });

  /**
   * And the evening is not shut against them by their own ghost. This is the
   * case that matters: on a tight evening the second attempt used to be refused
   * `DATE_FULL` by the seats the first attempt was still holding.
   */
  it("does not let a guest lock themselves out of the last seats", async () => {
    const { holdSeats } = await load();
    await openEvening(4);

    await holdSeats({ date: DATE, guests: 4, passKeyId: "key-1" });

    await expect(holdSeats({ date: DATE, guests: 4, passKeyId: "key-1" })).resolves.toMatchObject({
      guests: 4,
    });
    expect(await evening()).toEqual({ reservedSeats: 0, heldSeats: 4 });
  });

  /** Two tabs on two evenings is still one key, so still one hold. */
  it("moves the hold when the same key takes another evening", async () => {
    const { holdSeats, listSeatHolds } = await load();
    const { RestaurantDateModel } = await import("@/lib/models/restaurant-date");
    await openEvening(10);
    await RestaurantDateModel.create({ date: "2026-09-19", isOpen: true, capacity: 10, reservedSeats: 0 });

    await holdSeats({ date: DATE, guests: 2, passKeyId: "key-1" });
    await holdSeats({ date: "2026-09-19", guests: 2, passKeyId: "key-1" });

    expect(await evening()).toEqual({ reservedSeats: 0, heldSeats: 0 });
    expect((await listSeatHolds(DATE)).every((hold) => hold.status !== "live")).toBe(true);
  });

  /** Another guest's live hold is none of this key's business. */
  it("leaves other keys alone", async () => {
    const { holdSeats } = await load();
    await openEvening(10);

    await holdSeats({ date: DATE, guests: 3, passKeyId: "key-1" });
    await holdSeats({ date: DATE, guests: 2, passKeyId: "key-2" });

    expect(await evening()).toEqual({ reservedSeats: 0, heldSeats: 5 });
  });

  /** And the footprint survives being moved, however it was moved. */
  it("carries the furthest step across a hold the browser forgot", async () => {
    const { holdSeats, advanceSeatHoldStep } = await load();
    await openEvening(10);

    const first = await holdSeats({ date: DATE, guests: 2, passKeyId: "key-1" });
    await advanceSeatHoldStep(first.holdId, "menu");

    // No `previousHoldId` — the browser lost it.
    const second = await holdSeats({ date: DATE, guests: 2, passKeyId: "key-1" });

    expect(second.step).toBe("menu");
  });
});

describe("recording how far the guest got", () => {
  /**
   * Steps are reported with `keepalive` as the guest moves, so two can be in
   * flight at once. Read-then-write let them land summary-then-menu and walk
   * the footprint backwards; the filter now does the comparison.
   */
  it("cannot be walked backwards by a late report", async () => {
    const { holdSeats, advanceSeatHoldStep, getSeatHold } = await load();
    await openEvening(10);

    const hold = await holdSeats({ date: DATE, guests: 2, passKeyId: "key-1" });

    await Promise.all([
      advanceSeatHoldStep(hold.holdId, "summary"),
      advanceSeatHoldStep(hold.holdId, "menu"),
      advanceSeatHoldStep(hold.holdId, "table"),
    ]);

    expect((await getSeatHold(hold.holdId))?.step).toBe("summary");
  });
});

describe("what a saved evening says about its held seats", () => {
  /**
   * The calendar writes this answer straight back into its own state, so a
   * reader that lists its fields and forgets one makes held seats vanish from
   * the screen while the hold is still live (rule 2.24).
   */
  it("still knows about them after staff edit the evening", async () => {
    const { holdSeats } = await load();
    const { updateRestaurantDate } = await import("@/lib/services/reservations");
    await openEvening(10);

    await holdSeats({ date: DATE, guests: 4, passKeyId: "key-1" });

    const saved = await updateRestaurantDate({
      date: DATE,
      isOpen: true,
      capacity: 10,
      serviceTime: "19:30",
    });

    expect(saved.heldSeats).toBe(4);
    expect(saved.remainingSeats).toBe(6);
  });

  /** The field that had been dropped since it was added, on master too. */
  it("keeps the table cutoff staff set on it", async () => {
    await load();
    const { updateRestaurantDate } = await import("@/lib/services/reservations");
    const { getRestaurantDate, getRestaurantDates } = await import("@/lib/services/restaurant");

    await updateRestaurantDate({
      date: DATE,
      isOpen: true,
      capacity: 10,
      tableCutoffHours: 6,
    });

    expect((await getRestaurantDate(DATE))?.tableCutoffHours).toBe(6);
    expect(
      (await getRestaurantDates()).find((entry) => entry.date === DATE)?.tableCutoffHours,
    ).toBe(6);
  });
});
