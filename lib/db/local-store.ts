import { randomUUID } from "crypto";
import { getDataFilePath, readJsonFile, writeJsonFile } from "@/lib/db/json-file";
import { DEFAULT_MENU, buildDefaultDates } from "@/lib/db/seed-data";
import {
  withRemainingSeats,
  type MenuCourse,
  type ReservationRecord,
  type RestaurantDateAvailability,
  type StoredRestaurantDate,
} from "@/types/booking";

/**
 * File-backed store used when MONGODB_URI is not configured.
 *
 * It replaces the previous in-memory mock, which lost every reservation on
 * restart and — more importantly — never actually consumed seats, so the
 * restaurant could be booked past capacity indefinitely.
 */

const MENU_FILE = "menu.json";
const DATES_FILE = "dates.json";
const RESERVATIONS_FILE = "reservations.json";

/**
 * A single lock covers the whole store: creating a reservation touches both
 * the reservations file and the dates file, and those two writes must not
 * interleave with another booking's read-modify-write cycle.
 */
let storeLock: Promise<unknown> = Promise.resolve();

function withStoreLock<T>(operation: () => Promise<T>): Promise<T> {
  const result = storeLock.catch(() => undefined).then(operation);
  storeLock = result.catch(() => undefined);
  return result;
}

async function readMenu(): Promise<MenuCourse[]> {
  const menu = await readJsonFile<MenuCourse[]>(getDataFilePath(MENU_FILE), []);
  if (!Array.isArray(menu) || menu.length === 0) {
    await writeJsonFile(getDataFilePath(MENU_FILE), DEFAULT_MENU);
    return structuredClone(DEFAULT_MENU);
  }
  return menu;
}

async function readDates(): Promise<StoredRestaurantDate[]> {
  const dates = await readJsonFile<StoredRestaurantDate[]>(getDataFilePath(DATES_FILE), []);
  if (!Array.isArray(dates) || dates.length === 0) {
    const seeded = buildDefaultDates();
    await writeJsonFile(getDataFilePath(DATES_FILE), seeded);
    return seeded;
  }
  return dates;
}

async function readReservations(): Promise<ReservationRecord[]> {
  const reservations = await readJsonFile<ReservationRecord[]>(getDataFilePath(RESERVATIONS_FILE), []);
  return Array.isArray(reservations) ? reservations : [];
}

export async function getLocalMenu(): Promise<MenuCourse[]> {
  return readMenu();
}

/** Persists the menu, assigning stable ids to newly drafted courses/options. */
export async function saveLocalMenu(courses: MenuCourse[]): Promise<MenuCourse[]> {
  return withStoreLock(async () => {
    const normalized = courses.map((course) => {
      const courseId = course.id && !course.id.startsWith("draft-") ? course.id : `course-${randomUUID()}`;

      return {
        ...course,
        id: courseId,
        options: (course.options ?? []).map((option) => ({
          ...option,
          id: option.id && !option.id.startsWith("draft-") ? option.id : `option-${randomUUID()}`,
          courseId,
        })),
      };
    });

    await writeJsonFile(getDataFilePath(MENU_FILE), normalized);
    return normalized;
  });
}

export async function getLocalDates(): Promise<RestaurantDateAvailability[]> {
  const dates = await readDates();
  return [...dates].sort((a, b) => a.date.localeCompare(b.date)).map(withRemainingSeats);
}

export async function getLocalDate(date: string): Promise<RestaurantDateAvailability | null> {
  const dates = await readDates();
  const match = dates.find((entry) => entry.date === date);
  return match ? withRemainingSeats(match) : null;
}

