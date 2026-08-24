import { randomUUID } from "crypto";
import { getDataFilePath, readJsonFile, writeJsonFile } from "@/lib/db/json-file";
import { withStoreLock } from "@/lib/db/store-lock";
import { DEFAULT_MENU, buildDefaultDates } from "@/lib/db/seed-data";
import { toEveningOverrides, type EveningOverrides } from "@/lib/evening-features";
import {
  TableClaimError,
  seatsToClaim,
  tableNumberFrom,
  type TableClaimRecord,
} from "@/lib/services/table-claims";
import {
  withRemainingSeats,
  type CancellationRecord,
  type MenuCourse,
  type ReservationRecord,
  type RestaurantDateAvailability,
  type StoredRestaurantDate,
  type TableSource,
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
const TABLE_CLAIMS_FILE = "table-claims.json";

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
  bookingCutoffHours?: number;
  tableCutoffHours?: number;
  /** Absent leaves whatever the evening already said; null clears it. */
  features?: EveningOverrides | null;
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
            bookingCutoffHours: Math.max(0, Math.round(Number(input.bookingCutoffHours ?? 0))),
            tableCutoffHours: Math.max(0, Math.round(Number(input.tableCutoffHours ?? 0))),
            features: toEveningOverrides(input.features),
          }
        : {
            ...dates[index],
            isOpen: input.isOpen,
            capacity: input.capacity,
            serviceTime: input.serviceTime,
            serviceEndTime: input.serviceEndTime,
            premium: input.premium ?? false,
            bookingCutoffHours: Math.max(0, Math.round(Number(input.bookingCutoffHours ?? 0))),
            tableCutoffHours: Math.max(0, Math.round(Number(input.tableCutoffHours ?? 0))),
            /**
             * Absent leaves what the evening already said, so a caller that
             * knows nothing about overrides cannot silently clear them. Null
             * is how the editor says "follow the restaurant again".
             */
            features:
              input.features === undefined ? dates[index].features : toEveningOverrides(input.features),
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

export async function listLocalReservationsByDate(date: string): Promise<ReservationRecord[]> {
  const reservations = await readReservations();
  return reservations
    .filter((entry) => entry.date === date)
    .sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
}

export async function listLocalReservationsBetween(from: string, to: string): Promise<ReservationRecord[]> {
  const reservations = await readReservations();
  return reservations
    .filter((entry) => entry.date >= from && entry.date <= to)
    .sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
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
  additionalRooms?: string[];
  guestCount: number;
  date: string;
  selections: ReservationRecord["selections"];
  contact?: ReservationRecord["contact"];
  notes?: string;
  tableNumber?: string;
  /**
   * The tables this booking picked, resolved from the plan by the caller.
   *
   * Usually one. Several when they were pushed together for a party no single
   * table could take — and then every seat of every one of them is claimed,
   * because a merged table cannot be shared with a stranger.
   */
  tables?: { id: string; label: string; seats: number }[];
  /** Who chose it. Only meaningful when there is a table. */
  tableSource?: TableSource;
  tableGroupId?: string;
  kind?: ReservationRecord["kind"];
  guestName?: string;
  passKeyId?: string;
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

    /**
     * The table, claimed inside the same lock as the seats.
     *
     * A refusal here leaves the seats untouched, because nothing has been
     * written yet — the local store gets for free what Mongo has to unwind by
     * hand.
     */
    let claims: TableClaimRecord[] | null = null;

    if (input.tables?.length) {
      claims = await readTableClaims();

      // Thrown rather than returned, so both stores fail a taken table the
      // same way and the route has one error to handle. Applied to the same
      // in-memory list, so a party that fits on the first table and not the
      // second takes neither.
      for (const table of input.tables) {
        applyTableClaim(claims, {
          date: input.date,
          tableId: table.id,
          seats: table.seats,
          guests: seatsToClaim(input.tables, table, input.guestCount),
          reservationNumber: input.reservationNumber,
        });
      }
    }

    const timestamp = new Date().toISOString();
    const reservation: ReservationRecord = {
      reservationNumber: input.reservationNumber,
      kind: input.kind ?? "standard",
      roomNumber: input.roomNumber,
      additionalRooms: input.additionalRooms?.length ? input.additionalRooms : undefined,
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
      tableNumber: tableNumberFrom(input.tables) ?? input.tableNumber,
      tableId: input.tables?.[0]?.id,
      tableIds: (input.tables?.length ?? 0) > 1 ? input.tables?.map((table) => table.id) : undefined,
      // Only when there is a table to attribute.
      tableSource: tableNumberFrom(input.tables) ?? input.tableNumber ? input.tableSource : undefined,
      tableSetAt: tableNumberFrom(input.tables) ?? input.tableNumber ? timestamp : undefined,
      tableGroupId: input.tableGroupId,
      status: "confirmed",
      passKeyId: input.passKeyId,
      version: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    const reservations = await readReservations();
    reservations.push(reservation);
    dates[index] = { ...dateEntry, reservedSeats: dateEntry.reservedSeats + input.guestCount };

    await writeJsonFile(getDataFilePath(RESERVATIONS_FILE), reservations);
    await writeJsonFile(getDataFilePath(DATES_FILE), dates);

    if (claims) {
      await writeJsonFile(getDataFilePath(TABLE_CLAIMS_FILE), claims);
    }

    return { ok: true, reservation };
  });
}

