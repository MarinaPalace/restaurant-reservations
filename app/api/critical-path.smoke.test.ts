import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import type { MenuCourse, MenuOption } from "@/types/booking";
import { toDateKey } from "@/lib/date";

/**
 * The whole journey, once, through the real routes.
 *
 * Everything else in this suite tests one thing carefully. This tests that the
 * things fit together: reception issues a key, a guest opens the menu, books a
 * table, takes a bottle of wine, finds their booking again, and cancels it —
 * each step an actual `Request` through the actual handler, in order, against
 * one store.
 *
 * It is deliberately shallow. The point is not to check the rules — the rules
 * have their own tests — it is that **nothing in the middle is broken**. A
 * smoke test that asserts everything fails for reasons that do not matter and
 * gets deleted; this one should only ever fail because the path is genuinely
 * broken, which is what makes it worth running before a release.
 *
 * Written for the freeze: it is the "is this thing still alive" check for a
 * codebase about to become the base of something else.
 */

let temporaryDirectory: string;

beforeEach(async () => {
  temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "critical-path-"));
  process.env.LOCAL_STORE_DIR = temporaryDirectory;

  const { resetRateLimits } = await import("@/lib/rate-limit");
  resetRateLimits();
});

afterEach(async () => {
  delete process.env.LOCAL_STORE_DIR;
  await fs.rm(temporaryDirectory, { recursive: true, force: true });
});

const ACTOR = { kind: "staff", id: "u1", name: "Reception" } as const;

/**
 * A week out, not a fixed date. The guest-facing list drops anything in the
 * past, so a hard-coded evening turns this into a test that passes until it
 * silently stops exercising the route it was written for.
 */
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

function json(url: string, body: unknown) {
  return new Request(`http://localhost${url}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("the critical path", () => {
  it("carries a guest from a pass-key to a cancelled booking without dropping anything", async () => {
    const restaurant = await import("@/lib/services/restaurant");
    const reservations = await import("@/lib/services/reservations");
    const passKeys = await import("@/lib/services/pass-keys");

    const EVENING = eveningInAWeek();

    // ---- Reception opens an evening and puts a menu on it -----------------
    await restaurant.saveMenuCatalog(
      [course("Main", [option("Sea bass"), option("Lamb")])],
      "standard",
    );
    await restaurant.saveMenuCatalog(
      [course("Wines", [option("Chardonnay", { price: 40, discountPercent: 25 })])],
      "promo",
    );
    await reservations.updateRestaurantDate({ date: EVENING, isOpen: true, capacity: 40 });

    const key = await passKeys.issuePassKey({
      roomNumber: "402",
      checkInOn: toDateKey(new Date()),
      expiresOn: EVENING,
      actor: ACTOR,
    });

    // ---- The guest checks the key opens something ------------------------
    const { POST: checkKey } = await import("@/app/api/booking/pass-key/route");
    const keyResponse = await checkKey(json("/api/booking/pass-key", { passKey: key.code }));
    expect(keyResponse.status).toBe(200);

    // ---- The evening is on offer -----------------------------------------
    const { GET: getDates } = await import("@/app/api/restaurant/dates/route");
    const datesResponse = await getDates();
    expect(datesResponse.status).toBe(200);

    const offered: { date: string }[] = await datesResponse.json();
    expect(offered.some((entry) => entry.date === EVENING)).toBe(true);

    // ---- The menu loads ---------------------------------------------------
    const menu = await restaurant.getMenuCatalog();
    const [main] = menu;
    expect(main.options.length).toBeGreaterThan(0);

    // ---- They book --------------------------------------------------------
    const { POST: book } = await import("@/app/api/reservations/route");
    const bookingResponse = await book(
      json("/api/reservations", {
        passKey: key.code,
        roomNumber: "402",
        guestCount: 2,
        date: EVENING,
        contact: { method: "email", email: "guest@example.com" },
        selections: [
          {
            guestIndex: 0,
            courseId: main.id,
            courseName: main.name,
            optionId: main.options[0].id,
            optionName: main.options[0].name,
          },
          {
            guestIndex: 1,
            courseId: main.id,
            courseName: main.name,
            optionId: main.options[1].id,
            optionName: main.options[1].name,
          },
        ],
      }),
    );

    expect(bookingResponse.status).toBe(201);
    const booked = await bookingResponse.json();
    const reservationNumber: string = booked.reservation.reservationNumber;
    expect(reservationNumber).toBeTruthy();

    // The seats actually left the evening's allowance.
    const evening = await restaurant.getRestaurantDate(EVENING);
    expect(evening?.reservedSeats).toBe(2);

    // ---- They take a bottle of wine on the confirmation screen -------------
    const [wines] = await restaurant.getPromoCatalog("en");
    const { POST: takePromotion } = await import("@/app/api/booking/add-ons/route");
    const promoResponse = await takePromotion(
      json("/api/booking/add-ons", {
        passKey: key.code,
        reservationNumber,
        addOns: [{ courseId: wines.id, optionId: wines.options[0].id }],
      }),
    );

    expect(promoResponse.status).toBe(200);

    // ---- They find it again later -----------------------------------------
    const { POST: lookUp } = await import("@/app/api/booking/manage/route");
    const lookUpResponse = await lookUp(json("/api/booking/manage", { passKey: key.code }));
    expect(lookUpResponse.status).toBe(200);

    const found = await lookUpResponse.json();
    // Each entry wraps the booking beside what the guest may still change to it.
    const mine = found.reservations.find(
      (entry: { reservation: { reservationNumber: string } }) =>
        entry.reservation.reservationNumber === reservationNumber,
    );

    expect(mine).toBeDefined();
    expect(mine.reservation.addOns?.[0]?.optionName).toBe("Chardonnay");

    // ---- The kitchen can see the whole thing -------------------------------
    const stored = await reservations.getReservationByNumber(reservationNumber);
    const { buildExtrasList } = await import("@/lib/kitchen-report");
    expect(buildExtrasList([stored!])).toHaveLength(1);

    const { buildBoard } = await import("@/lib/service-board");
    expect(buildBoard([stored!], []).length).toBeGreaterThan(0);

    // ---- And the evening's numbers add up ----------------------------------
    const { buildTotals } = await import("@/lib/analytics/metrics");
    const totals = buildTotals([stored!], [
      { date: EVENING, isOpen: true, capacity: 40, reservedSeats: 2, remainingSeats: 38 },
    ]);
    expect(totals.covers).toBe(2);
    expect(totals.promotionRevenue).toBe(30);

    // ---- They change their mind --------------------------------------------
    const { POST: cancel } = await import("@/app/api/booking/manage/cancel/route");
    const cancelResponse = await cancel(
      json("/api/booking/manage/cancel", { passKey: key.code, reservationNumber }),
    );
    expect(cancelResponse.status).toBe(200);

    const afterCancel = await reservations.getReservationByNumber(reservationNumber);
    expect(afterCancel?.status).toBe("cancelled");

    // The seats came back to the evening, which is the half most likely to rot.
    const eveningAfter = await restaurant.getRestaurantDate(EVENING);
    expect(eveningAfter?.reservedSeats).toBe(0);

    // And the wine stopped being revenue and stopped being prepared.
    expect(buildExtrasList([afterCancel!])).toHaveLength(0);
    expect(
      buildTotals([afterCancel!], [
        { date: EVENING, isOpen: true, capacity: 40, reservedSeats: 0, remainingSeats: 40 },
      ]).promotionRevenue,
    ).toBe(0);
  });
});
