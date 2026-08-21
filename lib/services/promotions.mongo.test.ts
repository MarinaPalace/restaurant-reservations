import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import mongoose from "mongoose";
import type { MenuCourse, MenuOption } from "@/types/booking";

/**
 * Promotions, against a real mongod.
 *
 * Three things are worth a real database rather than a stub:
 *
 * - **Catalogue isolation** (rule 2.3). Saving one catalogue prunes within it,
 *   and there are now three of them. The everyday filter is the one that can
 *   go wrong, because "standard" is the *absence* of a marking rather than a
 *   value, so it has to be expressed as a `$nin` — and a `$nin` that forgets
 *   one of the other two deletes that catalogue outright.
 * - **The legacy `addOn` flag.** The first version of promotions marked a
 *   course on the everyday menu. Live databases hold courses like that, and
 *   rule 2.2 says they must keep working without a migration.
 * - **Prices are the server's, not the client's** (rule 2.6). A discount a
 *   request can name is a discount a request can invent.
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

async function loadRestaurant() {
  return import("@/lib/services/restaurant");
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

/** All three catalogues, each with one course and one item. */
async function seedAllThree() {
  const restaurant = await loadRestaurant();

  await restaurant.saveMenuCatalog([course("Everyday starter", [option("Soup")])], "standard");
  await restaurant.saveMenuCatalog([course("Premium starter", [option("Caviar")])], "premium");
  await restaurant.saveMenuCatalog(
    [course("Wines", [option("Chardonnay", { price: 40, discountPercent: 25 })])],
    "promo",
  );
}

describe("the three catalogues stay separate", () => {
  it("serves each catalogue on its own", async () => {
    const restaurant = await loadRestaurant();
    await seedAllThree();

    expect((await restaurant.getMenuCatalog("en", "standard")).map((c) => c.name)).toEqual(["Everyday starter"]);
    expect((await restaurant.getMenuCatalog("en", "premium")).map((c) => c.name)).toEqual(["Premium starter"]);
    expect((await restaurant.getMenuCatalog("en", "promo")).map((c) => c.name)).toEqual(["Wines"]);
  });

  /**
   * The reason promotions are a catalogue and not a flag: the dinner menu asks
   * for `standard`, and a bottle of wine simply is not in the answer.
   */
  it("keeps promotions out of both dinner menus", async () => {
    const restaurant = await loadRestaurant();
    await seedAllThree();

    expect((await restaurant.getMenuCatalog("en", "standard")).map((c) => c.name)).not.toContain("Wines");
    expect((await restaurant.getMenuCatalog("en", "premium")).map((c) => c.name)).not.toContain("Wines");
    expect((await restaurant.getMenuCatalog()).map((c) => c.name)).not.toContain("Wines");
  });

  it("leaves the other two alone when promotions are saved", async () => {
    const restaurant = await loadRestaurant();
    await seedAllThree();

    const promo = await restaurant.getFullMenuCatalog("promo");
    await restaurant.saveMenuCatalog([{ ...promo[0], name: "Renamed wines" }], "promo");

    expect((await restaurant.getFullMenuCatalog("standard")).map((c) => c.name)).toEqual(["Everyday starter"]);
    expect((await restaurant.getFullMenuCatalog("premium")).map((c) => c.name)).toEqual(["Premium starter"]);
  });

  /**
   * The dangerous direction. "Standard" is matched by exclusion, so a filter
   * that forgets to exclude promotions deletes the whole wine list the next
   * time somebody renames a starter.
   */
  it("leaves promotions alone when the everyday menu is saved", async () => {
    const restaurant = await loadRestaurant();
    await seedAllThree();

    const standard = await restaurant.getFullMenuCatalog("standard");
    await restaurant.saveMenuCatalog([{ ...standard[0], name: "Renamed everyday" }], "standard");

    const promo = await restaurant.getFullMenuCatalog("promo");
    expect(promo.map((c) => c.name)).toEqual(["Wines"]);
    expect(promo[0].options.map((o) => o.name)).toEqual(["Chardonnay"]);
  });

  it("leaves promotions alone when the premium menu is saved", async () => {
    const restaurant = await loadRestaurant();
    await seedAllThree();

    const premium = await restaurant.getFullMenuCatalog("premium");
    await restaurant.saveMenuCatalog([{ ...premium[0], name: "Renamed premium" }], "premium");

    expect((await restaurant.getFullMenuCatalog("promo")).map((c) => c.name)).toEqual(["Wines"]);
  });

  it("empties the promotions catalogue without touching dinner", async () => {
    const restaurant = await loadRestaurant();
    await seedAllThree();

    await restaurant.saveMenuCatalog([], "promo");

    expect(await restaurant.getFullMenuCatalog("promo")).toEqual([]);
    expect((await restaurant.getFullMenuCatalog("standard")).map((c) => c.name)).toEqual(["Everyday starter"]);
    expect((await restaurant.getFullMenuCatalog("premium")).map((c) => c.name)).toEqual(["Premium starter"]);
  });
});

