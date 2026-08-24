import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient, ObjectId, type Db } from "mongodb";
import { EJSON } from "bson";
import {
  BACKUP_FORMAT,
  describeManifest,
  dumpDatabase,
  restoreDatabase,
  RestoreRefused,
  type DatabaseDump,
} from "@/lib/backup";

/**
 * The round trip, against a real server.
 *
 * A backup nobody has restored is a hope, not a backup. The production drill —
 * dumping the live cluster and restoring it somewhere — is a separate exercise
 * with real credentials, and this does not replace it. What it does is remove
 * the failure that drill would otherwise be discovering for the first time:
 * that the file cannot be read back at all.
 *
 * The types are the point. `_id` is an ObjectId and `createdAt` is a Date, and
 * a backup written with plain `JSON.stringify` turns both into strings. The
 * restored database then looks right, loads in the app, and fails every query
 * that matches on an id — on the day you are restoring from backup.
 */

let mongod: MongoMemoryServer;
let client: MongoClient;
let db: Db;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  client = await MongoClient.connect(mongod.getUri());
  db = client.db("backup-test");
}, 120_000);

afterAll(async () => {
  await client?.close();
  await mongod?.stop();
});

afterEach(async () => {
  for (const collection of await db.listCollections().toArray()) {
    await db.collection(collection.name).deleteMany({});
  }
});

/**
 * Through files, the way the scripts write them — not object to object.
 *
 * The split matters and is the reason this helper exists. Documents go through
 * **canonical** Extended JSON, which is what keeps an `Int32` an `Int32` and a
 * Date a Date. The manifest goes through **plain** JSON, because canonical mode
 * would turn `format: 1` into `{ $numberInt: "1" }` and the version check would
 * then compare an object against a number and refuse every backup ever taken.
 *
 * That is not hypothetical: it is what happened when both went through
 * canonical, and the error read "This backup is format 1; this build reads
 * format 1".
 */
function throughFiles(dump: DatabaseDump): DatabaseDump {
  return {
    manifest: JSON.parse(JSON.stringify(dump.manifest)),
    documents: EJSON.parse(EJSON.stringify(dump.documents, { relaxed: false }), {
      relaxed: false,
    }) as unknown as Record<string, unknown[]>,
  };
}

async function seed() {
  const reservationId = new ObjectId();

  await db.collection("reservations").insertMany([
    {
      _id: reservationId,
      reservationNumber: "VDM-AAA111",
      guestCount: 2,
      date: "2026-08-18",
      createdAt: new Date("2026-08-01T10:00:00.000Z"),
      addOns: [{ optionName: "Chardonnay", price: 40, discountPercent: 25, finalPrice: 30 }],
    },
  ]);

  await db.collection("menucourses").insertOne({
    _id: new ObjectId(),
    name: "Starter",
    // The large field, which is what makes these documents worth backing up.
    imageUrl: "data:image/gif;base64,R0lGODlhAQABAIAAAP8AAAAAACH5BAAAAAAALAAAAAABAAEAAAICRAEAOw==",
  });

  return { reservationId };
}

describe("taking a copy", () => {
  it("counts every collection it found", async () => {
    await seed();

    const dump = await dumpDatabase(db);

    expect(dump.manifest.format).toBe(BACKUP_FORMAT);
    expect(dump.manifest.database).toBe("backup-test");
    expect(dump.manifest.collections).toEqual(
      expect.arrayContaining([
        { name: "reservations", count: 1 },
        { name: "menucourses", count: 1 },
      ]),
    );
  });

  it("copies a collection this codebase has no model for", async () => {
    await db.collection("something_an_older_version_left").insertOne({ note: "still mine" });

    const dump = await dumpDatabase(db);

    /*
     * Driven from the server's own collection list rather than from the
     * Mongoose models. A backup that only copies what the current code
     * remembers loses whatever it has forgotten, and a restore then presents
     * that loss as a success.
     */
    expect(dump.documents.something_an_older_version_left).toHaveLength(1);
  });
});

