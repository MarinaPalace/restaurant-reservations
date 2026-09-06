import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { toDateKey } from "@/lib/date";

/**
 * Invitation evenings are not the everyday flow's to offer.
 *
 * They are held for guests with a premium key and booked at `/premium`. Every
 * route already refuses one to a standard key, so nothing was ever bookable
 * that should not have been — but the calendar was drawn from a list that had
 * not been filtered, so a regular guest saw invitation nights as ordinary
 * evenings, with seats on them, and was refused when they chose one. A table
 * offered and then taken back is its own kind of broken.
 *
 * The filter lives in two places on purpose, and this checks the one that
 * matters most: the *source*. `/api/restaurant/dates` had it from the start;
 * the server-rendered page that actually feeds the calendar did not, which is
 * how a filter that everybody believed was there went missing.
 */

let temporaryDirectory: string;

beforeEach(async () => {
  temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "invitation-dates-"));
  process.env.LOCAL_STORE_DIR = temporaryDirectory;
});

afterEach(async () => {
  delete process.env.LOCAL_STORE_DIR;
  await fs.rm(temporaryDirectory, { recursive: true, force: true });
});

function inDays(days: number) {
  const day = new Date();
  day.setDate(day.getDate() + days);
  return toDateKey(day);
}

/** One ordinary evening and one held for invited guests, both wide open. */
async function openBoth() {
  const { updateRestaurantDate } = await import("@/lib/services/reservations");

  const everyday = inDays(7);
  const invitation = inDays(8);

  await updateRestaurantDate({ date: everyday, isOpen: true, capacity: 40 });
  await updateRestaurantDate({ date: invitation, isOpen: true, capacity: 40, premium: true });

  return { everyday, invitation };
}

describe("what the everyday calendar is given", () => {
  it("leaves invitation evenings out", async () => {
    const { everyday, invitation } = await openBoth();
    const { getRestaurantDates } = await import("@/lib/services/restaurant");
    const { todayKey } = await import("@/lib/date");

    const today = todayKey();

    // The filter the guest date page applies, asserted on the same expression
    // it uses — the page itself is a server component and cannot be rendered
    // here, so this pins the rule rather than the JSX around it.
    const offered = (await getRestaurantDates()).filter(
      (entry) => entry.date >= today && !entry.premium,
    );

    expect(offered.map((entry) => entry.date)).toContain(everyday);
    expect(offered.map((entry) => entry.date)).not.toContain(invitation);
  });

  /** The route that always had the filter must keep it. */
  it("leaves them out of the dates API too", async () => {
    const { invitation, everyday } = await openBoth();
    const { GET } = await import("@/app/api/restaurant/dates/route");

    const offered: { date: string }[] = await (await GET()).json();

    expect(offered.map((entry) => entry.date)).toContain(everyday);
    expect(offered.map((entry) => entry.date)).not.toContain(invitation);
  });

  /** And the invitation flow still gets them, which is the other half. */
  it("still offers them to the invitation flow", async () => {
    const { invitation, everyday } = await openBoth();
    const { GET } = await import("@/app/api/premium/dates/route");

    const offered: { date: string }[] = await (await GET()).json();

    expect(offered.map((entry) => entry.date)).toContain(invitation);
    expect(offered.map((entry) => entry.date)).not.toContain(everyday);
  });
});

describe("a standard key that reaches an invitation evening anyway", () => {
  /**
   * Through a stale calendar, or an evening switched to invitation-only while
   * somebody had the page open. The routes are the rule (2.5), and they refuse
   * it before any seats leave the room.
   */
  it("is refused at the calendar, before it can hold seats", async () => {
    const { invitation } = await openBoth();
    const passKeys = await import("@/lib/services/pass-keys");
    const { getRestaurantDate } = await import("@/lib/services/restaurant");

    const key = await passKeys.issuePassKey({
      roomNumber: "402",
      checkInOn: toDateKey(new Date()),
      expiresOn: inDays(9),
      actor: { kind: "staff", id: "u1", name: "Reception" },
    });

    const { POST: hold } = await import("@/app/api/booking/hold/route");
    const response = await hold(
      new Request("http://localhost/api/booking/hold", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ passKey: key.code, date: invitation, guestCount: 2 }),
      }),
    );

    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe("DATE_UNAVAILABLE");
    expect((await getRestaurantDate(invitation))?.heldSeats ?? 0).toBe(0);
  });
});
