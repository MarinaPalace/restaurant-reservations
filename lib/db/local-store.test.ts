import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { promises as fs } from "fs";
import os from "os";
import path from "path";

/**
 * Every test runs against a throwaway directory.
 *
 * The previous storage test wrote to the real `data/menu.json`, so running the
 * suite replaced the restaurant's menu with a fixture called "Test Course".
 */
let temporaryDirectory: string;

beforeEach(async () => {
  temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "reservation-store-"));
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

const SELECTIONS = [
  { guestIndex: 0, courseId: "course-1", courseName: "Starter", optionId: "option-1", optionName: "Salmon" },
];

describe("seat accounting", () => {
  it("consumes seats when a reservation is created", async () => {
    const store = await loadStore();
    await store.upsertLocalDate({ date: "2026-08-18", isOpen: true, capacity: 40 });

    const result = await store.createLocalReservation({
      reservationNumber: "ALC-AAA111",
      roomNumber: "402",
      guestCount: 2,
      date: "2026-08-18",
      selections: SELECTIONS,
    });

    expect(result.ok).toBe(true);

    const date = await store.getLocalDate("2026-08-18");
    expect(date?.reservedSeats).toBe(2);
    expect(date?.remainingSeats).toBe(38);
  });

  it("releases the seats again when the reservation is cancelled", async () => {
    const store = await loadStore();
    await store.upsertLocalDate({ date: "2026-08-18", isOpen: true, capacity: 10 });
    await store.createLocalReservation({
      reservationNumber: "ALC-BBB222",
      roomNumber: "402",
      guestCount: 4,
      date: "2026-08-18",
      selections: SELECTIONS,
    });

    await store.cancelLocalReservation("ALC-BBB222");

    const date = await store.getLocalDate("2026-08-18");
    expect(date?.reservedSeats).toBe(0);
    expect(date?.remainingSeats).toBe(10);
  });

  it("does not refund the seats twice when cancelled twice", async () => {
    const store = await loadStore();
    await store.upsertLocalDate({ date: "2026-08-18", isOpen: true, capacity: 10 });
    await store.createLocalReservation({
      reservationNumber: "ALC-CCC333",
      roomNumber: "402",
      guestCount: 3,
      date: "2026-08-18",
      selections: SELECTIONS,
    });

    await store.cancelLocalReservation("ALC-CCC333");
    await store.cancelLocalReservation("ALC-CCC333");

    expect((await store.getLocalDate("2026-08-18"))?.reservedSeats).toBe(0);
  });

  it("refuses a booking that would exceed capacity", async () => {
    const store = await loadStore();
    await store.upsertLocalDate({ date: "2026-08-18", isOpen: true, capacity: 4 });

    await store.createLocalReservation({
      reservationNumber: "ALC-DDD444",
      roomNumber: "401",
      guestCount: 3,
      date: "2026-08-18",
      selections: SELECTIONS,
    });

    const overflow = await store.createLocalReservation({
      reservationNumber: "ALC-EEE555",
      roomNumber: "402",
      guestCount: 2,
      date: "2026-08-18",
      selections: SELECTIONS,
    });

    expect(overflow).toEqual({ ok: false, reason: "DATE_FULL" });
    expect((await store.getLocalDate("2026-08-18"))?.reservedSeats).toBe(3);
  });

  it("refuses a booking on a closed date", async () => {
    const store = await loadStore();
    await store.upsertLocalDate({ date: "2026-08-20", isOpen: false, capacity: 40 });

    const result = await store.createLocalReservation({
      reservationNumber: "ALC-FFF666",
      roomNumber: "402",
      guestCount: 2,
      date: "2026-08-20",
      selections: SELECTIONS,
    });

    expect(result).toEqual({ ok: false, reason: "DATE_CLOSED" });
  });

  it("cannot oversell the last table to two simultaneous bookings", async () => {
    const store = await loadStore();
    await store.upsertLocalDate({ date: "2026-08-18", isOpen: true, capacity: 2 });

    const [first, second] = await Promise.all([
      store.createLocalReservation({
        reservationNumber: "ALC-GGG777",
        roomNumber: "401",
        guestCount: 2,
        date: "2026-08-18",
        selections: SELECTIONS,
      }),
      store.createLocalReservation({
        reservationNumber: "ALC-HHH888",
        roomNumber: "402",
        guestCount: 2,
        date: "2026-08-18",
        selections: SELECTIONS,
      }),
    ]);

    expect([first.ok, second.ok].filter(Boolean)).toHaveLength(1);
    expect((await store.getLocalDate("2026-08-18"))?.reservedSeats).toBe(2);
  });
});

