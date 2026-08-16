import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { promises as fs } from "fs";
import os from "os";
import path from "path";

/**
 * Restoring a cancelled booking, and the pass-key lifecycle around it.
 *
 * These two are tested together because they are the same problem: a
 * cancellation gives something back — seats to the evening, the key to the
 * guest — and undoing it has to take both again, or fail cleanly.
 */

let temporaryDirectory: string;

beforeEach(async () => {
  temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "reservation-restore-"));
  process.env.LOCAL_STORE_DIR = temporaryDirectory;
});

afterEach(async () => {
  delete process.env.LOCAL_STORE_DIR;
  await fs.rm(temporaryDirectory, { recursive: true, force: true });
});

async function loadStore() {
  // Imported fresh per test so the module-level lock starts clean.
  return import("@/lib/db/local-store");
}

async function loadAdminStore() {
  return import("@/lib/db/local-admin-store");
}

const SELECTIONS = [
  { guestIndex: 0, courseId: "course-1", courseName: "Starter", optionId: "option-1", optionName: "Salmon" },
];

async function bookedEvening(guestCount = 4, capacity = 10) {
  const store = await loadStore();
  await store.upsertLocalDate({ date: "2026-08-18", isOpen: true, capacity });
  await store.createLocalReservation({
    reservationNumber: "VDM-AAA111",
    roomNumber: "402",
    guestCount,
    date: "2026-08-18",
    selections: SELECTIONS,
  });
  return store;
}

describe("restoring a cancelled reservation", () => {
  it("takes the seats back", async () => {
    const store = await bookedEvening();

    await store.cancelLocalReservation("VDM-AAA111");
    expect((await store.getLocalDate("2026-08-18"))?.reservedSeats).toBe(0);

    const result = await store.restoreLocalReservation("VDM-AAA111");

    expect(result.ok).toBe(true);
    expect((await store.getLocalReservation("VDM-AAA111"))?.status).toBe("confirmed");
    expect((await store.getLocalDate("2026-08-18"))?.reservedSeats).toBe(4);
  });

  /**
   * The seats went back into the pool when this was cancelled, so somebody
   * else may have taken them. Restoring must not push the evening over
   * capacity.
   */
  it("refuses when the evening filled up in the meantime", async () => {
    const store = await bookedEvening(4, 10);
    await store.cancelLocalReservation("VDM-AAA111");

    // Another party takes almost everything that was released.
    await store.createLocalReservation({
      reservationNumber: "VDM-BBB222",
      roomNumber: "L10",
      guestCount: 8,
      date: "2026-08-18",
      selections: SELECTIONS,
    });

    const result = await store.restoreLocalReservation("VDM-AAA111");

    expect(result).toMatchObject({ ok: false, reason: "DATE_FULL" });
    expect((await store.getLocalReservation("VDM-AAA111"))?.status).toBe("cancelled");
    // Nothing was taken on the way to failing.
    expect((await store.getLocalDate("2026-08-18"))?.reservedSeats).toBe(8);
  });

  it("refuses when the evening has since been closed", async () => {
    const store = await bookedEvening();
    await store.cancelLocalReservation("VDM-AAA111");
    await store.upsertLocalDate({ date: "2026-08-18", isOpen: false, capacity: 10 });

    expect(await store.restoreLocalReservation("VDM-AAA111")).toMatchObject({
      ok: false,
      reason: "DATE_CLOSED",
    });
  });

  it("refuses to restore a booking that is not cancelled", async () => {
    const store = await bookedEvening();

    expect(await store.restoreLocalReservation("VDM-AAA111")).toMatchObject({
      ok: false,
      reason: "NOT_CANCELLED",
    });
    // Restoring a live booking twice would otherwise claim its seats again.
    expect((await store.getLocalDate("2026-08-18"))?.reservedSeats).toBe(4);
  });

  it("reports a booking that does not exist", async () => {
    const store = await loadStore();
    expect(await store.restoreLocalReservation("VDM-NOPE00")).toMatchObject({
      ok: false,
      reason: "NOT_FOUND",
    });
  });

  /** Restoring drops the cancellation note; the audit log keeps the history. */
  it("clears the record of who cancelled it", async () => {
    const store = await bookedEvening();

    await store.cancelLocalReservation("VDM-AAA111", {
      at: new Date().toISOString(),
      actorKind: "staff",
      actorName: "Maria Petrova",
    });

    expect((await store.getLocalReservation("VDM-AAA111"))?.cancellation?.actorName).toBe("Maria Petrova");

    await store.restoreLocalReservation("VDM-AAA111");
    expect((await store.getLocalReservation("VDM-AAA111"))?.cancellation).toBeUndefined();
  });
});

