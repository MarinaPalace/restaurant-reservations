import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { promises as fs } from "fs";
import os from "os";
import path from "path";

/**
 * The settings store, against the local JSON backend.
 *
 * The property that matters is that a store with nothing in it behaves
 * identically to one holding the default. That is what lets a setting ship
 * without a migration (rule 2.2), and it is the state every existing
 * deployment is in the moment this is released.
 */

let temporaryDirectory: string;

beforeEach(async () => {
  temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "settings-"));
  process.env.LOCAL_STORE_DIR = temporaryDirectory;
});

afterEach(async () => {
  delete process.env.LOCAL_STORE_DIR;
  await fs.rm(temporaryDirectory, { recursive: true, force: true });
});

async function loadSettings() {
  return import("@/lib/services/settings");
}

describe("the promotions currency", () => {
  it("reads as the default when nothing has ever been saved", async () => {
    const settings = await loadSettings();
    const { DEFAULT_CURRENCY } = await import("@/lib/money");

    expect(await settings.getCurrency()).toBe(DEFAULT_CURRENCY);
  });

  it("survives a save and a restart", async () => {
    const settings = await loadSettings();
    await settings.setCurrency("BGN");

    // Imported fresh, as a new process would.
    const reloaded = await import("@/lib/services/settings");
    expect(await reloaded.getCurrency()).toBe("BGN");
  });

  it("can be changed again", async () => {
    const settings = await loadSettings();
    await settings.setCurrency("BGN");
    await settings.setCurrency("GBP");

    expect(await settings.getCurrency()).toBe("GBP");
  });

  /**
   * A currency `Intl` does not know throws when a price is formatted, so a bad
   * value must never make it into the store — nor out of it, if one somehow
   * did.
   */
  it("refuses to store something unrecognised", async () => {
    const settings = await loadSettings();
    const { DEFAULT_CURRENCY } = await import("@/lib/money");

    await settings.setCurrency("XYZ" as never);
    expect(await settings.getCurrency()).toBe(DEFAULT_CURRENCY);
  });

  it("reads a corrupted stored value as the default", async () => {
    const { setLocalSetting } = await import("@/lib/db/local-admin-store");
    const settings = await loadSettings();
    const { DEFAULT_CURRENCY } = await import("@/lib/money");

    await setLocalSetting("promo.currency", { nonsense: true });
    expect(await settings.getCurrency()).toBe(DEFAULT_CURRENCY);
  });

  /** Settings are separate rows, so one does not overwrite another. */
  it("keeps unrelated settings when one is written", async () => {
    const { getLocalSetting, setLocalSetting } = await import("@/lib/db/local-admin-store");
    const settings = await loadSettings();

    await setLocalSetting("something.else", "kept");
    await settings.setCurrency("PLN");

    expect(await getLocalSetting("something.else")).toBe("kept");
    expect(await settings.getCurrency()).toBe("PLN");
  });
});

describe("the restaurant time zone", () => {
  it("reads as the default when nothing has ever been saved", async () => {
    const settings = await loadSettings();
    const { DEFAULT_TIME_ZONE } = await import("@/lib/timezone");

    expect(await settings.getTimeZone()).toBe(DEFAULT_TIME_ZONE);
  });

  it("survives a save", async () => {
    const settings = await loadSettings();
    await settings.setTimeZone("Europe/Berlin");

    expect(await settings.getTimeZone()).toBe("Europe/Berlin");
  });

  it("refuses a zone Intl would not recognise", async () => {
    const settings = await loadSettings();
    const { DEFAULT_TIME_ZONE } = await import("@/lib/timezone");

    await settings.setTimeZone("Mars/Olympus" as never);
    expect(await settings.getTimeZone()).toBe(DEFAULT_TIME_ZONE);
  });

  /** Two settings, two rows: saving one must not disturb the other. */
  it("does not disturb the currency", async () => {
    const settings = await loadSettings();

    await settings.setCurrency("GBP");
    await settings.setTimeZone("Europe/Warsaw");

    expect(await settings.getCurrency()).toBe("GBP");
    expect(await settings.getTimeZone()).toBe("Europe/Warsaw");
  });
});

/**
 * The switch — `docs/floor-plan.md` §4.
 *
 * Stored apart from the plan, so that saving a half-drawn room cannot carry a
 * policy with it, and read through `getTableSelection` so no caller can decide
 * "guests may pick" from a stored mode alone.
 */
describe("who chooses the table", () => {
  const planWithTable = {
    zones: [
      { id: "z1", name: "Main", tables: [{ id: "t1", label: "7", seats: 4, active: true }], features: [] },
    ],
  };

  it("reads as off when nothing has ever been saved", async () => {
    const settings = await loadSettings();

    expect(await settings.getFloorPlanMode()).toBe("off");
  });

  it("survives a save", async () => {
    const settings = await loadSettings();
    await settings.setFloorPlanMode("required");

    expect(await settings.getFloorPlanMode()).toBe("required");
  });

  it("reads a value it does not recognise as off", async () => {
    const { setLocalSetting } = await import("@/lib/db/local-admin-store");
    const settings = await loadSettings();

    await setLocalSetting("restaurant.floorPlanMode", { enabled: true });
    expect(await settings.getFloorPlanMode()).toBe("off");
  });

  it("refuses to store something unrecognised", async () => {
    const settings = await loadSettings();

    await settings.setFloorPlanMode("on" as never);
    expect(await settings.getFloorPlanMode()).toBe("off");
  });

  /** The policy and the drawing are different decisions, and different rows. */
  it("does not disturb the plan, nor the plan it", async () => {
    const settings = await loadSettings();

    await settings.setFloorPlanMode("optional");
    await settings.setFloorPlan(planWithTable as never);

    expect(await settings.getFloorPlanMode()).toBe("optional");
    expect((await settings.getFloorPlan()).zones).toHaveLength(1);
  });

  /**
   * The gate every booking path will ask. It resolves rather than reports: a
   * mode of `optional` against a room with nothing pickable in it is a broken
   * booking flow, not a policy.
   */
  it("applies as off while the plan holds nothing bookable", async () => {
    const settings = await loadSettings();
    await settings.setFloorPlanMode("required");

    expect(await settings.getFloorPlanMode()).toBe("required");
    expect((await settings.getTableSelection()).mode).toBe("off");
  });

  it("applies as chosen once the room has a table in it", async () => {
    const settings = await loadSettings();
    await settings.setFloorPlan(planWithTable as never);
    await settings.setFloorPlanMode("optional");

    const selection = await settings.getTableSelection();
    expect(selection.mode).toBe("optional");
    expect(selection.plan.zones[0].tables[0].label).toBe("7");
  });
});