describe("persistence", () => {
  it("keeps reservations across a restart", async () => {
    const store = await loadStore();
    await store.upsertLocalDate({ date: "2026-08-18", isOpen: true, capacity: 40 });
    await store.createLocalReservation({
      reservationNumber: "ALC-III999",
      roomNumber: "402",
      guestCount: 2,
      date: "2026-08-18",
      selections: SELECTIONS,
    });

    // A fresh module instance stands in for a server restart.
    vi.resetModules();
    const reloaded = await import("@/lib/db/local-store");
    const found = await reloaded.getLocalReservation("ALC-III999");

    expect(found?.roomNumber).toBe("402");
  });

  it("stores the per-guest index with each selection", async () => {
    const store = await loadStore();
    await store.upsertLocalDate({ date: "2026-08-18", isOpen: true, capacity: 40 });
    await store.createLocalReservation({
      reservationNumber: "ALC-JJJ000",
      roomNumber: "402",
      guestCount: 2,
      date: "2026-08-18",
      selections: [
        { guestIndex: 0, courseId: "c1", courseName: "Starter", optionId: "o1", optionName: "Salmon" },
        { guestIndex: 1, courseId: "c1", courseName: "Starter", optionId: "o2", optionName: "Velouté" },
      ],
    });

    const reservation = await store.getLocalReservation("ALC-JJJ000");
    expect(reservation?.selections.map((entry) => entry.guestIndex)).toEqual([0, 1]);
  });
});

describe("menu storage", () => {
  it("seeds a default menu on first read", async () => {
    const store = await loadStore();
    const menu = await store.getLocalMenu();

    expect(menu.length).toBeGreaterThan(0);
    expect(menu[0].options.length).toBeGreaterThan(0);
  });

  it("gives drafted courses and options real ids on save", async () => {
    const store = await loadStore();

    const saved = await store.saveLocalMenu([
      {
        id: "draft-course-1",
        order: 1,
        name: "Amuse Bouche",
        description: "",
        required: true,
        active: true,
        imageUrl: "",
        translations: {},
        options: [
          {
            id: "draft-option-1",
            courseId: "draft-course-1",
            name: "Chef's Selection",
            description: "",
            allergens: [],
            active: true,
            imageUrl: "",
            translations: {},
          },
        ],
      },
    ]);

    expect(saved[0].id).not.toMatch(/^draft-/);
    expect(saved[0].options[0].id).not.toMatch(/^draft-/);
    // The option must stay attached to its course after the id is rewritten.
    expect(saved[0].options[0].courseId).toBe(saved[0].id);
  });

  it("keeps existing ids so reservations keep pointing at the same dish", async () => {
    const store = await loadStore();
    const [course] = await store.getLocalMenu();

    const saved = await store.saveLocalMenu([{ ...course, name: "Renamed course" }]);

    expect(saved[0].id).toBe(course.id);
    expect(saved[0].options[0].id).toBe(course.options[0].id);
    expect(saved[0].name).toBe("Renamed course");
  });
});

describe("several rooms on one booking (local store)", () => {
  it("keeps the extra rooms, and reads their absence as one room", async () => {
    const store = await loadStore();
    await store.upsertLocalDate({ date: "2026-10-20", isOpen: true, capacity: 20 });

    const shared = await store.createLocalReservation({
      reservationNumber: "ALC-SHARE1",
      roomNumber: "402",
      additionalRooms: ["405"],
      guestCount: 3,
      date: "2026-10-20",
      selections: SELECTIONS,
    });

    const alone = await store.createLocalReservation({
      reservationNumber: "ALC-ALONE1",
      roomNumber: "403",
      guestCount: 1,
      date: "2026-10-20",
      selections: SELECTIONS,
    });

    expect(shared.ok && shared.reservation.additionalRooms).toEqual(["405"]);
    expect(alone.ok && alone.reservation.additionalRooms).toBeUndefined();
  });

  it("adds, keeps and clears the extra rooms on an edit", async () => {
    const store = await loadStore();
    await store.upsertLocalDate({ date: "2026-10-21", isOpen: true, capacity: 20 });
    await store.createLocalReservation({
      reservationNumber: "ALC-SHARE2",
      roomNumber: "402",
      guestCount: 2,
      date: "2026-10-21",
      selections: SELECTIONS,
    });

    const added = await store.updateLocalReservationDetails("ALC-SHARE2", { additionalRooms: ["405"] });
    expect(added.ok && added.reservation.additionalRooms).toEqual(["405"]);

    // An edit that says nothing about the rooms leaves them alone …
    const untouched = await store.updateLocalReservationDetails("ALC-SHARE2", { notes: "Window table" });
    expect(untouched.ok && untouched.reservation.additionalRooms).toEqual(["405"]);

    // … while an empty list means the room was taken off the booking.
    const cleared = await store.updateLocalReservationDetails("ALC-SHARE2", { additionalRooms: [] });
    expect(cleared.ok && cleared.reservation.additionalRooms).toBeUndefined();
  });
});

