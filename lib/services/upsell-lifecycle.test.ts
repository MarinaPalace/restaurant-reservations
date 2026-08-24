import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import type { MenuCourse, MenuOption } from "@/types/booking";

/**
 * The promotion's whole life, from the catalogue to the bill.
 *
 * Written before freezing this project as the base for a paid product, where a
 * promotion stops being a nice extra and becomes the thing money changes hands
 * over. The route's own tests cover taking one and giving it back; these cover
 * what happens to it *afterwards* — when the booking is cancelled, when it is
 * restored, and when staff reprice a product a guest already agreed to.
 *
 * The rule underneath all of it: **what is stored on the reservation is what
 * was agreed**, and nothing later re-derives it from the catalogue. A price is
 * a promise made at a moment, and the catalogue is not a record of moments.
 */

let temporaryDirectory: string;

beforeEach(async () => {
  temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "upsell-lifecycle-"));
  process.env.LOCAL_STORE_DIR = temporaryDirectory;
});

afterEach(async () => {
  delete process.env.LOCAL_STORE_DIR;
  await fs.rm(temporaryDirectory, { recursive: true, force: true });
});

const ACTOR = { kind: "staff", id: "u1", name: "Reception" } as const;

const EVENING = { date: "2026-08-18", isOpen: true, capacity: 40, reservedSeats: 2, remainingSeats: 38 };

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

/** A booking that has already taken the discounted Chardonnay. */
async function bookingWithWine() {
  const restaurant = await import("@/lib/services/restaurant");
  const reservations = await import("@/lib/services/reservations");
  const passKeys = await import("@/lib/services/pass-keys");
  const store = await import("@/lib/db/local-store");

  await restaurant.saveMenuCatalog([course("Starter", [option("Soup")])], "standard");
  await restaurant.saveMenuCatalog(
    [course("Wines", [option("Chardonnay", { price: 40, discountPercent: 25 })])],
    "promo",
  );

  const [wines] = await restaurant.getFullMenuCatalog("promo");

  const key = await passKeys.issuePassKey({
    roomNumber: "402",
    checkInOn: "2026-08-10",
    expiresOn: "2026-08-20",
    actor: ACTOR,
  });

  await reservations.updateRestaurantDate({ date: "2026-08-18", isOpen: true, capacity: 40 });

  const created = await store.createLocalReservation({
    reservationNumber: "VDM-AAA111",
    roomNumber: "402",
    guestCount: 2,
    date: "2026-08-18",
    selections: [],
    passKeyId: key.id,
  });

  if (!created.ok) {
    throw new Error("could not seed the reservation");
  }

  await passKeys.consumePassKey(key.code, "VDM-AAA111");

  const chosen = wines.options[0];
  await reservations.updateReservationAddOns("VDM-AAA111", [
    {
      courseId: wines.id,
      courseName: wines.name,
      optionId: chosen.id,
      optionName: chosen.name,
      ...restaurant.priceOfPromoOption(chosen),
    },
  ]);

  return { restaurant, reservations, wines };
}

describe("cancelling a booking that took a promotion", () => {
  it("keeps the promotion on the record rather than erasing it", async () => {
    const { reservations } = await bookingWithWine();

    await reservations.cancelReservation("VDM-AAA111");

    const stored = await reservations.getReservationByNumber("VDM-AAA111");
    expect(stored?.status).toBe("cancelled");

    /*
     * Deliberate. "What was on this bill before it was cancelled?" is exactly
     * the question somebody asks in a dispute, and deleting the line to make a
     * total come out right answers it with silence. The totals are made right
     * by excluding cancelled bookings instead — the next test.
     */
    expect(stored?.addOns).toHaveLength(1);
    expect(stored?.addOns?.[0].optionName).toBe("Chardonnay");
  });

  it("stops counting it as revenue", async () => {
    const { reservations } = await bookingWithWine();
    const { buildTotals } = await import("@/lib/analytics/metrics");

    const before = await reservations.getReservationByNumber("VDM-AAA111");
    expect(buildTotals([before!], [EVENING]).promotionRevenue).toBe(30);

    await reservations.cancelReservation("VDM-AAA111");

    const after = await reservations.getReservationByNumber("VDM-AAA111");
    expect(buildTotals([after!], [EVENING]).promotionRevenue).toBe(0);
  });

  it("stops the kitchen preparing it", async () => {
    const { reservations } = await bookingWithWine();
    const { buildExtrasList } = await import("@/lib/kitchen-report");

    const before = await reservations.getReservationByNumber("VDM-AAA111");
    expect(buildExtrasList([before!])).toHaveLength(1);

    await reservations.cancelReservation("VDM-AAA111");

    const after = await reservations.getReservationByNumber("VDM-AAA111");
    expect(buildExtrasList([after!])).toHaveLength(0);
  });
});