/** Cancels a reservation and releases its seats. Cancelling twice is a no-op. */
export async function cancelLocalReservation(
  reservationNumber: string,
  cancellation?: CancellationRecord,
): Promise<ReservationRecord | null> {
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
      cancellation,
      version: nextVersion(reservation),
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

export type LocalRestoreResult =
  | { ok: true; reservation: ReservationRecord }
  | { ok: false; reason: "NOT_FOUND" | "NOT_CANCELLED" | "DATE_CLOSED" | "DATE_FULL"; remainingSeats?: number };

/**
 * Puts a cancelled booking back, taking its seats again.
 *
 * The seats were given away when it was cancelled, so this can fail: the
 * evening may have been closed since, or somebody else may have taken the
 * table. Both are reported rather than quietly overselling the room.
 */
export async function restoreLocalReservation(reservationNumber: string): Promise<LocalRestoreResult> {
  return withStoreLock(async () => {
    const reservations = await readReservations();
    const index = reservations.findIndex((entry) => entry.reservationNumber === reservationNumber);
    if (index === -1) {
      return { ok: false, reason: "NOT_FOUND" };
    }

    const reservation = reservations[index];
    if (reservation.status !== "cancelled") {
      return { ok: false, reason: "NOT_CANCELLED" };
    }

    const dates = await readDates();
    const dateIndex = dates.findIndex((entry) => entry.date === reservation.date);
    const dateEntry = dateIndex === -1 ? null : dates[dateIndex];

    if (!dateEntry || !dateEntry.isOpen) {
      return { ok: false, reason: "DATE_CLOSED" };
    }

    const remainingSeats = Math.max(dateEntry.capacity - dateEntry.reservedSeats, 0);
    if (remainingSeats < reservation.guestCount) {
      return { ok: false, reason: "DATE_FULL", remainingSeats };
    }

    const restored: ReservationRecord = {
      ...reservation,
      status: "confirmed",
      // The cancellation is undone, so its snapshot goes with it. The audit
      // log keeps both the cancellation and this restore.
      cancellation: undefined,
      version: nextVersion(reservation),
      updatedAt: new Date().toISOString(),
    };

    reservations[index] = restored;
    dates[dateIndex] = { ...dateEntry, reservedSeats: dateEntry.reservedSeats + reservation.guestCount };

    await writeJsonFile(getDataFilePath(RESERVATIONS_FILE), reservations);
    await writeJsonFile(getDataFilePath(DATES_FILE), dates);

    return { ok: true, reservation: restored };
  });
}

/** Every booking a pass-key has made, newest first, cancelled ones included. */
export async function findLocalReservationsByPassKey(passKeyId: string): Promise<ReservationRecord[]> {
  const reservations = await readReservations();

  return reservations
    .filter((entry) => entry.passKeyId === passKeyId)
    .sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
}

/**
 * Records that a reservation now anchors a shared table. The first booker's
 * own number becomes the group id, so guests can read it out to each other.
 */
/**
 * Puts every booking of a table group at the same tables.
 *
 * The local half of `spreadTableAcrossGroup`: a party joining another and
 * pushing a table against theirs leaves the two bookings naming different
 * furniture when they are sitting at one table.
 */
export async function setLocalGroupTables(
  tableGroupId: string,
  tableIds: string[],
  tableNumber: string,
) {
  return withStoreLock(async () => {
    const reservations = await readReservations();
    let touched = false;

    for (let index = 0; index < reservations.length; index += 1) {
      if (reservations[index].tableGroupId !== tableGroupId) {
        continue;
      }

      reservations[index] = {
        ...reservations[index],
        tableNumber,
        tableId: tableIds[0],
        tableIds: tableIds.length > 1 ? tableIds : undefined,
      };
      touched = true;
    }

    if (touched) {
      await writeJsonFile(getDataFilePath(RESERVATIONS_FILE), reservations);
    }
  });
}

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
/**
 * The version a booking becomes when it is written.
 *
 * Counts recorded writes, creation included, and matches what Mongo's
 * `$inc: { version: 1 }` produces on the other store — including for a booking
 * written before versions existed, which has no counter and so lands on 1 with
 * its next write. That looks like a creation and is not one; what makes it
 * harmless is that the audit entry for that same write carries the same number,
 * and the pairing of entry to record is the whole job. `types/booking.ts` says
 * the same thing where the field is declared.
 */
function nextVersion(entry: Pick<ReservationRecord, "version">): number {
  return (entry.version ?? 0) + 1;
}

/**
 * The plan table on one booking — id, label and who chose it — or none.
 *
 * Only this booking, unlike `setLocalReservationTable`: a guest changing their
 * own table must not move the party they are sharing with, and the route
 * refuses the change for a shared booking rather than relying on this.
 */
export async function setLocalReservationPlanTable(
  reservationNumber: string,
  tables: readonly { id: string; label: string; seats: number }[],
  source: TableSource,
): Promise<ReservationRecord | null> {
  return withStoreLock(async () => {
    const reservations = await readReservations();
    const index = reservations.findIndex((entry) => entry.reservationNumber === reservationNumber);
    if (index === -1) {
      return null;
    }

    const now = new Date().toISOString();
    const existing = reservations[index];

    reservations[index] = tables.length
      ? {
          ...existing,
          tableId: tables[0].id,
          tableIds: tables.length > 1 ? tables.map((table) => table.id) : undefined,
          tableNumber: tableNumberFrom(tables),
          tableSource: source,
          tableSetAt: now,
          version: nextVersion(existing),
          updatedAt: now,
        }
      : {
          ...existing,
          tableId: undefined,
          tableIds: undefined,
          tableNumber: undefined,
          tableSource: undefined,
          tableSetAt: undefined,
          version: nextVersion(existing),
          updatedAt: now,
        };

    await writeJsonFile(getDataFilePath(RESERVATIONS_FILE), reservations);
    return reservations[index];
  });
}

export async function setLocalReservationTable(
  reservationNumber: string,
  tableNumber: string,
  source: TableSource,
) {
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
        const now = new Date().toISOString();
        // Set together or cleared together — a table with no number cannot have
        // been chosen by anybody.
        reservations[index] = tableNumber.trim()
          ? { ...entry, tableNumber, tableSource: source, tableSetAt: now, version: nextVersion(entry), updatedAt: now }
          : {
              ...entry,
              tableNumber,
              tableSource: undefined,
              tableSetAt: undefined,
              version: nextVersion(entry),
              updatedAt: now,
            };
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

    reservations[index] = {
      ...reservations[index],
      selections,
      version: nextVersion(reservations[index]),
      updatedAt: new Date().toISOString(),
    };
    await writeJsonFile(getDataFilePath(RESERVATIONS_FILE), reservations);
    return reservations[index];
  });
}

