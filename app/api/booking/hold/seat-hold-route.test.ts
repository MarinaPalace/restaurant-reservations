import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import type { MenuCourse, MenuOption } from "@/types/booking";
import { toDateKey } from "@/lib/date";

/**
 * The evening that is nearly full, and the two guests booking at once.
 *
 * This is the bug the whole feature was written for, played out end to end
 * through the real routes. It used to go like this: an evening with four seats
 * left, two guests start booking, the first finishes, and the second — who did
 * nothing wrong and had been shown four seats the whole way — is put back on
 * the calendar with **no message at all**. No error, no warning, nothing to
 * say what had happened or whether it was their fault.
 *
 * Two things are asserted here, and the second matters as much as the first:
 *
 * 1. The second guest is stopped **at the calendar**, when they have chosen
 *    nothing, rather than at the end after picking a table and six courses.
 * 2. Whenever a booking is refused, the answer carries a `code` the screen can
 *    turn into a sentence. Nothing is ever refused silently.
 */

let temporaryDirectory: string;

beforeEach(async () => {
  temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "seat-hold-"));
  process.env.LOCAL_STORE_DIR = temporaryDirectory;

  const { resetRateLimits } = await import("@/lib/rate-limit");
  resetRateLimits();
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

function option(name: string, extra: Partial<MenuOption> = {}): MenuOption {
  return {
    id: "",
    courseId: "",
    name,
    description: "",
    allergens: [],
    active: true,
    imageUrl: "",
    translations: {},
    ...extra,
  };
}

function course(name: string, options: MenuOption[], extra: Partial<MenuCourse> = {}): MenuCourse {
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
    ...extra,
  };
}

