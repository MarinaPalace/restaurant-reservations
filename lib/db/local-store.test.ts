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

/**
 * How late a guest may book, per evening. Additive and optional (rule 2.2), so
 * a date written before this existed reads as 0 — bookings close when the
 * sitting starts, which is what it always did.
 */
describe("the guest booking cutoff", () => {
  it("keeps the cutoff across a restart", async () => {
    const store = await loadStore();
    await store.upsertLocalDate({
      date: "2026-08-25",
      isOpen: true,
      capacity: 40,
      serviceTime: "19:00",
      bookingCutoffHours: 6,
    });

    const reloaded = await import("@/lib/db/local-store");
    const dates = await reloaded.getLocalDates();

    expect(dates.find((entry) => entry.date === "2026-08-25")?.bookingCutoffHours).toBe(6);
  });

  it("reads a date saved without one as no cutoff", async () => {
    const store = await loadStore();
    await store.upsertLocalDate({ date: "2026-08-26", isOpen: true, capacity: 40 });

    const saved = await store.getLocalDate("2026-08-26");
    expect(saved?.bookingCutoffHours ?? 0).toBe(0);
  });

  it("does not lose the seats already taken when the cutoff changes", async () => {
    const store = await loadStore();
    await store.upsertLocalDate({ date: "2026-08-27", isOpen: true, capacity: 40, serviceTime: "19:00" });
    await store.createLocalReservation({
      reservationNumber: "VDM-CUT001",
      roomNumber: "402",
      guestCount: 2,
      date: "2026-08-27",
      selections: SELECTIONS,
    });

    await store.upsertLocalDate({
      date: "2026-08-27",
      isOpen: true,
      capacity: 40,
      serviceTime: "19:00",
      bookingCutoffHours: 3,
    });

    const saved = await store.getLocalDate("2026-08-27");
    expect(saved?.reservedSeats).toBe(2);
    expect(saved?.bookingCutoffHours).toBe(3);
  });
});

/**
 * The service board's two fields.
 *
 * Attendance is a permanent record; service progress is operational. Both are
 * additive and optional (rule 2.2), so a booking written before either existed
 * reads as "not arrived, nothing served".
 */
describe("attendance and service progress", () => {
  async function seedBooking(store: Awaited<ReturnType<typeof loadStore>>, number = "VDM-SVC001") {
    await store.upsertLocalDate({ date: "2026-08-25", isOpen: true, capacity: 40 });
    await store.createLocalReservation({
      reservationNumber: number,
      roomNumber: "402",
      guestCount: 2,
      date: "2026-08-25",
      selections: SELECTIONS,
    });
    return number;
  }

  it("reads a booking written before these existed as unknown", async () => {
    const store = await loadStore();
    const number = await seedBooking(store);
    const saved = await store.getLocalReservation(number);

    expect(saved?.attendance).toBeUndefined();
    expect(saved?.service).toBeUndefined();
  });

  it("keeps an attendance mark across a restart", async () => {
    const store = await loadStore();
    const number = await seedBooking(store);

    await store.updateLocalReservationAttendance(number, {
      status: "seated",
      at: "2026-08-25T17:00:00.000Z",
      byName: "Ivan",
      guests: 2,
    });

    const reloaded = await import("@/lib/db/local-store");
    expect((await reloaded.getLocalReservation(number))?.attendance).toMatchObject({
      status: "seated",
      byName: "Ivan",
    });
  });

  /** Undoing a mis-tap returns it to unknown, never to the other claim. */
  it("clears an attendance mark back to unknown", async () => {
    const store = await loadStore();
    const number = await seedBooking(store);

    await store.updateLocalReservationAttendance(number, {
      status: "no-show",
      at: "2026-08-25T19:30:00.000Z",
      byName: "Ivan",
    });
    await store.updateLocalReservationAttendance(number, null);

    expect((await store.getLocalReservation(number))?.attendance).toBeUndefined();
  });

  it("marks one course served without disturbing another", async () => {
    const store = await loadStore();
    const number = await seedBooking(store);

    await store.updateLocalReservationCourseServed(number, "course-1", "2026-08-25T18:04:00.000Z");
    await store.updateLocalReservationCourseServed(number, "course-2", "2026-08-25T19:00:00.000Z");

    const saved = await store.getLocalReservation(number);
    expect(saved?.service?.servedAt).toEqual({
      "course-1": "2026-08-25T18:04:00.000Z",
      "course-2": "2026-08-25T19:00:00.000Z",
    });
  });

  it("unmarks one course and leaves the rest", async () => {
    const store = await loadStore();
    const number = await seedBooking(store);

    await store.updateLocalReservationCourseServed(number, "course-1", "2026-08-25T18:04:00.000Z");
    await store.updateLocalReservationCourseServed(number, "course-2", "2026-08-25T19:00:00.000Z");
    await store.updateLocalReservationCourseServed(number, "course-1", null);

    expect((await store.getLocalReservation(number))?.service?.servedAt).toEqual({
      "course-2": "2026-08-25T19:00:00.000Z",
    });
  });

  /**
   * Two waiters marking different courses on the same table at the same moment
   * must both land. A read-modify-write outside the lock would lose one.
   */
  it("does not lose a mark when two land at once", async () => {
    const store = await loadStore();
    const number = await seedBooking(store);

    await Promise.all([
      store.updateLocalReservationCourseServed(number, "course-1", "2026-08-25T18:04:00.000Z"),
      store.updateLocalReservationCourseServed(number, "course-2", "2026-08-25T18:05:00.000Z"),
      store.updateLocalReservationCourseServed(number, "course-3", "2026-08-25T18:06:00.000Z"),
    ]);

    expect(Object.keys((await store.getLocalReservation(number))?.service?.servedAt ?? {})).toHaveLength(3);
  });

  it("leaves the rest of the booking untouched", async () => {
    const store = await loadStore();
    const number = await seedBooking(store);

    await store.updateLocalReservationAttendance(number, {
      status: "seated",
      at: "2026-08-25T17:00:00.000Z",
      byName: "Ivan",
    });

    const saved = await store.getLocalReservation(number);
    expect(saved?.selections).toHaveLength(SELECTIONS.length);
    expect(saved?.guestCount).toBe(2);
  });
});