export async function updateLocalReservationAddOns(
  reservationNumber: string,
  addOns: ReservationRecord["addOns"],
) {
  return withStoreLock(async () => {
    const reservations = await readReservations();
    const index = reservations.findIndex((entry) => entry.reservationNumber === reservationNumber);
    if (index === -1) {
      return null;
    }

    reservations[index] = {
      ...reservations[index],
      addOns,
      version: nextVersion(reservations[index]),
      updatedAt: new Date().toISOString(),
    };
    await writeJsonFile(getDataFilePath(RESERVATIONS_FILE), reservations);
    return reservations[index];
  });
}

/** The staff-only note. Empty clears it, so unset has one representation. */
/* ------------------------------------------------------------------ *
 * Table claims
 * ------------------------------------------------------------------ */

/**
 * The local mirror of `lib/services/table-claims.ts`.
 *
 * Everything happens **inside the store lock**, which is this store's
 * equivalent of the conditional update Mongo does: the read and the write
 * cannot be interleaved by another claim, so two parties racing for the last
 * place at a table cannot both be told yes.
 */
export async function claimLocalTable(input: {
  date: string;
  tableId: string;
  seats: number;
  guests: number;
  reservationNumber: string;
  whole?: boolean;
  joiningWith?: string;
}): Promise<TableClaimRecord> {
  return withStoreLock(async () => {
    const claims = await readTableClaims();
    const next = applyTableClaim(claims, input);
    await writeJsonFile(getDataFilePath(TABLE_CLAIMS_FILE), claims);
    return next;
  });
}

