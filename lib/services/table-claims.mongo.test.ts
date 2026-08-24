import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import mongoose from "mongoose";

/**
 * The table claim, and the race it exists to lose safely.
 *
 * `docs/floor-plan.md` §2 says to write this test **before** the claim is wired
 * into booking, because the failure it guards against is the kind that happens
 * perhaps once a month and gets blamed on the guest: two parties pick table 7
 * at the same moment and both are told yes.
 *
 * Rule 2.7's properties are what is being checked here, one at a time — the
 * same properties the seat claim was made to have, applied to a second thing
 * that can be exhausted.
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

async function load() {
  // Connect before touching the model. `syncIndexes` is a server command, and
  // mongoose buffers it silently against a connection that does not exist yet —
  // which looks exactly like every test hanging for no reason.
  const { connectToDatabase } = await import("@/lib/db/connect");
  await connectToDatabase();

  // The unique index is the mechanism, not decoration: without it built, the
  // contention tests below would pass for the wrong reason.
  const { TableClaimModel } = await import("@/lib/models/table-claim");
  await TableClaimModel.syncIndexes();

  return import("@/lib/services/table-claims");
}

const DATE = "2026-09-04";
const TABLE = "t-window";

describe("claiming a place at a table", () => {
  it("seats a party that fits", async () => {
    const { claimTable } = await load();

    const claim = await claimTable({
      date: DATE,
      tableId: TABLE,
      seats: 4,
      guests: 2,
      reservationNumber: "VDM-1",
    });

    expect(claim.guests).toBe(2);
    expect(claim.reservationNumbers).toEqual(["VDM-1"]);
  });

  /**
   * Sharing is not a special case: a claim with two reservation numbers on it
   * *is* a shared table, which is the same idea `tableGroupId` already carries.
   */
  it("lets a second booking share a table that still has room", async () => {
    const { claimTable } = await load();

    await claimTable({ date: DATE, tableId: TABLE, seats: 4, guests: 2, reservationNumber: "VDM-1" });
    const shared = await claimTable({
      date: DATE,
      tableId: TABLE,
      seats: 4,
      guests: 2,
      reservationNumber: "VDM-2",
    });

    expect(shared.guests).toBe(4);
    expect(shared.reservationNumbers).toEqual(["VDM-1", "VDM-2"]);
  });

  it("refuses a party larger than the table, even when nobody is at it", async () => {
    const { claimTable, TableClaimError } = await load();

    // The empty case has no document for `$expr` to test, so this is the guard
    // that catches it — without it, being first to ask would be enough.
    await expect(
      claimTable({ date: DATE, tableId: TABLE, seats: 4, guests: 6, reservationNumber: "VDM-1" }),
    ).rejects.toBeInstanceOf(TableClaimError);
  });

  it("refuses a party that no longer fits beside the one already there", async () => {
    const { claimTable, TableClaimError } = await load();

    await claimTable({ date: DATE, tableId: TABLE, seats: 4, guests: 3, reservationNumber: "VDM-1" });

    await expect(
      claimTable({ date: DATE, tableId: TABLE, seats: 4, guests: 2, reservationNumber: "VDM-2" }),
    ).rejects.toBeInstanceOf(TableClaimError);
  });

  it("does not count the same booking twice when a request is retried", async () => {
    const { claimTable } = await load();

    await claimTable({ date: DATE, tableId: TABLE, seats: 4, guests: 2, reservationNumber: "VDM-1" });
    const again = await claimTable({
      date: DATE,
      tableId: TABLE,
      seats: 4,
      guests: 2,
      reservationNumber: "VDM-1",
    });

    // Two guests, not four: a repeated request is the same booking asking
    // again, and a table that filled itself up would be unbookable for nobody.
    expect(again.reservationNumbers).toEqual(["VDM-1"]);
    expect(again.guests).toBe(2);
  });

  it("keeps each evening's tables to itself", async () => {
    const { claimTable } = await load();

    await claimTable({ date: DATE, tableId: TABLE, seats: 4, guests: 4, reservationNumber: "VDM-1" });
    const tomorrow = await claimTable({
      date: "2026-09-05",
      tableId: TABLE,
      seats: 4,
      guests: 4,
      reservationNumber: "VDM-2",
    });

    expect(tomorrow.guests).toBe(4);
  });
});

/**
 * The whole reason this file was written first.
 *
 * A read-then-write would pass every test above and still lose here — which is
 * exactly why `docs/floor-plan.md` §2 forbids one.
 */
