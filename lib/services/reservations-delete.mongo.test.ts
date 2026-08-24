import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import mongoose from "mongoose";

/**
 * Deleting a booking, against a real MongoDB.
 *
 * Cancelling had always handed back both claims — the seats and the table.
 * Deleting handed back only the seats, and the table it kept could never be
 * reached again: the booking that held it was gone, so nothing on any screen
 * could explain why the table read busy for the rest of the evening. Staff
 * deleting a test booking is exactly how it was found.
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

async function loadServices() {
  return {
    reservations: await import("@/lib/services/reservations"),
    claims: await import("@/lib/services/table-claims"),
  };
}

async function openDate(date: string, capacity: number) {
  const { reservations } = await loadServices();
  await reservations.updateRestaurantDate({ date, isOpen: true, capacity });
}

describe("deleting a booking that held a table", () => {
  it("gives a single table back", async () => {
    const { reservations, claims } = await loadServices();
    await openDate("2026-11-01", 20);

    const created = await reservations.createReservationEntry({
      roomNumber: "402",
      guestCount: 2,
      date: "2026-11-01",
      guestName: "Petrov",
      selections: [],
      tables: [{ id: "f-aaaaaaaa", label: "7", seats: 4 }],
    });

    expect(await claims.listTableClaims("2026-11-01")).toHaveLength(1);

    await reservations.deleteReservation(created.reservationNumber);

    expect(await claims.listTableClaims("2026-11-01")).toEqual([]);
  });

  it("gives every table of a merged holding back", async () => {
    const { reservations, claims } = await loadServices();
    await openDate("2026-11-02", 20);

    const created = await reservations.createReservationEntry({
      roomNumber: "402",
      guestCount: 6,
      date: "2026-11-02",
      guestName: "Petrov",
      selections: [],
      tables: [
        { id: "f-aaaaaaaa", label: "1", seats: 2 },
        { id: "f-bbbbbbbb", label: "2", seats: 2 },
        { id: "f-cccccccc", label: "3", seats: 2 },
      ],
    });

    expect(created.tableNumber).toBe("1 + 2 + 3");
    expect(await claims.listTableClaims("2026-11-02")).toHaveLength(3);

    await reservations.deleteReservation(created.reservationNumber);

    expect(await claims.listTableClaims("2026-11-02")).toEqual([]);
  });

  it("releases nothing twice when the booking was cancelled first", async () => {
    // Cancelling already gave the table back, and releasing is idempotent by
    // filter — so deleting afterwards must not decrement a claim somebody else
    // has since opened on the same table.
    const { reservations, claims } = await loadServices();
    await openDate("2026-11-03", 20);

    const mine = await reservations.createReservationEntry({
      roomNumber: "402",
      guestCount: 2,
      date: "2026-11-03",
      guestName: "Petrov",
      selections: [],
      tables: [{ id: "f-aaaaaaaa", label: "7", seats: 4 }],
    });

    await reservations.cancelReservation(mine.reservationNumber);

    const theirs = await reservations.createReservationEntry({
      roomNumber: "118",
      guestCount: 3,
      date: "2026-11-03",
      guestName: "Ivanova",
      selections: [],
      tables: [{ id: "f-aaaaaaaa", label: "7", seats: 4 }],
    });

    await reservations.deleteReservation(mine.reservationNumber);

    const [claim] = await claims.listTableClaims("2026-11-03");

    expect(claim?.guests).toBe(3);
    expect(claim?.reservationNumbers).toEqual([theirs.reservationNumber]);
  });
});

/**
 * A party joining another party and needing more room than their table has.
 *
 * The case the whole `wholeFor` idea exists for. Two four-tops pushed together
 * seat six; the first party is already at one of them, so the second cannot
 * simply claim it whole — the arithmetic would fill the table to capacity and
 * cancelling could then only give back the whole thing, wiping out the party
 * that was there first.
 */