/**
 * The claim itself, without taking the lock.
 *
 * Split out because `createLocalReservation` already holds it, and
 * `withStoreLock` is a plain mutex rather than a reentrant one — calling the
 * locking version from inside it would deadlock the whole store rather than
 * fail. Booking a table locally is therefore one lock covering the seats *and*
 * the table, which is stronger than the two separate conditional updates Mongo
 * needs and is the same guarantee.
 *
 * Mutates `claims` in place; the caller writes the file.
 */
function applyTableClaim(
  claims: TableClaimRecord[],
  input: {
    date: string;
    tableId: string;
    seats: number;
    guests: number;
    reservationNumber: string;
    whole?: boolean;
    joiningWith?: string;
  },
): TableClaimRecord {
  const index = claims.findIndex(
    (claim) => claim.date === input.date && claim.tableId === input.tableId,
  );
  const existing = index === -1 ? null : claims[index];

  // Already on this claim: the same booking asking twice must not be counted
  // twice, which is what `$addToSet` and the `$ne` filter buy on the Mongo path.
  if (existing?.reservationNumbers.includes(input.reservationNumber)) {
    return existing;
  }

  const seated = existing?.guests ?? 0;

  /**
   * One table of a row pushed together. Taken entirely — nobody can be sold a
   * seat at a table shoved against somebody's dinner — which is said by
   * `wholeFor` rather than by inflating the count of who is sitting there.
   *
   * A table somebody else is at can only be taken this way when it belongs to
   * the party being sat with, mirroring the conditional update on the Mongo
   * path.
   */
  if (input.whole) {
    const joinable =
      !existing ||
      (input.joiningWith !== undefined &&
        existing.reservationNumbers.includes(input.joiningWith));

    if (!joinable) {
      throw new TableClaimError("TABLE_TAKEN");
    }

    const next: TableClaimRecord = {
      date: input.date,
      tableId: input.tableId,
      guests: seated + input.guests,
      reservationNumbers: [...(existing?.reservationNumbers ?? []), input.reservationNumber],
      wholeFor: [...(existing?.wholeFor ?? []), input.reservationNumber],
    };

    if (index === -1) {
      claims.push(next);
    } else {
      claims[index] = next;
    }

    return next;
  }

  // Held whole by somebody else: there is no seat at it to be had, whatever
  // the count says.
  if ((existing?.wholeFor?.length ?? 0) > 0) {
    throw new TableClaimError("TABLE_TAKEN");
  }

  if (seated + input.guests > input.seats) {
    throw new TableClaimError(input.guests > input.seats ? "TABLE_TOO_SMALL" : "TABLE_TAKEN");
  }

  const next: TableClaimRecord = {
    date: input.date,
    tableId: input.tableId,
    guests: seated + input.guests,
    reservationNumbers: [...(existing?.reservationNumbers ?? []), input.reservationNumber],
    wholeFor: existing?.wholeFor ?? [],
  };

  if (index === -1) {
    claims.push(next);
  } else {
    claims[index] = next;
  }

  return next;
}

