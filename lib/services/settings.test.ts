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