describe("cancellation records who did it", () => {
  it("keeps the actor on the booking", async () => {
    const store = await bookedEvening();

    const cancelled = await store.cancelLocalReservation("VDM-AAA111", {
      at: "2026-08-17T10:00:00.000Z",
      actorKind: "guest",
      actorId: "key-1",
      actorName: "Guest in room 402",
      reason: "Changed plans",
    });

    expect(cancelled?.cancellation).toEqual({
      at: "2026-08-17T10:00:00.000Z",
      actorKind: "guest",
      actorId: "key-1",
      actorName: "Guest in room 402",
      reason: "Changed plans",
    });
  });
});

describe("pass-keys", () => {
  async function activeKey() {
    const admin = await loadAdminStore();
    const created = await admin.createLocalPassKey({
      code: "K7QP3M2XR4TN",
      roomNumber: "402",
      nights: 7,
      expiresOn: "2026-08-25",
      status: "active",
    });

    if (!created.ok) {
      throw new Error("could not create the key");
    }

    return { admin, key: created.key };
  }

  it("can only be spent once", async () => {
    const { admin, key } = await activeKey();

    expect(await admin.consumeLocalPassKey(key.code, "VDM-AAA111")).toMatchObject({ status: "used" });
    // The second attempt finds nothing active to spend.
    expect(await admin.consumeLocalPassKey(key.code, "VDM-BBB222")).toBeNull();
  });

  it("is handed back when the booking it paid for is cancelled", async () => {
    const { admin, key } = await activeKey();
    await admin.consumeLocalPassKey(key.code, "VDM-AAA111");

    const released = await admin.releaseLocalPassKey(key.id, "VDM-AAA111");

    expect(released).toMatchObject({ status: "active" });
    // And can be spent again on a new evening.
    expect(await admin.consumeLocalPassKey(key.code, "VDM-CCC333")).toMatchObject({ status: "used" });
  });

  /**
   * A late request must not free a key that has since been spent on a
   * different booking, or the guest would get a second dinner out of it.
   */
  it("is only released from the booking it was actually spent on", async () => {
    const { admin, key } = await activeKey();
    await admin.consumeLocalPassKey(key.code, "VDM-AAA111");

    expect(await admin.releaseLocalPassKey(key.id, "VDM-SOMETHINGELSE")).toBeNull();
    expect((await admin.getLocalPassKey(key.id))?.status).toBe("used");
  });

  it("is taken again when a cancellation is undone", async () => {
    const { admin, key } = await activeKey();
    await admin.consumeLocalPassKey(key.code, "VDM-AAA111");
    await admin.releaseLocalPassKey(key.id, "VDM-AAA111");

    expect(await admin.reclaimLocalPassKey(key.id, "VDM-AAA111")).toMatchObject({
      status: "used",
      reservationNumber: "VDM-AAA111",
    });
  });

  it("cannot be reclaimed once the guest has spent it on something else", async () => {
    const { admin, key } = await activeKey();
    await admin.consumeLocalPassKey(key.code, "VDM-AAA111");
    await admin.releaseLocalPassKey(key.id, "VDM-AAA111");
    await admin.consumeLocalPassKey(key.code, "VDM-CCC333");

    expect(await admin.reclaimLocalPassKey(key.id, "VDM-AAA111")).toBeNull();
    expect((await admin.getLocalPassKey(key.id))?.reservationNumber).toBe("VDM-CCC333");
  });

  it("cannot be spent once revoked", async () => {
    const { admin, key } = await activeKey();
    await admin.revokeLocalPassKey(key.id);

    expect(await admin.consumeLocalPassKey(key.code, "VDM-AAA111")).toBeNull();
  });
});