export async function upsertLocalDate(input: {
  date: string;
  isOpen: boolean;
  capacity: number;
  serviceTime?: string;
  serviceEndTime?: string;
  premium?: boolean;
}): Promise<RestaurantDateAvailability> {
  return withStoreLock(async () => {
    const dates = await readDates();
    const index = dates.findIndex((entry) => entry.date === input.date);

    const next: StoredRestaurantDate =
      index === -1
        ? {
            date: input.date,
            isOpen: input.isOpen,
            capacity: input.capacity,
            reservedSeats: 0,
            serviceTime: input.serviceTime,
            serviceEndTime: input.serviceEndTime,
            premium: input.premium ?? false,
          }
        : {
            ...dates[index],
            isOpen: input.isOpen,
            capacity: input.capacity,
            serviceTime: input.serviceTime,
            serviceEndTime: input.serviceEndTime,
            premium: input.premium ?? false,
          };

    if (index === -1) {
      dates.push(next);
    } else {
      dates[index] = next;
    }

    await writeJsonFile(getDataFilePath(DATES_FILE), dates);
    return withRemainingSeats(next);
  });
}

export async function listLocalReservations(): Promise<ReservationRecord[]> {
  const reservations = await readReservations();
  return [...reservations].sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
}

export async function getLocalReservation(reservationNumber: string): Promise<ReservationRecord | null> {
  const reservations = await readReservations();
  return reservations.find((entry) => entry.reservationNumber === reservationNumber) ?? null;
}

export type LocalBookingResult =
  | { ok: true; reservation: ReservationRecord }
  | { ok: false; reason: "DATE_CLOSED" | "DATE_FULL" };

/**
 * Creates a reservation and consumes the seats in the same locked section, so
 * two guests booking the last table at once cannot both succeed.
 */
