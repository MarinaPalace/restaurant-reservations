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
 * Two gaps found while writing the tests above. Both are recorded as they
 * behave today rather than as they should, so that changing either one has to
 * change a test that says why — see docs/upsell-lifecycle.md.
 */
describe("known gaps, pinned so a fix has to be deliberate", () => {
  /**
   * **Gap 1 — a cancelled booking still accepts a chargeable item.**
   *
   * The guest route refuses anything but a confirmed booking; this one never
   * checks. Reception adds a bottle to a booking that was cancelled, gets a
   * cheerful 200, and the line is written to the document — where every report
   * then ignores it, because reports exclude cancelled bookings. Nothing is
   * over-charged, which is why it has survived: it fails silently in the safe
   * direction. But the screen said yes and the money never appears, and the
   * only way to find out is to notice the absence.
   */
  it("accepts a promotion on a cancelled booking, and the revenue is then ignored", async () => {
    const { POST } = await import("@/app/api/admin/reservations/[reservationNumber]/add-ons/route");
    const { buildTotals } = await import("@/lib/analytics/metrics");
    const { wines, reservations } = await setUp();

    await reservations.cancelReservation("VDM-AAA111");

    const response = await POST(
      post({ addOns: [{ courseId: wines.id, optionId: wines.options[0].id }] }),
      { params },
    );

    expect(response.status).toBe(200);

    const stored = await reservations.getReservationByNumber("VDM-AAA111");
    expect(stored?.status).toBe("cancelled");
    expect(stored?.addOns).toHaveLength(1);

    // Written, and worth nothing.
    const evening = { date: "2026-08-18", isOpen: true, capacity: 40, reservedSeats: 0, remainingSeats: 40 };
    expect(buildTotals([stored!], [evening]).promotionRevenue).toBe(0);
  });

  /**
   * **Gap 2 — a withdrawn product freezes the whole booking.**
   *
   * Every item in the request is re-resolved against the live catalogue, and
   * one miss rejects the set. So once the bar stops offering a wine somebody
   * already agreed to, that booking can never have anything else added: asking
   * for the dessert means re-sending the wine, and the wine is gone.
   *
   * The only way through is to drop the wine — silently repricing a booking to
   * add a dessert to it. That is the wrong trade, and it is the one the API
   * forces.
   */
  it("refuses to add a dessert to a booking holding a withdrawn wine", async () => {
    const { POST } = await import("@/app/api/admin/reservations/[reservationNumber]/add-ons/route");
    const restaurant = await import("@/lib/services/restaurant");
    const { wines, desserts } = await setUp();

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

    expect(response.status).toBe(409);
  });
});