describe("staff edits (local store)", () => {
  async function book(store: Awaited<ReturnType<typeof loadStore>>, date: string, guestCount: number) {
    const result = await store.createLocalReservation({
      reservationNumber: `ALC-${date.slice(-2)}${guestCount}`,
      roomNumber: "402",
      guestCount,
      date,
      selections: SELECTIONS,
    });

    if (!result.ok) {
      throw new Error(`booking failed: ${result.reason}`);
    }
    return result.reservation;
  }

  it("moves the seats when a booking changes evening", async () => {
    const store = await loadStore();
    await store.upsertLocalDate({ date: "2026-11-01", isOpen: true, capacity: 20, serviceTime: "19:30" });
    await store.upsertLocalDate({ date: "2026-11-02", isOpen: true, capacity: 20, serviceTime: "18:00" });

    const created = await book(store, "2026-11-01", 2);
    const result = await store.updateLocalReservationDetails(created.reservationNumber, { date: "2026-11-02" });

    expect(result.ok).toBe(true);
    expect((await store.getLocalDate("2026-11-01"))?.reservedSeats).toBe(0);
    expect((await store.getLocalDate("2026-11-02"))?.reservedSeats).toBe(2);
    // The booking adopts the new evening's sitting time.
    expect(result.ok && result.reservation.time).toBe("18:00");
  });

  it("adjusts seats when the party grows or shrinks", async () => {
    const store = await loadStore();
    await store.upsertLocalDate({ date: "2026-11-03", isOpen: true, capacity: 10 });

    const created = await book(store, "2026-11-03", 2);

    await store.updateLocalReservationDetails(created.reservationNumber, { guestCount: 5 });
    expect((await store.getLocalDate("2026-11-03"))?.reservedSeats).toBe(5);

    await store.updateLocalReservationDetails(created.reservationNumber, { guestCount: 1 });
    expect((await store.getLocalDate("2026-11-03"))?.reservedSeats).toBe(1);
  });

  it("counts only the extra guests against a nearly full evening", async () => {
    const store = await loadStore();
    await store.upsertLocalDate({ date: "2026-11-04", isOpen: true, capacity: 4 });

    const created = await book(store, "2026-11-04", 3);
    const result = await store.updateLocalReservationDetails(created.reservationNumber, { guestCount: 4 });

    expect(result.ok).toBe(true);
    expect((await store.getLocalDate("2026-11-04"))?.reservedSeats).toBe(4);
  });

  it("refuses a move that would oversell, leaving both evenings untouched", async () => {
    const store = await loadStore();
    await store.upsertLocalDate({ date: "2026-11-05", isOpen: true, capacity: 20 });
    await store.upsertLocalDate({ date: "2026-11-06", isOpen: true, capacity: 2 });

    const created = await book(store, "2026-11-05", 3);
    const result = await store.updateLocalReservationDetails(created.reservationNumber, { date: "2026-11-06" });

    expect(result).toMatchObject({ ok: false, reason: "DATE_FULL" });
    expect((await store.getLocalDate("2026-11-05"))?.reservedSeats).toBe(3);
    expect((await store.getLocalDate("2026-11-06"))?.reservedSeats).toBe(0);
  });

  it("refuses a move to a closed evening", async () => {
    const store = await loadStore();
    await store.upsertLocalDate({ date: "2026-11-07", isOpen: true, capacity: 20 });
    await store.upsertLocalDate({ date: "2026-11-08", isOpen: false, capacity: 20 });

    const created = await book(store, "2026-11-07", 1);
    const result = await store.updateLocalReservationDetails(created.reservationNumber, { date: "2026-11-08" });

    expect(result).toMatchObject({ ok: false, reason: "DATE_CLOSED" });
  });

  it("does not move seats for a cancelled booking", async () => {
    const store = await loadStore();
    await store.upsertLocalDate({ date: "2026-11-09", isOpen: true, capacity: 20 });
    await store.upsertLocalDate({ date: "2026-11-10", isOpen: true, capacity: 20 });

    const created = await book(store, "2026-11-09", 2);
    await store.cancelLocalReservation(created.reservationNumber);
    await store.updateLocalReservationDetails(created.reservationNumber, { date: "2026-11-10" });

    expect((await store.getLocalDate("2026-11-09"))?.reservedSeats).toBe(0);
    expect((await store.getLocalDate("2026-11-10"))?.reservedSeats).toBe(0);
  });

  it("reports a reservation that does not exist", async () => {
    const store = await loadStore();
    expect(await store.updateLocalReservationDetails("ALC-NOPE00", { guestCount: 1 })).toMatchObject({
      ok: false,
      reason: "NOT_FOUND",
    });
  });
});
