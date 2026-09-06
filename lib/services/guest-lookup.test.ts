import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { toDateKey } from "@/lib/date";
import { formatPassKey } from "@/lib/pass-key";
import type { MenuCourse, MenuOption } from "@/types/booking";

/**
 * Finding a guest at the desk, from whatever they can show.
 *
 * The point of the search is that reception does not have to know what they
 * are holding. So every case here starts from a *different* string and expects
 * the same guest out of it — a scanned card, a code read aloud, the hotel's
 * reference, and the reservation number off a confirmation.
 */

let temporaryDirectory: string;

beforeEach(async () => {
  temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "guest-lookup-"));
  process.env.LOCAL_STORE_DIR = temporaryDirectory;
});

afterEach(async () => {
  delete process.env.LOCAL_STORE_DIR;
  await fs.rm(temporaryDirectory, { recursive: true, force: true });
});

const ACTOR = { kind: "staff", id: "u1", name: "Reception" } as const;

function eveningInAWeek() {
  const day = new Date();
  day.setDate(day.getDate() + 7);
  return toDateKey(day);
}

function option(name: string): MenuOption {
  return {
    id: "",
    courseId: "",
    name,
    description: "",
    allergens: [],
    active: true,
    imageUrl: "",
    translations: {},
  };
}

function course(name: string, options: MenuOption[]): MenuCourse {
  return {
    id: "",
    order: 1,
    name,
    description: "",
    required: true,
    active: true,
    imageUrl: "",
    translations: {},
    options,
  };
}

/** A guest who has checked in, booked one dinner, and is standing at the desk. */
async function setUp({ withBooking = true } = {}) {
  const restaurant = await import("@/lib/services/restaurant");
  const reservations = await import("@/lib/services/reservations");
  const passKeys = await import("@/lib/services/pass-keys");

  const EVENING = eveningInAWeek();

  await restaurant.saveMenuCatalog([course("Main", [option("Sea bass")])], "standard");
  await reservations.updateRestaurantDate({ date: EVENING, isOpen: true, capacity: 40 });

  const key = await passKeys.issuePassKey({
    roomNumber: "402",
    guestName: "A. Guest",
    reservationRef: "10245",
    checkInOn: toDateKey(new Date()),
    expiresOn: EVENING,
    actor: ACTOR,
  });

  if (!withBooking) {
    return { EVENING, key, reservationNumber: "" };
  }

  const [main] = await restaurant.getMenuCatalog();
  const spent = await passKeys.consumePassKey(key.code, "VDM-TEST01");

  const reservation = await reservations.createReservationEntry({
    reservationNumber: "VDM-TEST01",
    roomNumber: "402",
    guestCount: 2,
    date: EVENING,
    selections: [
      {
        guestIndex: 0,
        courseId: main.id,
        courseName: main.name,
        optionId: main.options[0].id,
        optionName: main.options[0].name,
      },
    ],
    passKeyId: spent!.id,
  });

  return { EVENING, key, reservationNumber: reservation.reservationNumber };
}

describe("finding a guest from what they hand over", () => {
  it("finds them from a scanned pass-key card", async () => {
    const { key, reservationNumber } = await setUp();
    const { findGuestBy } = await import("@/lib/services/guest-lookup");

    const found = await findGuestBy(
      `https://dine.example.com/booking?k=${formatPassKey(key.code)}`,
    );

    expect(found.matches).toHaveLength(1);
    expect(found.matches[0].passKey.id).toBe(key.id);
    expect(found.matches[0].reservations.map((entry) => entry.reservationNumber)).toEqual([
      reservationNumber,
    ]);
  });

  it("finds them from a pass-key read aloud and typed", async () => {
    const { key } = await setUp();
    const { findGuestBy } = await import("@/lib/services/guest-lookup");

    const found = await findGuestBy(formatPassKey(key.code).toLowerCase());
    expect(found.matches[0]?.passKey.id).toBe(key.id);
  });

  it("finds them from the hotel's own booking reference", async () => {
    const { key } = await setUp();
    const { findGuestBy } = await import("@/lib/services/guest-lookup");

    const found = await findGuestBy("10245");
    expect(found.matches[0]?.passKey.id).toBe(key.id);
  });

  /**
   * The scanned confirmation card. A reservation number identifies one dinner,
   * but what reception is asked about is the *guest* — so the number is
   * followed back to the key and everything else on it comes too.
   */
  it("finds the whole guest from one reservation number", async () => {
    const { key, reservationNumber } = await setUp();
    const { findGuestBy } = await import("@/lib/services/guest-lookup");

    const found = await findGuestBy(reservationNumber);

    expect(found.matches).toHaveLength(1);
    expect(found.matches[0].passKey.id).toBe(key.id);
    expect(found.matches[0].reservations).toHaveLength(1);
  });

  it("finds a guest who has a key but has not booked yet", async () => {
    const { key } = await setUp({ withBooking: false });
    const { findGuestBy } = await import("@/lib/services/guest-lookup");

    const found = await findGuestBy(formatPassKey(key.code));

    expect(found.matches[0]?.passKey.id).toBe(key.id);
    expect(found.matches[0]?.reservations).toEqual([]);
  });

  /**
   * "Nothing found" is a real answer the desk needs to read, and it must not
   * arrive as an error — the person is mid-conversation with a guest.
   */
  it("returns nothing rather than failing for a code that is not ours", async () => {
    await setUp();
    const { findGuestBy } = await import("@/lib/services/guest-lookup");

    const found = await findGuestBy("VDM-000000");

    expect(found.matches).toEqual([]);
    expect(found.orphanReservations).toEqual([]);
  });
});