/**
 * The first version of promotions set `addOn: true` on a course in the
 * everyday menu. Those documents exist, and rule 2.2 says no migration.
 */
describe("courses from the first version of promotions", () => {
  async function insertLegacyAddOnCourse() {
    const { MenuCourseModel } = await import("@/lib/models/menu-course");
    const { MenuOptionModel } = await import("@/lib/models/menu-option");

    const inserted = await MenuCourseModel.collection.insertOne({
      order: 9,
      name: "Legacy wines",
      description: "",
      required: false,
      active: true,
      addOn: true,
    });

    await MenuOptionModel.collection.insertOne({
      courseId: String(inserted.insertedId),
      name: "Legacy merlot",
      description: "",
      allergens: [],
      active: true,
      price: 28,
      discountPercent: 0,
    });

    return String(inserted.insertedId);
  }

  it("reads them as promotions, not as dinner courses", async () => {
    const restaurant = await loadRestaurant();
    await insertLegacyAddOnCourse();

    expect((await restaurant.getFullMenuCatalog("promo")).map((c) => c.name)).toEqual(["Legacy wines"]);
    expect((await restaurant.getFullMenuCatalog("standard")).map((c) => c.name)).not.toContain("Legacy wines");
  });

  /** They were saved with `required` set; a promotion is never compulsory. */
  it("never treats one as required", async () => {
    const restaurant = await loadRestaurant();
    const { MenuCourseModel } = await import("@/lib/models/menu-course");
    const id = await insertLegacyAddOnCourse();
    await MenuCourseModel.collection.updateOne({ _id: new mongoose.Types.ObjectId(id) }, { $set: { required: true } });

    expect((await restaurant.getFullMenuCatalog("promo"))[0].required).toBe(false);
  });

  /**
   * Saving the everyday menu must not sweep one away. Under the old two-value
   * reading it was a standard course with an id nobody kept, which is exactly
   * the shape the pruning step deletes.
   */
  it("survives a save of the everyday menu", async () => {
    const restaurant = await loadRestaurant();
    await insertLegacyAddOnCourse();
    await restaurant.saveMenuCatalog([course("Starter", [option("Soup")])], "standard");

    expect((await restaurant.getFullMenuCatalog("promo")).map((c) => c.name)).toEqual(["Legacy wines"]);
  });

  /** Saving promotions moves it over properly, and the flag goes quiet. */
  it("is written into the promotions catalogue on the next save", async () => {
    const restaurant = await loadRestaurant();
    const { MenuCourseModel } = await import("@/lib/models/menu-course");
    await insertLegacyAddOnCourse();

    const promo = await restaurant.getFullMenuCatalog("promo");
    await restaurant.saveMenuCatalog(promo, "promo");

    const stored = await MenuCourseModel.collection.findOne({ name: "Legacy wines" });
    expect(stored?.menu).toBe("promo");
    expect(stored?.addOn).toBe(false);

    // And it is still exactly one promotion, not two.
    expect((await restaurant.getFullMenuCatalog("promo")).map((c) => c.name)).toEqual(["Legacy wines"]);
  });
});