/**
 * Plates, per guest.
 *
 * The unit the board works in once a table has a guest with an allergy: "guest
 * 2's main is out" is a different fact from "the main course is out".
 */
describe("per-guest plates", () => {
  async function seedBooking(store: Awaited<ReturnType<typeof loadStore>>, number = "VDM-PLT001") {
    await store.upsertLocalDate({ date: "2026-08-25", isOpen: true, capacity: 40 });
    await store.createLocalReservation({
      reservationNumber: number,
      roomNumber: "402",
      guestCount: 2,
      date: "2026-08-25",
      selections: SELECTIONS,
    });
    return number;
  }

  it("marks one guest's plate without touching the other", async () => {
    const store = await loadStore();
    const number = await seedBooking(store);

    await store.updateLocalReservationGuestServed(number, "course-1", 0, "2026-08-25T18:04:00.000Z");

    expect((await store.getLocalReservation(number))?.service?.servedGuests).toEqual({
      "course-1": { "0": "2026-08-25T18:04:00.000Z" },
    });
  });

  it("unmarks one plate and leaves the rest", async () => {
    const store = await loadStore();
    const number = await seedBooking(store);

    await store.updateLocalReservationGuestServed(number, "course-1", 0, "2026-08-25T18:04:00.000Z");
    await store.updateLocalReservationGuestServed(number, "course-1", 1, "2026-08-25T18:05:00.000Z");
    await store.updateLocalReservationGuestServed(number, "course-1", 0, null);

    expect((await store.getLocalReservation(number))?.service?.servedGuests?.["course-1"]).toEqual({
      "1": "2026-08-25T18:05:00.000Z",
    });
  });

  /** Two waiters, two guests, one course. Neither may lose the other. */
  it("does not lose a plate when several land at once", async () => {
    const store = await loadStore();
    const number = await seedBooking(store);

    await Promise.all([
      store.updateLocalReservationGuestServed(number, "course-1", 0, "2026-08-25T18:04:00.000Z"),
      store.updateLocalReservationGuestServed(number, "course-1", 1, "2026-08-25T18:04:30.000Z"),
      store.updateLocalReservationGuestServed(number, "course-2", 0, "2026-08-25T19:00:00.000Z"),
    ]);

    const saved = await store.getLocalReservation(number);
    expect(Object.keys(saved?.service?.servedGuests?.["course-1"] ?? {})).toHaveLength(2);
    expect(Object.keys(saved?.service?.servedGuests?.["course-2"] ?? {})).toHaveLength(1);
  });

  it("marks a whole course's guests in one go", async () => {
    const store = await loadStore();
    const number = await seedBooking(store);

    await store.updateLocalReservationCourseGuests(number, "course-1", [0, 1], "2026-08-25T18:04:00.000Z");

    expect((await store.getLocalReservation(number))?.service?.servedGuests?.["course-1"]).toEqual({
      "0": "2026-08-25T18:04:00.000Z",
      "1": "2026-08-25T18:04:00.000Z",
    });
  });

  /** A legacy whole-course mark must not linger and contradict the detail. */
  it("clears the legacy whole-course mark when the course is re-marked", async () => {
    const store = await loadStore();
    const number = await seedBooking(store);

    await store.updateLocalReservationCourseServed(number, "course-1", "2026-08-25T18:00:00.000Z");
    await store.updateLocalReservationCourseGuests(number, "course-1", [0, 1], null);

    const saved = await store.getLocalReservation(number);
    expect(saved?.service?.servedAt?.["course-1"]).toBeUndefined();
    expect(saved?.service?.servedGuests?.["course-1"]).toEqual({});
  });
});