describe("the conversation this page exists for", () => {
  /**
   * A guest is certain they booked. There is no booking. Before this there was
   * nothing to check and no way to be fair to either side.
   */
  it("shows what the guest started and never finished", async () => {
    const { EVENING, key } = await setUp({ withBooking: false });
    const { holdSeats, advanceSeatHoldStep, sweepExpiredHolds } = await import(
      "@/lib/services/seat-holds"
    );
    const { findGuestBy } = await import("@/lib/services/guest-lookup");

    const hold = await holdSeats({
      date: EVENING,
      guests: 2,
      passKeyId: key.id,
      roomNumber: "402",
    });
    await advanceSeatHoldStep(hold.holdId, "menu");

    // Their fifteen minutes run out.
    const holdsFile = path.join(temporaryDirectory, "seat-holds.json");
    const holds = JSON.parse(await fs.readFile(holdsFile, "utf8"));
    holds[0].expiresAt = new Date(Date.now() - 60_000).toISOString();
    await fs.writeFile(holdsFile, JSON.stringify(holds, null, 2), "utf8");
    await sweepExpiredHolds(EVENING);

    const found = await findGuestBy(formatPassKey(key.code));

    expect(found.matches[0].reservations).toEqual([]);
    expect(found.matches[0].unfinished).toHaveLength(1);
    expect(found.matches[0].unfinished[0]).toMatchObject({
      date: EVENING,
      guests: 2,
      step: "menu",
      status: "abandoned",
    });
  });

  /** A guest who finished has nothing in the unfinished list. */
  it("shows nothing unfinished for a booking that worked", async () => {
    const { key } = await setUp();
    const { findGuestBy } = await import("@/lib/services/guest-lookup");

    const found = await findGuestBy(formatPassKey(key.code));

    expect(found.matches[0].reservations).toHaveLength(1);
    expect(found.matches[0].unfinished).toEqual([]);
  });
});

describe("what the desk is allowed to see", () => {
  /**
   * A reservation number is not a secret — guests read it aloud to other rooms
   * so they can be seated together, which is exactly why guest self-service
   * refuses to identify a booking by one. This page resolves a number back to
   * its key, so returning the code would have handed anybody who overheard a
   * number the one credential that cancels that guest's dinner, through any
   * signed-in account including the tablet at the pass.
   */
  it("never returns the pass-key code", async () => {
    const { key, reservationNumber } = await setUp();
    const { findGuestBy } = await import("@/lib/services/guest-lookup");

    for (const query of [reservationNumber, "10245", formatPassKey(key.code)]) {
      const found = await findGuestBy(query);
      const [match] = found.matches;

      expect(match).toBeDefined();
      // Not merely absent from the screen — absent from the payload.
      expect(JSON.stringify(match.passKey)).not.toContain(key.code);
      expect((match.passKey as Record<string, unknown>).code).toBeUndefined();
    }
  });

  /** And still says everything reception actually needs. */
  it("says whose key it is and whether it still works", async () => {
    const { key } = await setUp();
    const { findGuestBy } = await import("@/lib/services/guest-lookup");

    const [match] = (await findGuestBy("10245")).matches;

    expect(match.passKey).toMatchObject({
      id: key.id,
      roomNumber: "402",
      guestName: "A. Guest",
      reservationRef: "10245",
      // Spent on the booking in the setup. A used key is still the guest's
      // key — they need it to change or cancel — so the desk sees it plainly
      // rather than being told there is nothing here.
      status: "used",
    });
    expect(match.passKey.usedCount).toBe(1);
  });
});