describe("pushing tables onto a party already seated", () => {
  const ANCHOR = { id: "f-aaaaaaaa", label: "11", seats: 4 };
  const NEXT = { id: "f-bbbbbbbb", label: "12", seats: 4 };

  async function seatFirstParty(date: string, guests = 2) {
    const { reservations } = await loadServices();
    await openDate(date, 20);

    return reservations.createReservationEntry({
      roomNumber: "402",
      guestCount: guests,
      date,
      guestName: "Petrov",
      selections: [],
      tables: [ANCHOR],
    });
  }

  it("holds their table whole without inflating who is sitting at it", async () => {
    const { reservations, claims } = await loadServices();
    const first = await seatFirstParty("2026-12-01");

    await reservations.createReservationEntry({
      roomNumber: "118",
      guestCount: 4,
      date: "2026-12-01",
      guestName: "Ivanova",
      selections: [],
      tables: [ANCHOR, NEXT],
      joinReservationNumber: first.reservationNumber,
    });

    const shared = (await claims.listTableClaims("2026-12-01")).find((c) => c.tableId === ANCHOR.id);

    // Still the two people who are actually there, not the table's capacity.
    expect(shared?.guests).toBe(2);
    expect(shared?.wholeFor).toHaveLength(1);
    expect(shared?.reservationNumbers).toHaveLength(2);
  });

  it("offers that table to nobody else, however few are counted at it", async () => {
    const { reservations, claims } = await loadServices();
    const first = await seatFirstParty("2026-12-02");

    await reservations.createReservationEntry({
      roomNumber: "118",
      guestCount: 4,
      date: "2026-12-02",
      guestName: "Ivanova",
      selections: [],
      tables: [ANCHOR, NEXT],
      joinReservationNumber: first.reservationNumber,
    });

    // Two of its four seats are counted, and none of them are for sale: a
    // stranger cannot be seated at a table shoved against somebody's dinner.
    await expect(
      claims.claimTable({
        date: "2026-12-02",
        tableId: ANCHOR.id,
        seats: 4,
        guests: 2,
        reservationNumber: "R-STRANGER",
      }),
    ).rejects.toThrow("TABLE_TAKEN");
  });

  it("gives back exactly what it took, leaving the first party where they were", async () => {
    const { reservations, claims } = await loadServices();
    const first = await seatFirstParty("2026-12-03");

    const second = await reservations.createReservationEntry({
      roomNumber: "118",
      guestCount: 4,
      date: "2026-12-03",
      guestName: "Ivanova",
      selections: [],
      tables: [ANCHOR, NEXT],
      joinReservationNumber: first.reservationNumber,
    });

    await reservations.cancelReservation(second.reservationNumber);

    const after = await claims.listTableClaims("2026-12-03");
    const shared = after.find((claim) => claim.tableId === ANCHOR.id);

    // The first party is untouched and their table is theirs again.
    expect(shared?.guests).toBe(2);
    expect(shared?.wholeFor).toEqual([]);
    expect(shared?.reservationNumbers).toEqual([first.reservationNumber]);
    // The table that was only ever the joining party's is back in the room.
    expect(after.find((claim) => claim.tableId === NEXT.id)).toBeUndefined();
  });

  it("will not take a table the party being joined is not actually at", async () => {
    // The number is a credential, not an instruction: naming a booking cannot
    // hand over a table that booking never had.
    const { reservations, claims } = await loadServices();
    const first = await seatFirstParty("2026-12-04");

    await reservations.createReservationEntry({
      roomNumber: "301",
      guestCount: 4,
      date: "2026-12-04",
      guestName: "Dimitrova",
      selections: [],
      tables: [NEXT],
    });

    await expect(
      reservations.createReservationEntry({
        roomNumber: "118",
        guestCount: 4,
        date: "2026-12-04",
        guestName: "Ivanova",
        selections: [],
        tables: [ANCHOR, NEXT],
        joinReservationNumber: first.reservationNumber,
      }),
    ).rejects.toThrow();

    // And the first party still has their table.
    const shared = (await claims.listTableClaims("2026-12-04")).find((c) => c.tableId === ANCHOR.id);
    expect(shared?.reservationNumbers).toEqual([first.reservationNumber]);
  });
});
