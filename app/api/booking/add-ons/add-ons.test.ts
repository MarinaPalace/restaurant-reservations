import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import type { MenuCourse, MenuOption } from "@/types/booking";

/**
 * The route that takes a promotion, driven as a real request.
 *
 * `HANDOVER.md` is blunt about why: several bugs in this project passed the
 * type checker and the unit tests and failed the moment a request hit them.
 * Everything here goes in as JSON and comes back as a `Response`.
 *
 * Each test runs against a throwaway store directory, so nothing touches
 * `data/`.
 */

let temporaryDirectory: string;

beforeEach(async () => {
  temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "promotions-route-"));
  process.env.LOCAL_STORE_DIR = temporaryDirectory;

  // The limiter's counters are module-level, so without this the later tests
  // in the file are answered 429 by the earlier ones.
  const { resetRateLimits } = await import("@/lib/rate-limit");
  resetRateLimits();
});

afterEach(async () => {
  delete process.env.LOCAL_STORE_DIR;
  await fs.rm(temporaryDirectory, { recursive: true, force: true });
});

const ACTOR = { kind: "staff", id: "u1", name: "Reception" } as const;

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

function post(body: unknown) {
  return new Request("http://localhost/api/booking/add-ons", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

/**
 * A restaurant with two promotion groups, one booked evening, and a guest
 * holding the key that paid for it.
 */
async function setUp() {
  const restaurant = await import("@/lib/services/restaurant");
  const reservations = await import("@/lib/services/reservations");
  const passKeys = await import("@/lib/services/pass-keys");

  await restaurant.saveMenuCatalog([course("Starter", [option("Soup")])], "standard");
  await restaurant.saveMenuCatalog(
    [
      course("Wines", [
        option("Chardonnay", { price: 40, discountPercent: 25 }),
        option("Merlot", { price: 28 }),
      ]),
      course("Desserts", [option("Fondant", { price: 12 })], { order: 2 }),
    ],
    "promo",
  );

  const [wines, desserts] = await restaurant.getFullMenuCatalog("promo");
  const [starter] = await restaurant.getFullMenuCatalog("standard");

  const key = await passKeys.issuePassKey({
    roomNumber: "402",
    checkInOn: "2026-08-10",
    expiresOn: "2026-08-20",
    actor: ACTOR,
  });

  await reservations.updateRestaurantDate({ date: "2026-08-18", isOpen: true, capacity: 40 });

  const store = await import("@/lib/db/local-store");
  const created = await store.createLocalReservation({
    reservationNumber: "VDM-AAA111",
    roomNumber: "402",
    guestCount: 2,
    date: "2026-08-18",
    selections: [
      {
        guestIndex: 0,
        courseId: starter.id,
        courseName: "Starter",
        optionId: starter.options[0].id,
        optionName: "Soup",
      },
    ],
    passKeyId: key.id,
  });

  if (!created.ok) {
    throw new Error("could not seed the reservation");
  }

  await passKeys.consumePassKey(key.code, "VDM-AAA111");

  return { key, wines, desserts, reservations };
}

describe("taking a promotion", () => {
  it("saves the choice, priced from the catalogue", async () => {
    const { POST } = await import("@/app/api/booking/add-ons/route");
    const { key, wines, reservations } = await setUp();

    const response = await POST(
      post({
        passKey: key.code,
        reservationNumber: "VDM-AAA111",
        addOns: [{ courseId: wines.id, optionId: wines.options[0].id }],
      }),
    );

    expect(response.status).toBe(200);

    const stored = await reservations.getReservationByNumber("VDM-AAA111");
    expect(stored?.addOns).toHaveLength(1);
    expect(stored?.addOns?.[0]).toMatchObject({
      optionName: "Chardonnay",
      price: 40,
      discountPercent: 25,
      finalPrice: 30,
    });
  });

  it("takes one product from each of two groups", async () => {
    const { POST } = await import("@/app/api/booking/add-ons/route");
    const { key, wines, desserts, reservations } = await setUp();

    await POST(
      post({
        passKey: key.code,
        reservationNumber: "VDM-AAA111",
        addOns: [
          { courseId: wines.id, optionId: wines.options[0].id },
          { courseId: desserts.id, optionId: desserts.options[0].id },
        ],
      }),
    );

    const stored = await reservations.getReservationByNumber("VDM-AAA111");
    expect(stored?.addOns?.map((addOn) => addOn.optionName)).toEqual(["Chardonnay", "Fondant"]);
  });

  it("refuses two products from the same group", async () => {
    const { POST } = await import("@/app/api/booking/add-ons/route");
    const { key, wines } = await setUp();

    const response = await POST(
      post({
        passKey: key.code,
        reservationNumber: "VDM-AAA111",
        addOns: [
          { courseId: wines.id, optionId: wines.options[0].id },
          { courseId: wines.id, optionId: wines.options[1].id },
        ],
      }),
    );

    expect(response.status).toBe(400);
  });

  /**
   * Changing your mind replaces the set rather than adding to it, which is
   * what makes "no, thank you" reachable at all.
   */
  it("replaces the whole set rather than merging", async () => {
    const { POST } = await import("@/app/api/booking/add-ons/route");
    const { key, wines, reservations } = await setUp();

    await POST(
      post({
        passKey: key.code,
        reservationNumber: "VDM-AAA111",
        addOns: [{ courseId: wines.id, optionId: wines.options[0].id }],
      }),
    );
    await POST(
      post({
        passKey: key.code,
        reservationNumber: "VDM-AAA111",
        addOns: [{ courseId: wines.id, optionId: wines.options[1].id }],
      }),
    );

    const stored = await reservations.getReservationByNumber("VDM-AAA111");
    expect(stored?.addOns?.map((addOn) => addOn.optionName)).toEqual(["Merlot"]);
  });

  it("takes them all back off with an empty list", async () => {
    const { POST } = await import("@/app/api/booking/add-ons/route");
    const { key, wines, reservations } = await setUp();

    await POST(
      post({
        passKey: key.code,
        reservationNumber: "VDM-AAA111",
        addOns: [{ courseId: wines.id, optionId: wines.options[0].id }],
      }),
    );

    const response = await POST(
      post({ passKey: key.code, reservationNumber: "VDM-AAA111", addOns: [] }),
    );

    expect(response.status).toBe(200);
    expect((await reservations.getReservationByNumber("VDM-AAA111"))?.addOns).toEqual([]);
  });

  /** Rule 2.6: the client's wording is never trusted, and nor is its price. */
  it("ignores a price and a name sent by the client", async () => {
    const { POST } = await import("@/app/api/booking/add-ons/route");
    const { key, wines, reservations } = await setUp();

    await POST(
      post({
        passKey: key.code,
        reservationNumber: "VDM-AAA111",
        addOns: [
          {
            courseId: wines.id,
            optionId: wines.options[0].id,
            price: 1,
            discountPercent: 99,
            finalPrice: 0.01,
            optionName: "Free wine",
          },
        ],
      }),
    );

    const stored = await reservations.getReservationByNumber("VDM-AAA111");
    expect(stored?.addOns?.[0]).toMatchObject({ optionName: "Chardonnay", price: 40, finalPrice: 30 });
  });

  /** A dinner course is not on offer here, whatever id the request names. */
  it("refuses a dish from the dinner menu", async () => {
    const { POST } = await import("@/app/api/booking/add-ons/route");
    const restaurant = await import("@/lib/services/restaurant");
    const { key } = await setUp();

    const [starter] = await restaurant.getFullMenuCatalog("standard");
    const response = await POST(
      post({
        passKey: key.code,
        reservationNumber: "VDM-AAA111",
        addOns: [{ courseId: starter.id, optionId: starter.options[0].id }],
      }),
    );

    expect(response.status).toBe(409);
  });

  it("answers 409 when the product has been withdrawn since the page loaded", async () => {
    const { POST } = await import("@/app/api/booking/add-ons/route");
    const restaurant = await import("@/lib/services/restaurant");
    const { key, wines } = await setUp();

    await restaurant.saveMenuCatalog([], "promo");

    const response = await POST(
      post({
        passKey: key.code,
        reservationNumber: "VDM-AAA111",
        addOns: [{ courseId: wines.id, optionId: wines.options[0].id }],
      }),
    );

    expect(response.status).toBe(409);
  });
});

/**
 * Rule 2.5. The reservation number is not a secret — guests read it out to
 * other rooms so they can share a table — so it must not be what authorises a
 * change, and a wrong key must be indistinguishable from a wrong number.
 */
describe("authorisation", () => {
  it("refuses a reservation number with no pass-key", async () => {
    const { POST } = await import("@/app/api/booking/add-ons/route");
    const { wines } = await setUp();

    const response = await POST(
      post({
        reservationNumber: "VDM-AAA111",
        addOns: [{ courseId: wines.id, optionId: wines.options[0].id }],
      }),
    );

    expect(response.status).toBe(400);
  });

  it("refuses another guest's key, and says only that it was not found", async () => {
    const { POST } = await import("@/app/api/booking/add-ons/route");
    const passKeys = await import("@/lib/services/pass-keys");
    const { wines, reservations } = await setUp();

    const otherRoom = await passKeys.issuePassKey({
      roomNumber: "115",
      checkInOn: "2026-08-10",
      expiresOn: "2026-08-20",
      actor: ACTOR,
    });

    const response = await POST(
      post({
        passKey: otherRoom.code,
        reservationNumber: "VDM-AAA111",
        addOns: [{ courseId: wines.id, optionId: wines.options[0].id }],
      }),
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "We could not find that reservation." });
    expect((await reservations.getReservationByNumber("VDM-AAA111"))?.addOns).toBeUndefined();
  });

  it("refuses a revoked key", async () => {
    const { POST } = await import("@/app/api/booking/add-ons/route");
    const passKeys = await import("@/lib/services/pass-keys");
    const { key, wines } = await setUp();

    await passKeys.revokePassKey(key.id);

    const response = await POST(
      post({
        passKey: key.code,
        reservationNumber: "VDM-AAA111",
        addOns: [{ courseId: wines.id, optionId: wines.options[0].id }],
      }),
    );

    expect(response.status).toBe(404);
  });

  /**
   * The limiter is reset before each test, so this is the one place that
   * proves it is still wired in at all.
   */
  it("throttles a client hammering the endpoint", async () => {
    const { POST } = await import("@/app/api/booking/add-ons/route");
    const { key, wines } = await setUp();

    const body = {
      passKey: key.code,
      reservationNumber: "VDM-AAA111",
      addOns: [{ courseId: wines.id, optionId: wines.options[0].id }],
    };

    let last = await POST(post(body));
    for (let attempt = 0; attempt < 12; attempt += 1) {
      last = await POST(post(body));
    }

    expect(last.status).toBe(429);
    expect(last.headers.get("Retry-After")).toBeTruthy();
  });

  it("refuses a cancelled booking", async () => {
    const { POST } = await import("@/app/api/booking/add-ons/route");
    const { key, wines, reservations } = await setUp();

    await reservations.cancelReservation("VDM-AAA111");

    const response = await POST(
      post({
        passKey: key.code,
        reservationNumber: "VDM-AAA111",
        addOns: [{ courseId: wines.id, optionId: wines.options[0].id }],
      }),
    );

    expect(response.status).toBe(404);
  });
});