export async function releaseLocalTable(input: {
  date: string;
  tableId: string;
  guests: number;
  reservationNumber: string;
}): Promise<void> {
  await withStoreLock(async () => {
    const claims = await readTableClaims();
    const index = claims.findIndex(
      (claim) => claim.date === input.date && claim.tableId === input.tableId,
    );

    // Idempotent: a booking that is not on the claim leaves it alone rather
    // than decrementing a table somebody else is sitting at.
    if (index === -1 || !claims[index].reservationNumbers.includes(input.reservationNumber)) {
      return;
    }

    const remaining = claims[index].reservationNumbers.filter(
      (entry) => entry !== input.reservationNumber,
    );

    if (remaining.length === 0) {
      claims.splice(index, 1);
    } else {
      claims[index] = {
        ...claims[index],
        guests: Math.max(0, claims[index].guests - input.guests),
        reservationNumbers: remaining,
        wholeFor: (claims[index].wholeFor ?? []).filter(
          (entry) => entry !== input.reservationNumber,
        ),
      };
    }

    await writeJsonFile(getDataFilePath(TABLE_CLAIMS_FILE), claims);
  });
}

export async function listLocalTableClaims(date: string): Promise<TableClaimRecord[]> {
  const claims = await readTableClaims();
  return claims.filter((claim) => claim.date === date);
}

async function readTableClaims(): Promise<TableClaimRecord[]> {
  const claims = await readJsonFile<TableClaimRecord[]>(getDataFilePath(TABLE_CLAIMS_FILE), []);
  return Array.isArray(claims) ? claims : [];
}

export async function updateLocalReservationStaffNote(reservationNumber: string, note: string) {
  return withStoreLock(async () => {
    const reservations = await readReservations();
    const index = reservations.findIndex((entry) => entry.reservationNumber === reservationNumber);
    if (index === -1) {
      return null;
    }

    const next = {
      ...reservations[index],
      version: nextVersion(reservations[index]),
      updatedAt: new Date().toISOString(),
    };

    if (note) {
      next.staffNote = note;
    } else {
      delete next.staffNote;
    }

    reservations[index] = next;
    await writeJsonFile(getDataFilePath(RESERVATIONS_FILE), reservations);
    return next;
  });
}

export async function updateLocalReservationAttendance(
  reservationNumber: string,
  attendance: ReservationRecord["attendance"] | null,
) {
  return withStoreLock(async () => {
    const reservations = await readReservations();
    const index = reservations.findIndex((entry) => entry.reservationNumber === reservationNumber);
    if (index === -1) {
      return null;
    }

    const next = {
      ...reservations[index],
      version: nextVersion(reservations[index]),
      updatedAt: new Date().toISOString(),
    };
    if (attendance) {
      next.attendance = attendance;
    } else {
      // Cleared, not set to a different claim: undoing a mis-tap returns the
      // booking to "unknown".
      delete next.attendance;
    }

    reservations[index] = next;
    await writeJsonFile(getDataFilePath(RESERVATIONS_FILE), reservations);
    return next;
  });
}

/**
 * Marks one course served, or not.
 *
 * The whole read-modify-write happens inside the store lock, which is what
 * gives the local backend the same guarantee Mongo gets from a dotted `$set`:
 * two marks on the same table cannot lose each other.
 */
export async function updateLocalReservationCourseServed(
  reservationNumber: string,
  courseId: string,
  servedAt: string | null,
) {
  return withStoreLock(async () => {
    const reservations = await readReservations();
    const index = reservations.findIndex((entry) => entry.reservationNumber === reservationNumber);
    if (index === -1) {
      return null;
    }

    const current = reservations[index];
    const servedMap = { ...(current.service?.servedAt ?? {}) };

    if (servedAt) {
      servedMap[courseId] = servedAt;
    } else {
      delete servedMap[courseId];
    }

    const next: ReservationRecord = {
      ...current,
      service: { ...current.service, servedAt: servedMap },
      version: nextVersion(current),
      updatedAt: new Date().toISOString(),
    };

    reservations[index] = next;
    await writeJsonFile(getDataFilePath(RESERVATIONS_FILE), reservations);
    return next;
  });
}

/**
 * Marks one guest's plate served, or not.
 *
 * The read-modify-write is inside the store lock, which is what gives the local
 * backend the same guarantee Mongo gets from a keyed `$set`: two marks on the
 * same course cannot lose each other.
 */
