import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import type { MenuCourse, MenuOption } from "@/types/booking";

/**
 * Reception putting a bottle on a bill, and taking one off.
 *
 * This route had no tests at all, which matters more than the number suggests:
 * it is the widest write in the app. The guest route may only touch groups a
 * booking already holds; this one may add anything to anything, because
 * reception is the fallback for every rule here and a rule they cannot
 * override gets written on paper instead.
 *
 * Driven as real requests, per `HANDOVER.md` — several bugs in this project
 * passed the type checker and the unit tests and failed the moment a request
 * hit them.
 */

const ACTOR = { kind: "staff", id: "u1", name: "Reception" } as const;

vi.mock("@/lib/auth/guard", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/guard")>();
  return {
    ...actual,
    // The permission itself is the guard's own business and is tested there.
    requireStaff: vi.fn(async () => ({ actor: ACTOR, user: { id: "u1" } })),
  };
});

let temporaryDirectory: string;

beforeEach(async () => {
  temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "staff-add-ons-"));
  process.env.LOCAL_STORE_DIR = temporaryDirectory;
});

afterEach(async () => {
  delete process.env.LOCAL_STORE_DIR;
  await fs.rm(temporaryDirectory, { recursive: true, force: true });
});

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
  return new Request("http://localhost/api/admin/reservations/VDM-AAA111/add-ons", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const params = Promise.resolve({ reservationNumber: "VDM-AAA111" });

/** A plain booking with no promotions on it yet. */
async function setUp() {
  const restaurant = await import("@/lib/services/restaurant");
  const reservations = await import("@/lib/services/reservations");
  const store = await import("@/lib/db/local-store");

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

  await reservations.updateRestaurantDate({ date: "2026-08-18", isOpen: true, capacity: 40 });

  const created = await store.createLocalReservation({
    reservationNumber: "VDM-AAA111",
    roomNumber: "402",
    guestCount: 2,
    date: "2026-08-18",
    selections: [],
  });

  if (!created.ok) {
    throw new Error("could not seed the reservation");
  }

  return { wines, desserts, reservations };
}

describe("staff setting promotions on a booking", () => {
  it("adds one the guest never asked for", async () => {
    const { POST } = await import(
      "@/app/api/admin/reservations/[reservationNumber]/add-ons/route"
    );
    const { wines, reservations } = await setUp();

    const response = await POST(
      post({ addOns: [{ courseId: wines.id, optionId: wines.options[0].id }] }),
      { params },
    );

    expect(response.status).toBe(200);

    const stored = await reservations.getReservationByNumber("VDM-AAA111");
    expect(stored?.addOns?.[0]).toMatchObject({
      optionName: "Chardonnay",
      price: 40,
      discountPercent: 25,
      finalPrice: 30,
    });
  });

  it("takes one off the bill with an empty list", async () => {
    const { POST } = await import(
      "@/app/api/admin/reservations/[reservationNumber]/add-ons/route"
    );
    const { wines, reservations } = await setUp();

    await POST(post({ addOns: [{ courseId: wines.id, optionId: wines.options[0].id }] }), {
      params,
    });
    await POST(post({ addOns: [] }), { params });

    const stored = await reservations.getReservationByNumber("VDM-AAA111");
    expect(stored?.addOns ?? []).toHaveLength(0);
  });

  it("prices from the catalogue, ignoring anything the browser sends", async () => {
    const { POST } = await import(
      "@/app/api/admin/reservations/[reservationNumber]/add-ons/route"
    );
    const { wines, reservations } = await setUp();

    await POST(
      post({
        addOns: [
          {
            courseId: wines.id,
            optionId: wines.options[0].id,
            price: 1,
            discountPercent: 99,
            optionName: "Free wine",
          },
        ],
      }),
      { params },
    );

    const stored = await reservations.getReservationByNumber("VDM-AAA111");
    expect(stored?.addOns?.[0]).toMatchObject({
      optionName: "Chardonnay",
      price: 40,
      finalPrice: 30,
    });
  });

  it("refuses two products from the same group", async () => {
    const { POST } = await import(
      "@/app/api/admin/reservations/[reservationNumber]/add-ons/route"
    );
    const { wines } = await setUp();

    const response = await POST(
      post({
        addOns: [
          { courseId: wines.id, optionId: wines.options[0].id },
          { courseId: wines.id, optionId: wines.options[1].id },
        ],
      }),
      { params },
    );

    expect(response.status).toBe(400);
  });

  it("answers 409 for a product withdrawn from the promotions menu", async () => {
    const { POST } = await import(
      "@/app/api/admin/reservations/[reservationNumber]/add-ons/route"
    );
    const restaurant = await import("@/lib/services/restaurant");
    const { wines } = await setUp();

    await restaurant.saveMenuCatalog(
      [{ ...wines, options: [{ ...wines.options[0], active: false }] }],
      "promo",
    );

    const response = await POST(
      post({ addOns: [{ courseId: wines.id, optionId: wines.options[0].id }] }),
      { params },
    );

    expect(response.status).toBe(409);
  });

  it("answers 404 for a booking that does not exist", async () => {
    const { POST } = await import(
      "@/app/api/admin/reservations/[reservationNumber]/add-ons/route"
    );
    const { wines } = await setUp();

    const response = await POST(
      new Request("http://localhost/api/admin/reservations/VDM-NOPE00/add-ons", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ addOns: [{ courseId: wines.id, optionId: wines.options[0].id }] }),
      }),
      { params: Promise.resolve({ reservationNumber: "VDM-NOPE00" }) },
    );

    expect(response.status).toBe(404);
  });

  it("writes an audit entry naming who changed the bill", async () => {
    const { POST } = await import(
      "@/app/api/admin/reservations/[reservationNumber]/add-ons/route"
    );
    const auditLog = await import("@/lib/services/audit-log");
    const { wines } = await setUp();

    await POST(post({ addOns: [{ courseId: wines.id, optionId: wines.options[0].id }] }), {
      params,
    });

    const entries = await auditLog.getAuditEntries({ reservationNumber: "VDM-AAA111" });
    expect(entries.length).toBeGreaterThan(0);
    expect(entries[0].actorName).toBe("Reception");
    expect(entries[0].actorKind).toBe("staff");
    expect(entries[0].summary).toContain("Chardonnay");
  });
});