describe("restoring a cancelled booking", () => {
  it("brings the promotion back, priced exactly as it was agreed", async () => {
    const { reservations } = await bookingWithWine();

    await reservations.cancelReservation("VDM-AAA111");
    await reservations.restoreReservation("VDM-AAA111");

    const stored = await reservations.getReservationByNumber("VDM-AAA111");
    expect(stored?.status).toBe("confirmed");
    expect(stored?.addOns?.[0]).toMatchObject({
      optionName: "Chardonnay",
      price: 40,
      discountPercent: 25,
      finalPrice: 30,
    });
  });

  it("counts as revenue again once restored", async () => {
    const { reservations } = await bookingWithWine();
    const { buildTotals } = await import("@/lib/analytics/metrics");

    await reservations.cancelReservation("VDM-AAA111");
    await reservations.restoreReservation("VDM-AAA111");

    const stored = await reservations.getReservationByNumber("VDM-AAA111");
    expect(buildTotals([stored!], [EVENING]).promotionRevenue).toBe(30);
  });

  it("restores it even after the product was withdrawn from the catalogue", async () => {
    const { restaurant, reservations, wines } = await bookingWithWine();

    await reservations.cancelReservation("VDM-AAA111");

    // The bar stops offering it while the booking sits cancelled.
    await restaurant.saveMenuCatalog(
      [{ ...wines, options: [{ ...wines.options[0], active: false }] }],
      "promo",
    );

    await reservations.restoreReservation("VDM-AAA111");

    /*
     * A booking is a record of an agreement, not a live query against the bar's
     * stock list. A restore that dropped the line because the product had since
     * been withdrawn would quietly change what the guest is owed.
     */
    const stored = await reservations.getReservationByNumber("VDM-AAA111");
    expect(stored?.addOns?.[0].optionName).toBe("Chardonnay");
    expect(stored?.addOns?.[0].finalPrice).toBe(30);
  });
});

describe("repricing a product after somebody has taken it", () => {
  it("leaves the agreed price on the booking untouched", async () => {
    const { restaurant, reservations, wines } = await bookingWithWine();

    // The bar puts the price up and drops the discount.
    await restaurant.saveMenuCatalog(
      [{ ...wines, options: [{ ...wines.options[0], price: 60, discountPercent: 0 }] }],
      "promo",
    );

    const stored = await reservations.getReservationByNumber("VDM-AAA111");
    expect(stored?.addOns?.[0]).toMatchObject({ price: 40, discountPercent: 25, finalPrice: 30 });
  });

  it("keeps the name the guest agreed to, even after the product is renamed", async () => {
    const { restaurant, reservations, wines } = await bookingWithWine();

    await restaurant.saveMenuCatalog(
      [{ ...wines, options: [{ ...wines.options[0], name: "House White" }] }],
      "promo",
    );

    const stored = await reservations.getReservationByNumber("VDM-AAA111");
    expect(stored?.addOns?.[0].optionName).toBe("Chardonnay");
  });

  it("reports the older booking at the old price and the newer one at the new price", async () => {
    const { restaurant, reservations, wines } = await bookingWithWine();
    const { buildTotals } = await import("@/lib/analytics/metrics");
    const store = await import("@/lib/db/local-store");

    await restaurant.saveMenuCatalog(
      [{ ...wines, options: [{ ...wines.options[0], price: 60, discountPercent: 0 }] }],
      "promo",
    );

    const [repriced] = await restaurant.getFullMenuCatalog("promo");
    const second = await store.createLocalReservation({
      reservationNumber: "VDM-BBB222",
      roomNumber: "118",
      guestCount: 2,
      date: "2026-08-18",
      selections: [],
    });

    if (!second.ok) {
      throw new Error("could not seed the second reservation");
    }

    await reservations.updateReservationAddOns("VDM-BBB222", [
      {
        courseId: repriced.id,
        courseName: repriced.name,
        optionId: repriced.options[0].id,
        optionName: repriced.options[0].name,
        ...restaurant.priceOfPromoOption(repriced.options[0]),
      },
    ]);

    const first = await reservations.getReservationByNumber("VDM-AAA111");
    const latest = await reservations.getReservationByNumber("VDM-BBB222");

    // 30 agreed before the rise, 60 agreed after it. Neither is re-derived.
    expect(buildTotals([first!, latest!], [{ ...EVENING, reservedSeats: 4, remainingSeats: 36 }]).promotionRevenue).toBe(90);
  });
});