describe("putting it back", () => {
  it("restores every document through a written file, types intact", async () => {
    const { reservationId } = await seed();
    const dump = throughFiles(await dumpDatabase(db));

    // The disaster.
    await db.collection("reservations").deleteMany({});
    await db.collection("menucourses").deleteMany({});

    await restoreDatabase(db, dump);

    const restored = await db.collection("reservations").findOne({ reservationNumber: "VDM-AAA111" });

    expect(restored).not.toBeNull();

    // Found *by* its ObjectId, which is what a string would have broken.
    expect(await db.collection("reservations").findOne({ _id: reservationId })).not.toBeNull();
    expect(restored!._id).toBeInstanceOf(ObjectId);
    expect(restored!.createdAt).toBeInstanceOf(Date);
    expect((restored!.createdAt as Date).toISOString()).toBe("2026-08-01T10:00:00.000Z");
  });

  it("brings the dish photograph back byte for byte", async () => {
    await seed();
    const before = await db.collection("menucourses").findOne({ name: "Starter" });
    const dump = throughFiles(await dumpDatabase(db));

    // Both, not just the one being checked: the restore refuses to write into
    // a database that still holds anything, which is the point of the default.
    await db.collection("menucourses").deleteMany({});
    await db.collection("reservations").deleteMany({});
    await restoreDatabase(db, dump);

    const after = await db.collection("menucourses").findOne({ name: "Starter" });
    expect(after!.imageUrl).toBe(before!.imageUrl);
  });

  it("refuses to write into a database that already holds data", async () => {
    await seed();
    const dump = throughFiles(await dumpDatabase(db));

    /*
     * The expensive mistake this guards against is pointing a restore at
     * production instead of at the scratch database beside it. Refusing by
     * default costs one flag when the overwrite is meant, and the live data
     * when it is not.
     */
    await expect(restoreDatabase(db, dump)).rejects.toBeInstanceOf(RestoreRefused);
  });

  it("overwrites when that is explicitly what was asked for", async () => {
    await seed();
    const dump = throughFiles(await dumpDatabase(db));

    await db.collection("reservations").updateOne(
      { reservationNumber: "VDM-AAA111" },
      { $set: { guestCount: 99 } },
    );

    await restoreDatabase(db, dump, { mode: "replace" });

    const restored = await db.collection("reservations").findOne({ reservationNumber: "VDM-AAA111" });
    expect(restored!.guestCount).toBe(2);

    // Replaced, not merged: exactly one row, not the backup's beside the live one.
    expect(await db.collection("reservations").countDocuments({})).toBe(1);
  });

  it("leaves alone a collection the backup does not mention", async () => {
    await seed();
    const dump = throughFiles(await dumpDatabase(db));

    // Created after the backup was taken. A restore is not a statement about
    // what should not exist.
    await db.collection("written_later").insertOne({ keep: true });

    await restoreDatabase(db, dump, { mode: "replace" });

    expect(await db.collection("written_later").countDocuments({})).toBe(1);
  });

  it("refuses a backup written by a format it does not read", async () => {
    await seed();
    const dump = throughFiles(await dumpDatabase(db));
    const fromTheFuture = { ...dump, manifest: { ...dump.manifest, format: BACKUP_FORMAT + 1 } };

    await db.collection("reservations").deleteMany({});
    await db.collection("menucourses").deleteMany({});

    await expect(restoreDatabase(db, fromTheFuture)).rejects.toBeInstanceOf(RestoreRefused);
  });
});

describe("what it tells the person running it", () => {
  it("says what the backup holds, so it can be sanity-checked before it is trusted", async () => {
    await seed();
    const { manifest } = await dumpDatabase(db);

    const described = describeManifest(manifest);

    expect(described).toContain("backup-test");
    expect(described).toContain("reservations: 1");
    expect(described).toContain("documents: 2");
  });
});