function json(url: string, body: unknown, method = "POST") {
  return new Request(`http://localhost${url}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** An evening with a menu on it, and two rooms holding keys for it. */
async function setUp(capacity: number) {
  const restaurant = await import("@/lib/services/restaurant");
  const reservations = await import("@/lib/services/reservations");
  const passKeys = await import("@/lib/services/pass-keys");

  const EVENING = eveningInAWeek();

  await restaurant.saveMenuCatalog([course("Main", [option("Sea bass"), option("Lamb")])], "standard");
  await reservations.updateRestaurantDate({ date: EVENING, isOpen: true, capacity });

  const first = await passKeys.issuePassKey({
    roomNumber: "402",
    checkInOn: toDateKey(new Date()),
    expiresOn: EVENING,
    actor: ACTOR,
  });

  const second = await passKeys.issuePassKey({
    roomNumber: "403",
    checkInOn: toDateKey(new Date()),
    expiresOn: EVENING,
    actor: ACTOR,
  });

  const [main] = await restaurant.getMenuCatalog();

  return { EVENING, first, second, main, restaurant };
}

function choicesFor(main: MenuCourse, guests: number) {
  return Array.from({ length: guests }, (_, guestIndex) => ({
    guestIndex,
    courseId: main.id,
    courseName: main.name,
    optionId: main.options[0].id,
    optionName: main.options[0].name,
  }));
}

describe("two guests, four seats left", () => {
  /**
   * The reported bug, and the thing that must never happen again. The second
   * guest hears "no" on the calendar — where they have chosen nothing and
   * choosing again is the obvious next step — instead of after the menu.
   */
  it("stops the second guest at the calendar, not at the end", async () => {
    const { EVENING, first, second } = await setUp(4);
    const { POST: hold } = await import("@/app/api/booking/hold/route");

    const firstHold = await hold(
      json("/api/booking/hold", { passKey: first.code, date: EVENING, guestCount: 4 }),
    );
    expect(firstHold.status).toBe(200);

    const secondHold = await hold(
      json("/api/booking/hold", { passKey: second.code, date: EVENING, guestCount: 4 }),
    );

    expect(secondHold.status).toBe(409);

    // And it says why, in a form the screen can translate. A refusal with no
    // code is a refusal the guest reads as nothing happening.
    const refusal = await secondHold.json();
    expect(refusal.code).toBe("DATE_FULL");
    expect(refusal.error).toBeTruthy();
  });

  /**
   * And the guest who did get the seats keeps them all the way through, however
   * long they spend on the menu. This is the other half of the promise: holding
   * seats is worth nothing if somebody else can still book them.
   */
  it("keeps the first guest's seats safe while they choose", async () => {
    const { EVENING, first, second, main, restaurant } = await setUp(4);
    const { POST: hold } = await import("@/app/api/booking/hold/route");
    const { POST: book } = await import("@/app/api/reservations/route");

    const held = await hold(
      json("/api/booking/hold", { passKey: first.code, date: EVENING, guestCount: 4 }),
    );
    const { hold: receipt } = await held.json();

    // The second guest tries to book outright, with no hold — the shape of a
    // request from a screen older than this feature, or a hand-made one.
    const jumped = await book(
      json("/api/reservations", {
        passKey: second.code,
        roomNumber: "403",
        guestCount: 4,
        date: EVENING,
        contact: { method: "email", email: "other@example.com" },
        selections: choicesFor(main, 4),
      }),
    );

    // Refused, because held seats count against the room exactly as booked
    // ones do — and refused with a code, not in silence.
    expect(jumped.status).toBe(409);
    expect((await jumped.json()).code).toBe("DATE_UNAVAILABLE");

    // The first guest finishes at their own pace and gets the table.
    const booked = await book(
      json("/api/reservations", {
        passKey: first.code,
        roomNumber: "402",
        guestCount: 4,
        date: EVENING,
        contact: { method: "email", email: "guest@example.com" },
        selections: choicesFor(main, 4),
        holdId: receipt.holdId,
      }),
    );

    expect(booked.status).toBe(201);

    // The seats moved from held to booked, and nothing was counted twice.
    const evening = await restaurant.getRestaurantDate(EVENING);
    expect(evening?.reservedSeats).toBe(4);
    expect(evening?.heldSeats ?? 0).toBe(0);
    expect(evening?.remainingSeats).toBe(0);
  });
});

describe("holding seats", () => {
  it("takes them out of the room the moment the date is chosen", async () => {
    const { EVENING, first, restaurant } = await setUp(10);
    const { POST: hold } = await import("@/app/api/booking/hold/route");

    await hold(json("/api/booking/hold", { passKey: first.code, date: EVENING, guestCount: 4 }));

    const evening = await restaurant.getRestaurantDate(EVENING);
    // Held, not booked — the guest has not agreed to anything yet.
    expect(evening?.reservedSeats).toBe(0);
    expect(evening?.heldSeats).toBe(4);
    expect(evening?.remainingSeats).toBe(6);
  });

  /**
   * The key is what proves the person is staying here, and holding seats takes
   * them out of the room — so it is checked now rather than in fifteen minutes.
   * Otherwise an evening could be shut by somebody who could never have booked
   * it (rule 2.5: in the route, never only in the UI).
   */
  it("refuses a key that is not good for the evening", async () => {
    const { EVENING } = await setUp(10);
    const { POST: hold } = await import("@/app/api/booking/hold/route");

    const response = await hold(
      json("/api/booking/hold", { passKey: "K7QP3M2XR4", date: EVENING, guestCount: 2 }),
    );

    expect(response.status).toBe(403);
    expect((await response.json()).code).toBe("PASS_KEY_INVALID");
  });

  it("refuses a party larger than the key allows", async () => {
    const passKeys = await import("@/lib/services/pass-keys");
    const { EVENING } = await setUp(20);
    const { POST: hold } = await import("@/app/api/booking/hold/route");

    const small = await passKeys.issuePassKey({
      roomNumber: "404",
      checkInOn: toDateKey(new Date()),
      expiresOn: EVENING,
      maxGuests: 2,
      actor: ACTOR,
    });

    const response = await hold(
      json("/api/booking/hold", { passKey: small.code, date: EVENING, guestCount: 4 }),
    );

    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe("PASS_KEY_TOO_MANY_GUESTS");
  });

  /** Holding is not booking: the key is spent by the booking, once (rule 2.11). */
  it("does not spend the key", async () => {
    const passKeys = await import("@/lib/services/pass-keys");
    const { EVENING, first } = await setUp(10);
    const { POST: hold } = await import("@/app/api/booking/hold/route");

    await hold(json("/api/booking/hold", { passKey: first.code, date: EVENING, guestCount: 2 }));

    const key = await passKeys.getPassKeyByCode(first.code);
    expect(key?.usedCount).toBe(0);
  });

  it("moves a hold rather than stacking one per change of mind", async () => {
    const { EVENING, first, restaurant } = await setUp(10);
    const { POST: hold } = await import("@/app/api/booking/hold/route");

    const firstTry = await hold(
      json("/api/booking/hold", { passKey: first.code, date: EVENING, guestCount: 4 }),
    );
    const { hold: receipt } = await firstTry.json();

    await hold(
      json("/api/booking/hold", {
        passKey: first.code,
        date: EVENING,
        guestCount: 2,
        previousHoldId: receipt.holdId,
      }),
    );

    const evening = await restaurant.getRestaurantDate(EVENING);
    expect(evening?.heldSeats).toBe(2);
  });
});

describe("giving seats back", () => {
  it("returns them to the room when the guest goes back to the calendar", async () => {
    const { EVENING, first, restaurant } = await setUp(10);
    const { POST: hold, DELETE: release } = await import("@/app/api/booking/hold/route");

    const held = await hold(
      json("/api/booking/hold", { passKey: first.code, date: EVENING, guestCount: 4 }),
    );
    const { hold: receipt } = await held.json();

    const response = await release(
      json("/api/booking/hold", { holdId: receipt.holdId }, "DELETE"),
    );

    expect(response.status).toBe(200);
    expect((await restaurant.getRestaurantDate(EVENING))?.heldSeats).toBe(0);
  });

  /** Expiry and this request race every fifteen minutes; both mean the same. */
  it("is untroubled by a hold that has already gone", async () => {
    await setUp(10);
    const { DELETE: release } = await import("@/app/api/booking/hold/route");

    const response = await release(json("/api/booking/hold", { holdId: "no-such-hold" }, "DELETE"));

    expect(response.status).toBe(200);
    expect((await response.json()).released).toBe(false);
  });
});

describe("a hold that ran out", () => {
  /**
   * Its own answer, and a distinct one. "This date is unavailable" would be
   * both wrong — the evening may be half empty — and useless, because it does
   * not tell the guest that starting again will probably work.
   */
  it("is refused by its own name, never in silence", async () => {
    const { EVENING, first, main } = await setUp(10);
    const { POST: hold } = await import("@/app/api/booking/hold/route");
    const { POST: book } = await import("@/app/api/reservations/route");

    const held = await hold(
      json("/api/booking/hold", { passKey: first.code, date: EVENING, guestCount: 2 }),
    );
    const { hold: receipt } = await held.json();

    // Wind the clock past the fifteen minutes, in the store.
    const holdsFile = path.join(temporaryDirectory, "seat-holds.json");
    const holds = JSON.parse(await fs.readFile(holdsFile, "utf8"));
    holds[0].expiresAt = new Date(Date.now() - 60_000).toISOString();
    await fs.writeFile(holdsFile, JSON.stringify(holds, null, 2), "utf8");

    const response = await book(
      json("/api/reservations", {
        passKey: first.code,
        roomNumber: "402",
        guestCount: 2,
        date: EVENING,
        contact: { method: "email", email: "guest@example.com" },
        selections: choicesFor(main, 2),
        holdId: receipt.holdId,
      }),
    );

    expect(response.status).toBe(409);

    const refusal = await response.json();
    expect(refusal.code).toBe("HOLD_EXPIRED");
    expect(refusal.error).toBeTruthy();
  });

  /** And the seats it was holding go back to the room for everybody else. */
  it("hands its seats to the next guest", async () => {
    const { EVENING, first, second, restaurant } = await setUp(4);
    const { POST: hold } = await import("@/app/api/booking/hold/route");

    await hold(json("/api/booking/hold", { passKey: first.code, date: EVENING, guestCount: 4 }));

    const holdsFile = path.join(temporaryDirectory, "seat-holds.json");
    const holds = JSON.parse(await fs.readFile(holdsFile, "utf8"));
    holds[0].expiresAt = new Date(Date.now() - 60_000).toISOString();
    await fs.writeFile(holdsFile, JSON.stringify(holds, null, 2), "utf8");

    const response = await hold(
      json("/api/booking/hold", { passKey: second.code, date: EVENING, guestCount: 4 }),
    );

    expect(response.status).toBe(200);
    expect((await restaurant.getRestaurantDate(EVENING))?.heldSeats).toBe(4);
  });
});

describe("a booking with no hold behind it", () => {
  /**
   * Staff routes take no hold, and neither does a screen open since before this
   * existed. Such a booking still works — it simply claims its seats at the end,
   * the way every booking used to, and is told plainly if there are none.
   */
  it("still books when the evening has room", async () => {
    const { EVENING, first, main, restaurant } = await setUp(10);
    const { POST: book } = await import("@/app/api/reservations/route");

    const response = await book(
      json("/api/reservations", {
        passKey: first.code,
        roomNumber: "402",
        guestCount: 2,
        date: EVENING,
        contact: { method: "email", email: "guest@example.com" },
        selections: choicesFor(main, 2),
      }),
    );

    expect(response.status).toBe(201);
    expect((await restaurant.getRestaurantDate(EVENING))?.reservedSeats).toBe(2);
  });
});