describe("two parties reaching for the same table at once", () => {
  it("gives an empty table to exactly one of them", async () => {
    const { claimTable } = await load();

    const results = await Promise.allSettled(
      Array.from({ length: 8 }, (_, index) =>
        claimTable({
          date: DATE,
          tableId: TABLE,
          seats: 2,
          guests: 2,
          reservationNumber: `VDM-${index}`,
        }),
      ),
    );

    const seated = results.filter((result) => result.status === "fulfilled");
    expect(seated).toHaveLength(1);

    // And the table is not somehow holding more than it seats.
    const { listTableClaims } = await load();
    const [claim] = await listTableClaims(DATE);
    expect(claim.guests).toBe(2);
    expect(claim.reservationNumbers).toHaveLength(1);
  });

  /**
   * The retry earns its place here. Both parties find no document and both
   * attempt an insert; one loses the index and must look again, because by then
   * the table still has room for it. Without the retry this would be one seated
   * party and one spurious refusal.
   */
  it("seats both when there is room for both", async () => {
    const { claimTable, listTableClaims } = await load();

    const results = await Promise.allSettled([
      claimTable({ date: DATE, tableId: TABLE, seats: 4, guests: 2, reservationNumber: "VDM-A" }),
      claimTable({ date: DATE, tableId: TABLE, seats: 4, guests: 2, reservationNumber: "VDM-B" }),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(2);

    const [claim] = await listTableClaims(DATE);
    expect(claim.guests).toBe(4);
    expect(claim.reservationNumbers.sort()).toEqual(["VDM-A", "VDM-B"]);
  });

  it("never seats more than the table holds, however many ask at once", async () => {
    const { claimTable, listTableClaims } = await load();

    await Promise.allSettled(
      Array.from({ length: 12 }, (_, index) =>
        claimTable({
          date: DATE,
          tableId: TABLE,
          seats: 6,
          guests: 2,
          reservationNumber: `VDM-${index}`,
        }),
      ),
    );

    const [claim] = await listTableClaims(DATE);
    expect(claim.guests).toBeLessThanOrEqual(6);
    expect(claim.reservationNumbers).toHaveLength(claim.guests / 2);
  });
});

describe("giving a table back", () => {
  it("frees the places the booking held", async () => {
    const { claimTable, releaseTable, listTableClaims } = await load();

    await claimTable({ date: DATE, tableId: TABLE, seats: 4, guests: 2, reservationNumber: "VDM-1" });
    await claimTable({ date: DATE, tableId: TABLE, seats: 4, guests: 2, reservationNumber: "VDM-2" });
    await releaseTable({ date: DATE, tableId: TABLE, guests: 2, reservationNumber: "VDM-1" });

    const [claim] = await listTableClaims(DATE);
    expect(claim.guests).toBe(2);
    expect(claim.reservationNumbers).toEqual(["VDM-2"]);
  });

  /**
   * Rule 2.7's habit. A cancel that runs twice, or a release racing a cancel,
   * must not decrement twice — a table that reads free while somebody is
   * sitting at it is the worst outcome available.
   */
  it("is idempotent", async () => {
    const { claimTable, releaseTable, listTableClaims } = await load();

    await claimTable({ date: DATE, tableId: TABLE, seats: 4, guests: 2, reservationNumber: "VDM-1" });
    await claimTable({ date: DATE, tableId: TABLE, seats: 4, guests: 2, reservationNumber: "VDM-2" });

    await releaseTable({ date: DATE, tableId: TABLE, guests: 2, reservationNumber: "VDM-1" });
    await releaseTable({ date: DATE, tableId: TABLE, guests: 2, reservationNumber: "VDM-1" });
    await releaseTable({ date: DATE, tableId: TABLE, guests: 2, reservationNumber: "VDM-1" });

    const [claim] = await listTableClaims(DATE);
    expect(claim.guests).toBe(2);
  });

  it("clears the claim away once nobody is on it", async () => {
    const { claimTable, releaseTable, listTableClaims } = await load();

    await claimTable({ date: DATE, tableId: TABLE, seats: 4, guests: 2, reservationNumber: "VDM-1" });
    await releaseTable({ date: DATE, tableId: TABLE, guests: 2, reservationNumber: "VDM-1" });

    expect(await listTableClaims(DATE)).toEqual([]);
  });

  it("leaves a table alone when a booking that was never on it is released", async () => {
    const { claimTable, releaseTable, listTableClaims } = await load();

    await claimTable({ date: DATE, tableId: TABLE, seats: 4, guests: 2, reservationNumber: "VDM-1" });
    await releaseTable({ date: DATE, tableId: TABLE, guests: 2, reservationNumber: "VDM-STRANGER" });

    const [claim] = await listTableClaims(DATE);
    expect(claim.guests).toBe(2);
    expect(claim.reservationNumbers).toEqual(["VDM-1"]);
  });

  it("makes the place available again", async () => {
    const { claimTable, releaseTable } = await load();

    await claimTable({ date: DATE, tableId: TABLE, seats: 2, guests: 2, reservationNumber: "VDM-1" });
    await releaseTable({ date: DATE, tableId: TABLE, guests: 2, reservationNumber: "VDM-1" });

    const after = await claimTable({
      date: DATE,
      tableId: TABLE,
      seats: 2,
      guests: 2,
      reservationNumber: "VDM-2",
    });

    expect(after.guests).toBe(2);
  });
});