/**
 * An agreed line is a record, not a query.
 *
 * These three were found as gaps and pinned as they behaved; this is what they
 * assert now that they are fixed. The third was the expensive one and was not
 * in the original list — it fell out of fixing the second.
 */
describe("what a booking already holds", () => {
  it("refuses a promotion on a cancelled booking, and says what to do instead", async () => {
    const { POST } = await import("@/app/api/admin/reservations/[reservationNumber]/add-ons/route");
    const { wines, reservations } = await setUp();

    await reservations.cancelReservation("VDM-AAA111");

    const response = await POST(
      post({ addOns: [{ courseId: wines.id, optionId: wines.options[0].id }] }),
      { params },
    );

    expect(response.status).toBe(409);

    const body = await response.json();
    expect(body.code).toBe("RESERVATION_NOT_CONFIRMED");
    // "No" without "instead, do this" is how a rule gets worked around on paper.
    expect(body.error).toContain("Restore it first");

    const stored = await reservations.getReservationByNumber("VDM-AAA111");
    expect(stored?.addOns ?? []).toHaveLength(0);
  });

  it("adds a dessert to a booking holding a withdrawn wine, and keeps the wine", async () => {
    const { POST } = await import("@/app/api/admin/reservations/[reservationNumber]/add-ons/route");
    const restaurant = await import("@/lib/services/restaurant");
    const { wines, desserts, reservations } = await setUp();

    await POST(post({ addOns: [{ courseId: wines.id, optionId: wines.options[0].id }] }), { params });

    // The bar stops offering the wine the guest already has.
    await restaurant.saveMenuCatalog(
      [{ ...wines, options: [{ ...wines.options[0], active: false }] }, desserts],
      "promo",
    );

    const response = await POST(
      post({
        addOns: [
          { courseId: wines.id, optionId: wines.options[0].id },
          { courseId: desserts.id, optionId: desserts.options[0].id },
        ],
      }),
      { params },
    );

    expect(response.status).toBe(200);

    const stored = await reservations.getReservationByNumber("VDM-AAA111");
    expect(stored?.addOns?.map((addOn) => addOn.optionName).sort()).toEqual([
      "Chardonnay",
      "Fondant",
    ]);
  });

  /**
   * The one that costs money. Reception adding a dessert, touching nothing
   * about the wine, used to move that wine from the 30 the guest agreed to to
   * whatever the bar charges today — silently, with nothing on screen to say
   * the bill had changed.
   */
  it("does not reprice a line the guest already agreed to", async () => {
    const { POST } = await import("@/app/api/admin/reservations/[reservationNumber]/add-ons/route");
    const restaurant = await import("@/lib/services/restaurant");
    const { wines, desserts, reservations } = await setUp();

    await POST(post({ addOns: [{ courseId: wines.id, optionId: wines.options[0].id }] }), { params });

    await restaurant.saveMenuCatalog(
      [{ ...wines, options: [{ ...wines.options[0], price: 90, discountPercent: 0 }] }, desserts],
      "promo",
    );

    await POST(
      post({
        addOns: [
          { courseId: wines.id, optionId: wines.options[0].id },
          { courseId: desserts.id, optionId: desserts.options[0].id },
        ],
      }),
      { params },
    );

    const stored = await reservations.getReservationByNumber("VDM-AAA111");
    const wine = stored?.addOns?.find((addOn) => addOn.courseId === wines.id);

    expect(wine).toMatchObject({ price: 40, discountPercent: 25, finalPrice: 30 });

    // The dessert, chosen just now, is priced at what it costs now.
    const dessert = stored?.addOns?.find((addOn) => addOn.courseId === desserts.id);
    expect(dessert?.finalPrice).toBe(12);
  });

  /** Repricing stays possible — it just has to be meant. */
  it("takes the new price when the product is removed and put back", async () => {
    const { POST } = await import("@/app/api/admin/reservations/[reservationNumber]/add-ons/route");
    const restaurant = await import("@/lib/services/restaurant");
    const { wines, desserts, reservations } = await setUp();

    await POST(post({ addOns: [{ courseId: wines.id, optionId: wines.options[0].id }] }), { params });

    await restaurant.saveMenuCatalog(
      [{ ...wines, options: [{ ...wines.options[0], price: 90, discountPercent: 0 }] }, desserts],
      "promo",
    );

    await POST(post({ addOns: [] }), { params });
    await POST(post({ addOns: [{ courseId: wines.id, optionId: wines.options[0].id }] }), { params });

    const stored = await reservations.getReservationByNumber("VDM-AAA111");
    expect(stored?.addOns?.[0].finalPrice).toBe(90);
  });
});