export async function updateLocalReservationGuestServed(
  reservationNumber: string,
  courseId: string,
  guestIndex: number,
  servedAt: string | null,
) {
  return withStoreLock(async () => {
    const reservations = await readReservations();
    const index = reservations.findIndex((entry) => entry.reservationNumber === reservationNumber);
    if (index === -1) {
      return null;
    }

    const current = reservations[index];
    const byCourse = { ...(current.service?.servedGuests ?? {}) };
    const plates = { ...(byCourse[courseId] ?? {}) };

    if (servedAt) {
      plates[String(guestIndex)] = servedAt;
    } else {
      delete plates[String(guestIndex)];
    }

    byCourse[courseId] = plates;

    const next: ReservationRecord = {
      ...current,
      service: { ...current.service, servedGuests: byCourse },
      version: nextVersion(current),
      updatedAt: new Date().toISOString(),
    };

    reservations[index] = next;
    await writeJsonFile(getDataFilePath(RESERVATIONS_FILE), reservations);
    return next;
  });
}

/** Every guest's plate of one course at once — the fast path. */
export async function updateLocalReservationCourseGuests(
  reservationNumber: string,
  courseId: string,
  guestIndexes: readonly number[],
  servedAt: string | null,
) {
  return withStoreLock(async () => {
    const reservations = await readReservations();
    const index = reservations.findIndex((entry) => entry.reservationNumber === reservationNumber);
    if (index === -1) {
      return null;
    }

    const current = reservations[index];
    const byCourse = { ...(current.service?.servedGuests ?? {}) };
    const plates = { ...(byCourse[courseId] ?? {}) };

    for (const guestIndex of guestIndexes) {
      if (servedAt) {
        plates[String(guestIndex)] = servedAt;
      } else {
        delete plates[String(guestIndex)];
      }
    }

    byCourse[courseId] = plates;

    // The legacy whole-course mark is cleared either way, so a record from the
    // first version of the board cannot linger and contradict the detail.
    const legacy = { ...(current.service?.servedAt ?? {}) };
    delete legacy[courseId];

    const next: ReservationRecord = {
      ...current,
      service: { servedAt: legacy, servedGuests: byCourse },
      version: nextVersion(current),
      updatedAt: new Date().toISOString(),
    };

    reservations[index] = next;
    await writeJsonFile(getDataFilePath(RESERVATIONS_FILE), reservations);
    return next;
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
  additionalRooms?: string[];
  guestCount?: number;
  date?: string;
  selections?: ReservationRecord["selections"];
  notes?: string;
  contact?: ReservationRecord["contact"];
  tableNumber?: string;
  /** Who set that table. Ignored unless `tableNumber` is being set. */
  tableSource?: TableSource;
  /**
   * Which table group this booking now belongs to, already resolved by the
   * service — `null` to take it off one, absent to leave it alone. Resolved
   * out there because finding it writes to the *other* booking, and that write
   * takes the store lock this update is holding.
   */
  tableGroupId?: string | null;
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
      // An empty list means the extra rooms were removed, which is a real
      // change — so this cannot fall back to what was there before.
      additionalRooms: patch.additionalRooms
        ? patch.additionalRooms.length
          ? patch.additionalRooms
          : undefined
        : existing.additionalRooms,
      guestCount: nextGuestCount,
      date: nextDate,
      selections: patch.selections ?? existing.selections,
      notes: patch.notes ?? existing.notes,
      contact: patch.contact ?? existing.contact,
      tableNumber: patch.tableNumber ?? existing.tableNumber,
      // Set together or cleared together, so the source can never describe a
      // table that is no longer there.
      ...(patch.tableNumber === undefined
        ? {}
        : patch.tableNumber.trim()
          ? { tableSource: patch.tableSource ?? "staff", tableSetAt: new Date().toISOString() }
          : { tableSource: undefined, tableSetAt: undefined }),
      // null means it was taken off the table, which is a real change and so
      // cannot fall back to the group it was on.
      tableGroupId:
        patch.tableGroupId === undefined ? existing.tableGroupId : (patch.tableGroupId ?? undefined),
      // Moving evenings adopts that evening's sitting times.
      time: dateChanged ? targetDate?.serviceTime : existing.time,
      endTime: dateChanged ? targetDate?.serviceEndTime : existing.endTime,
      version: nextVersion(existing),
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
