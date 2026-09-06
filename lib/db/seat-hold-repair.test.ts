import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { promises as fs } from "fs";
import os from "os";
import path from "path";

/**
 * The JSON store's half of the seat-hold arithmetic.
 *
 * Specifically the repair path, which is the one that cannot be reached by
 * using the app normally: a process killed between writing the holds file and
 * writing the dates file leaves seats held by no receipt at all. The Mongo path
 * recovers from that; this one has to as well, or reception cannot sell those
 * seats for the rest of the evening and nothing on any screen explains why.
 */

let temporaryDirectory: string;

beforeEach(async () => {
  temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "local-holds-"));
  process.env.LOCAL_STORE_DIR = temporaryDirectory;
});

afterEach(async () => {
  delete process.env.LOCAL_STORE_DIR;
  await fs.rm(temporaryDirectory, { recursive: true, force: true });

  const { resetSweepThrottle } = await import("@/lib/services/seat-holds");
  resetSweepThrottle();
});

const DATE = "2026-09-18";

/** An evening holding seats that no hold accounts for, as a crash would leave it. */
async function strandSeats() {
  const { updateRestaurantDate } = await import("@/lib/services/reservations");
  await updateRestaurantDate({ date: DATE, isOpen: true, capacity: 10 });

  const datesFile = path.join(temporaryDirectory, "dates.json");
  const dates = JSON.parse(await fs.readFile(datesFile, "utf8"));

  for (const entry of dates) {
    if (entry.date === DATE) {
      entry.heldSeats = 4;
      // Long enough ago that no live hold could still be behind it.
      entry.heldSeatsTouchedAt = new Date(Date.now() - 60 * 60_000).toISOString();
    }
  }

  await fs.writeFile(datesFile, JSON.stringify(dates, null, 2), "utf8");
}

describe("seats stranded by a crash", () => {
  /**
   * The repair used to be computed on every read and saved on none of them: the
   * sweep decided whether to write by counting *closed holds*, and here there
   * are none to close. So the phantom seats came back out of the file every
   * time, for ever.
   */
  it("are given back, and stay given back", async () => {
    await strandSeats();

    const { getRestaurantDates } = await import("@/lib/services/restaurant");
    const { resetSweepThrottle } = await import("@/lib/services/seat-holds");

    const first = (await getRestaurantDates()).find((entry) => entry.date === DATE);
    expect(first?.heldSeats).toBe(0);
    expect(first?.remainingSeats).toBe(10);

    // The point of the test: it must have been written, not merely computed.
    const datesFile = path.join(temporaryDirectory, "dates.json");
    const saved = JSON.parse(await fs.readFile(datesFile, "utf8"));
    expect(saved.find((entry: { date: string }) => entry.date === DATE).heldSeats).toBe(0);

    resetSweepThrottle();
    const second = (await getRestaurantDates()).find((entry) => entry.date === DATE);
    expect(second?.heldSeats).toBe(0);
  });

  /** And reception can sell them again, which was the visible symptom. */
  it("can be booked by the desk afterwards", async () => {
    await strandSeats();

    const { getRestaurantDates } = await import("@/lib/services/restaurant");
    await getRestaurantDates();

    const { createReservationEntry } = await import("@/lib/services/reservations");

    await expect(
      createReservationEntry({
        roomNumber: "402",
        guestCount: 10,
        date: DATE,
        selections: [],
      }),
    ).resolves.toMatchObject({ guestCount: 10 });
  });

  /** A live hold is never mistaken for wreckage. */
  it("leaves an evening somebody is actually holding alone", async () => {
    const { updateRestaurantDate } = await import("@/lib/services/reservations");
    const { holdSeats } = await import("@/lib/services/seat-holds");
    const { getRestaurantDates } = await import("@/lib/services/restaurant");

    await updateRestaurantDate({ date: DATE, isOpen: true, capacity: 10 });
    await holdSeats({ date: DATE, guests: 4, passKeyId: "key-1" });

    const evening = (await getRestaurantDates()).find((entry) => entry.date === DATE);
    expect(evening?.heldSeats).toBe(4);
    expect(evening?.remainingSeats).toBe(6);
  });
});