describe("promotion prices", () => {
  it("keeps the price and discount through a save round trip", async () => {
    const restaurant = await loadRestaurant();
    await restaurant.saveMenuCatalog(
      [course("Wines", [option("Chardonnay", { price: 40, discountPercent: 25 })])],
      "promo",
    );

    const [group] = await restaurant.getFullMenuCatalog("promo");
    expect(group.options[0].price).toBe(40);
    expect(group.options[0].discountPercent).toBe(25);
  });

  /**
   * Dinner is part of the stay. A price that survived being moved out of the
   * promotions catalogue would be charged for something nobody agreed to pay
   * for.
   */
  it("strips a price from a dinner course", async () => {
    const restaurant = await loadRestaurant();
    await restaurant.saveMenuCatalog(
      [course("Starter", [option("Soup", { price: 12, discountPercent: 50 })])],
      "standard",
    );

    const [starter] = await restaurant.getFullMenuCatalog("standard");
    expect(starter.options[0].price).toBe(0);
    expect(starter.options[0].discountPercent).toBe(0);
  });

  it("prices a discount to the cent", async () => {
    const restaurant = await loadRestaurant();
    await restaurant.saveMenuCatalog(
      [course("Wines", [option("Chardonnay", { price: 40, discountPercent: 15 })])],
      "promo",
    );

    const [group] = await restaurant.getFullMenuCatalog("promo");
    // 40 * 0.85 is 33.999999999999996 in binary floating point.
    expect(restaurant.priceOfPromoOption(group.options[0]).finalPrice).toBe(34);
  });

  it("clamps a discount typed outside 0–100", async () => {
    const restaurant = await loadRestaurant();
    await restaurant.saveMenuCatalog(
      [
        course("Wines", [
          option("Over", { price: 40, discountPercent: 400 }),
          option("Under", { price: 40, discountPercent: -20 }),
        ]),
      ],
      "promo",
    );

    const [group] = await restaurant.getFullMenuCatalog("promo");
    expect(group.options.find((o) => o.name === "Over")?.discountPercent).toBe(100);
    expect(group.options.find((o) => o.name === "Under")?.discountPercent).toBe(0);
  });
});

describe("what a guest is offered", () => {
  it("drops a group whose last product was switched off", async () => {
    const restaurant = await loadRestaurant();
    await restaurant.saveMenuCatalog(
      [
        course("Wines", [option("Chardonnay", { price: 40 })]),
        course("Desserts", [option("Fondant", { price: 12, active: false })], { order: 2 }),
      ],
      "promo",
    );

    // An empty heading reads as a page that failed to load.
    expect((await restaurant.getPromoCatalog("en")).map((c) => c.name)).toEqual(["Wines"]);
  });

  it("drops a group that has been switched off entirely", async () => {
    const restaurant = await loadRestaurant();
    await restaurant.saveMenuCatalog(
      [course("Wines", [option("Chardonnay", { price: 40 })], { active: false })],
      "promo",
    );

    expect(await restaurant.getPromoCatalog("en")).toEqual([]);
  });

  it("offers a product in the guest's language", async () => {
    const restaurant = await loadRestaurant();
    await restaurant.saveMenuCatalog(
      [
        course("Wines", [
          option("Chardonnay", {
            price: 40,
            translations: { bg: { name: "Шардоне" } },
          }),
        ]),
      ],
      "promo",
    );

    expect((await restaurant.getPromoCatalog("bg"))[0].options[0].name).toBe("Шардоне");
    // The English master is what staff read off the sheet.
    expect((await restaurant.getPromoCatalog("en"))[0].options[0].name).toBe("Chardonnay");
  });
});

/**
 * The service board's fields, against a real mongod.
 *
 * Rule 2.2: a document written before either existed must read correctly and
 * survive a round trip. And the writes must be **per key** — two waiters
 * marking different courses on one table at the same moment must both land,
 * which a read-modify-write would not guarantee.
 */