export async function createLocalReservation(input: {
  reservationNumber: string;
  roomNumber: string;
  guestCount: number;
  date: string;
  selections: ReservationRecord["selections"];
  contact?: ReservationRecord["contact"];
  notes?: string;
  tableNumber?: string;
  tableGroupId?: string;
  kind?: ReservationRecord["kind"];
  guestName?: string;
}): Promise<LocalBookingResult> {
  return withStoreLock(async () => {
    const dates = await readDates();
    const index = dates.findIndex((entry) => entry.date === input.date);
    const dateEntry = index === -1 ? null : dates[index];

    if (!dateEntry || !dateEntry.isOpen) {
      return { ok: false, reason: "DATE_CLOSED" };
    }

    const remainingSeats = Math.max(dateEntry.capacity - dateEntry.reservedSeats, 0);
    if (remainingSeats < input.guestCount) {
      return { ok: false, reason: "DATE_FULL" };
    }

    const timestamp = new Date().toISOString();
    const reservation: ReservationRecord = {
      reservationNumber: input.reservationNumber,
      kind: input.kind ?? "standard",
      roomNumber: input.roomNumber,
      guestName: input.guestName,
      guestCount: input.guestCount,
      date: input.date,
      selections: input.selections,
      contact: input.contact,
      // Copied from the date so the booking keeps the time it was made for,
      // even if staff later move the sitting.
      time: dateEntry.serviceTime,
      endTime: dateEntry.serviceEndTime,
      notes: input.notes,
      tableNumber: input.tableNumber,
      tableGroupId: input.tableGroupId,
      status: "confirmed",
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    const reservations = await readReservations();
    reservations.push(reservation);
    dates[index] = { ...dateEntry, reservedSeats: dateEntry.reservedSeats + input.guestCount };

    await writeJsonFile(getDataFilePath(RESERVATIONS_FILE), reservations);
    await writeJsonFile(getDataFilePath(DATES_FILE), dates);

    return { ok: true, reservation };
  });
}

/** Cancels a reservation and releases its seats. Cancelling twice is a no-op. */
export async function cancelLocalReservation(reservationNumber: string): Promise<ReservationRecord | null> {
  return withStoreLock(async () => {
    const reservations = await readReservations();
    const index = reservations.findIndex((entry) => entry.reservationNumber === reservationNumber);
    if (index === -1) {
      return null;
    }

    const reservation = reservations[index];
    if (reservation.status === "cancelled") {
      return reservation;
    }

    const cancelled: ReservationRecord = {
      ...reservation,
      status: "cancelled",
      updatedAt: new Date().toISOString(),
    };
    reservations[index] = cancelled;

    const dates = await readDates();
    const dateIndex = dates.findIndex((entry) => entry.date === reservation.date);
    if (dateIndex !== -1) {
      dates[dateIndex] = {
        ...dates[dateIndex],
        reservedSeats: Math.max(dates[dateIndex].reservedSeats - reservation.guestCount, 0),
      };
      await writeJsonFile(getDataFilePath(DATES_FILE), dates);
    }

    await writeJsonFile(getDataFilePath(RESERVATIONS_FILE), reservations);
    return cancelled;
  });
}

/**
 * Records that a reservation now anchors a shared table. The first booker's
 * own number becomes the group id, so guests can read it out to each other.
 */
export async function setLocalReservationGroup(reservationNumber: string, tableGroupId: string) {
  return withStoreLock(async () => {
    const reservations = await readReservations();
    const index = reservations.findIndex((entry) => entry.reservationNumber === reservationNumber);
    if (index === -1) {
      return null;
    }

    reservations[index] = { ...reservations[index], tableGroupId };
    await writeJsonFile(getDataFilePath(RESERVATIONS_FILE), reservations);
    return reservations[index];
  });
}

/** Sets the table number on a reservation and everyone sharing its table. */
export async function setLocalReservationTable(reservationNumber: string, tableNumber: string) {
  return withStoreLock(async () => {
    const reservations = await readReservations();
    const target = reservations.find((entry) => entry.reservationNumber === reservationNumber);
    if (!target) {
      return null;
    }

    const groupId = target.tableGroupId;
    const updated: ReservationRecord[] = [];

    for (let index = 0; index < reservations.length; index += 1) {
      const entry = reservations[index];
      const inGroup = groupId
        ? entry.tableGroupId === groupId
        : entry.reservationNumber === reservationNumber;

      if (inGroup) {
        reservations[index] = { ...entry, tableNumber, updatedAt: new Date().toISOString() };
        updated.push(reservations[index]);
      }
    }

    await writeJsonFile(getDataFilePath(RESERVATIONS_FILE), reservations);
    return updated;
  });
}

/** Replaces the menu choices on a booking, leaving everything else alone. */
export async function updateLocalReservationSelections(
  reservationNumber: string,
  selections: ReservationRecord["selections"],
) {
  return withStoreLock(async () => {
    const reservations = await readReservations();
    const index = reservations.findIndex((entry) => entry.reservationNumber === reservationNumber);
    if (index === -1) {
      return null;
    }

    reservations[index] = { ...reservations[index], selections, updatedAt: new Date().toISOString() };
    await writeJsonFile(getDataFilePath(RESERVATIONS_FILE), reservations);
    return reservations[index];
  });
}

/**
 * Removes a booking outright, releasing its seats if it was still live. A
 * cancelled booking already gave its seats back, so they are not released
 * a second time.
 */
export async function deleteLocalReservation(reservationNumber: string) {
  return withStoreLock(async () => {
    const reservations = await readReservations();
    const index = reservations.findIndex((entry) => entry.reservationNumber === reservationNumber);
    if (index === -1) {
      return null;
    }

    const [removed] = reservations.splice(index, 1);

    if (removed.status === "confirmed") {
      const dates = await readDates();
      const dateIndex = dates.findIndex((entry) => entry.date === removed.date);
      if (dateIndex !== -1) {
        dates[dateIndex] = {
          ...dates[dateIndex],
          reservedSeats: Math.max(dates[dateIndex].reservedSeats - removed.guestCount, 0),
        };
        await writeJsonFile(getDataFilePath(DATES_FILE), dates);
      }
    }

    await writeJsonFile(getDataFilePath(RESERVATIONS_FILE), reservations);
    return removed;
  });
}

export type LocalReservationPatch = {
  roomNumber?: string;
  guestCount?: number;
  date?: string;
  selections?: ReservationRecord["selections"];
  notes?: string;
  contact?: ReservationRecord["contact"];
  tableNumber?: string;
};

export type LocalUpdateResult =
  | { ok: true; reservation: ReservationRecord }
  | { ok: false; reason: "NOT_FOUND" | "DATE_CLOSED" | "DATE_FULL"; remainingSeats?: number };

/**
 * Staff edit of a booking, including moving it to another evening or changing
 * the party size.
 *
 * Seats are the delicate part: the old date has to give its seats back and the
 * new one has to have room, and both must happen in the same locked section or
 * a concurrent booking could slip into a seat this one is still holding.
 */
export async function updateLocalReservationDetails(
  reservationNumber: string,
  patch: LocalReservationPatch,
): Promise<LocalUpdateResult> {
  return withStoreLock(async () => {
    const reservations = await readReservations();
    const index = reservations.findIndex((entry) => entry.reservationNumber === reservationNumber);
    if (index === -1) {
      return { ok: false, reason: "NOT_FOUND" };
    }

    const existing = reservations[index];
    const nextDate = patch.date ?? existing.date;
    const nextGuestCount = patch.guestCount ?? existing.guestCount;
    const dates = await readDates();

    // A cancelled booking holds no seats, so there is nothing to move.
    const holdsSeats = existing.status === "confirmed";
    const dateChanged = nextDate !== existing.date;
    const countChanged = nextGuestCount !== existing.guestCount;

    if (holdsSeats && (dateChanged || countChanged)) {
      const targetIndex = dates.findIndex((entry) => entry.date === nextDate);
      const target = targetIndex === -1 ? null : dates[targetIndex];

      if (!target || !target.isOpen) {
        return { ok: false, reason: "DATE_CLOSED" };
      }

      // Seats this booking already holds on the target date do not count
      // against it, otherwise growing a party by one would need room for all.
      const seatsAlreadyHeld = dateChanged ? 0 : existing.guestCount;
      const available = Math.max(target.capacity - target.reservedSeats, 0) + seatsAlreadyHeld;

      if (available < nextGuestCount) {
        return { ok: false, reason: "DATE_FULL", remainingSeats: available };
      }

      if (dateChanged) {
        const sourceIndex = dates.findIndex((entry) => entry.date === existing.date);
        if (sourceIndex !== -1) {
          dates[sourceIndex] = {
            ...dates[sourceIndex],
            reservedSeats: Math.max(dates[sourceIndex].reservedSeats - existing.guestCount, 0),
          };
        }
        dates[targetIndex] = { ...dates[targetIndex], reservedSeats: dates[targetIndex].reservedSeats + nextGuestCount };
      } else {
        dates[targetIndex] = {
          ...dates[targetIndex],
          reservedSeats: Math.max(dates[targetIndex].reservedSeats - existing.guestCount, 0) + nextGuestCount,
        };
      }

      await writeJsonFile(getDataFilePath(DATES_FILE), dates);
    }

    const targetDate = dates.find((entry) => entry.date === nextDate);

    const updated: ReservationRecord = {
      ...existing,
      roomNumber: patch.roomNumber ?? existing.roomNumber,
      guestCount: nextGuestCount,
      date: nextDate,
      selections: patch.selections ?? existing.selections,
      notes: patch.notes ?? existing.notes,
      contact: patch.contact ?? existing.contact,
      tableNumber: patch.tableNumber ?? existing.tableNumber,
      // Moving evenings adopts that evening's sitting times.
      time: dateChanged ? targetDate?.serviceTime : existing.time,
      endTime: dateChanged ? targetDate?.serviceEndTime : existing.endTime,
      updatedAt: new Date().toISOString(),
    };

    reservations[index] = updated;
    await writeJsonFile(getDataFilePath(RESERVATIONS_FILE), reservations);

    return { ok: true, reservation: updated };
  });
}

export async function reservationNumberExists(reservationNumber: string) {
  const reservations = await readReservations();
  return reservations.some((entry) => entry.reservationNumber === reservationNumber);
}
