import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import mongoose from "mongoose";

/**
 * The indexes every large read depends on, checked against a real server.
 *
 * A declaration in a schema is not an index; only a built one is. These assert
 * what Mongo actually reports, so deleting a line from a model breaks a test
 * rather than making a screen slow six months later on somebody else's data.
 *
 * Only the indexes that matter at size are pinned. The point is not to freeze
 * every index in place — it is that the collections which grow without bound
 * are never read in a way that scans them.
 */

let mongod: MongoMemoryServer;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongod.getUri();

  const { connectToDatabase } = await import("@/lib/db/connect");
  await connectToDatabase();
}, 120_000);

afterAll(async () => {
  await mongoose.disconnect();
  await mongod?.stop();
  delete process.env.MONGODB_URI;
});

/** The key patterns Mongo reports for a model, once its indexes are built. */
async function indexKeysOf(model: { syncIndexes: () => Promise<unknown>; listIndexes: () => Promise<{ key: Record<string, number> }[]> }) {
  await model.syncIndexes();
  const indexes = await model.listIndexes();
  return indexes.map((index) => JSON.stringify(index.key));
}

describe("the audit log, which only ever grows", () => {
  it("can be read newest-first without sorting the whole collection", async () => {
    const { AuditEntryModel } = await import("@/lib/models/audit-entry");
    const keys = await indexKeysOf(AuditEntryModel);

    expect(keys).toContain(JSON.stringify({ createdAt: -1 }));
  });

  it("can find one booking's history and order it in the same pass", async () => {
    const { AuditEntryModel } = await import("@/lib/models/audit-entry");
    const keys = await indexKeysOf(AuditEntryModel);

    expect(keys).toContain(JSON.stringify({ reservationNumber: 1, createdAt: -1 }));
  });
});

describe("reservations, which grow with every booking ever taken", () => {
  it("is indexed on the evening, which is how the whole app reads it", async () => {
    const { ReservationModel } = await import("@/lib/models/reservation");
    const keys = await indexKeysOf(ReservationModel);

    expect(keys).toContain(JSON.stringify({ date: 1 }));
  });

  it("is indexed on createdAt, the sort behind the admin lists", async () => {
    const { ReservationModel } = await import("@/lib/models/reservation");
    const keys = await indexKeysOf(ReservationModel);

    expect(keys).toContain(JSON.stringify({ createdAt: -1 }));
  });

  it("finds a booking by its number without a scan", async () => {
    const { ReservationModel } = await import("@/lib/models/reservation");
    const keys = await indexKeysOf(ReservationModel);

    expect(keys).toContain(JSON.stringify({ reservationNumber: 1 }));
  });

  it("finds every booking a pass-key paid for", async () => {
    const { ReservationModel } = await import("@/lib/models/reservation");
    const keys = await indexKeysOf(ReservationModel);

    expect(keys).toContain(JSON.stringify({ passKeyId: 1 }));
  });
});

describe("table claims, where two guests can race for one table", () => {
  /**
   * Not a performance index. It is the thing that makes the claim safe: two
   * requests for the same table on the same evening cannot both succeed,
   * because the second violates this.
   */
  it("cannot hold the same table twice on one evening", async () => {
    const { TableClaimModel } = await import("@/lib/models/table-claim");
    await TableClaimModel.syncIndexes();
    const indexes = await TableClaimModel.listIndexes();

    const claim = indexes.find(
      (index: { key: Record<string, number> }) =>
        JSON.stringify(index.key) === JSON.stringify({ date: 1, tableId: 1 }),
    );

    expect(claim).toBeDefined();
    expect(claim?.unique).toBe(true);
  });
});

describe("menu options", () => {
  it("is indexed by the course that owns them", async () => {
    const { MenuOptionModel } = await import("@/lib/models/menu-option");
    const keys = await indexKeysOf(MenuOptionModel);

    expect(keys).toContain(JSON.stringify({ courseId: 1 }));
  });
});