describe("attendance and service progress", () => {
  async function seedBooking(number = "VDM-SVC001") {
    const reservations = await import("@/lib/services/reservations");
    await reservations.updateRestaurantDate({ date: "2026-08-25", isOpen: true, capacity: 40 });

    const { ReservationModel } = await import("@/lib/models/reservation");
    await ReservationModel.collection.insertOne({
      reservationNumber: number,
      roomNumber: "402",
      guestCount: 2,
      date: "2026-08-25",
      status: "confirmed",
      selections: [{ guestIndex: 0, courseId: "c1", courseName: "Starter", optionId: "o1", optionName: "Salmon" }],
    });

    return { number, reservations };
  }

  it("reads a document written before these fields existed", async () => {
    const { number, reservations } = await seedBooking();
    const saved = await reservations.getReservationByNumber(number);

    expect(saved).toBeTruthy();
    expect(saved?.attendance).toBeUndefined();
    expect(saved?.service).toBeUndefined();
    // And nothing else was disturbed by the new schema.
    expect(saved?.selections).toHaveLength(1);
  });

  it("stores and reads an attendance mark", async () => {
    const { number, reservations } = await seedBooking();

    await reservations.setReservationAttendance(number, {
      status: "seated",
      at: "2026-08-25T17:00:00.000Z",
      byName: "Ivan",
      guests: 2,
    });

    expect((await reservations.getReservationByNumber(number))?.attendance).toMatchObject({
      status: "seated",
      byName: "Ivan",
      guests: 2,
    });
  });

  /** Undo returns it to unknown, never to the opposite claim. */
  it("clears an attendance mark back to absent", async () => {
    const { number, reservations } = await seedBooking();

    await reservations.setReservationAttendance(number, {
      status: "no-show",
      at: "2026-08-25T19:30:00.000Z",
      byName: "Ivan",
    });
    await reservations.setReservationAttendance(number, null);

    expect((await reservations.getReservationByNumber(number))?.attendance).toBeUndefined();
  });

  it("marks a course served without touching its neighbours", async () => {
    const { number, reservations } = await seedBooking();

    await reservations.setReservationCourseServed(number, "c1", "2026-08-25T18:04:00.000Z");
    await reservations.setReservationCourseServed(number, "c2", "2026-08-25T19:00:00.000Z");
    await reservations.setReservationCourseServed(number, "c1", null);

    expect((await reservations.getReservationByNumber(number))?.service?.servedAt).toEqual({
      c2: "2026-08-25T19:00:00.000Z",
    });
  });

  /**
   * The reason the write is a dotted `$set` rather than replacing the map:
   * three marks landing together must all survive.
   */
  it("does not lose a mark when several land at once", async () => {
    const { number, reservations } = await seedBooking();

    await Promise.all([
      reservations.setReservationCourseServed(number, "c1", "2026-08-25T18:04:00.000Z"),
      reservations.setReservationCourseServed(number, "c2", "2026-08-25T18:05:00.000Z"),
      reservations.setReservationCourseServed(number, "c3", "2026-08-25T18:06:00.000Z"),
    ]);

    const saved = await reservations.getReservationByNumber(number);
    expect(Object.keys(saved?.service?.servedAt ?? {})).toHaveLength(3);
  });

  it("survives a save round-trip field for field", async () => {
    const { number, reservations } = await seedBooking();

    await reservations.setReservationAttendance(number, {
      status: "seated",
      at: "2026-08-25T17:00:00.000Z",
      byName: "Ivan",
    });
    await reservations.setReservationCourseServed(number, "c1", "2026-08-25T18:04:00.000Z");

    const saved = await reservations.getReservationByNumber(number);
    expect(saved?.attendance?.status).toBe("seated");
    expect(saved?.service?.servedAt?.c1).toBe("2026-08-25T18:04:00.000Z");
    expect(saved?.roomNumber).toBe("402");
    expect(saved?.guestCount).toBe(2);
  });
});
