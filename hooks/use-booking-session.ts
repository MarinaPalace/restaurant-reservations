"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import {
  BOOKING_STORAGE_KEYS,
  EMPTY_BOOKING_SESSION,
  REQUIREMENT_ROUTES,
  findMissingRequirement,
  readBookingSession,
  readStoredConfirmation,
  type BookingSession,
  type BookingStepRequirement,
} from "@/lib/booking-session";
import type { ReservationRecord } from "@/types/booking";

/**
 * sessionStorage exposed through useSyncExternalStore.
 *
 * Reading storage during render (the previous approach) makes the server and
 * client disagree and produces a hydration mismatch; reading it in an effect
 * and calling setState causes a cascading render. This does neither: React
 * gets a server snapshot of empty defaults and swaps in the real values right
 * after hydration.
 */

const listeners = new Set<() => void>();

let cachedSnapshot: BookingSession = EMPTY_BOOKING_SESSION;
let cacheValid = false;

let cachedConfirmation: ReservationRecord | null = null;
let confirmationCacheValid = false;

function readSnapshot(): BookingSession {
  if (!cacheValid) {
    cachedSnapshot = readBookingSession(typeof window === "undefined" ? null : window.sessionStorage);
    cacheValid = true;
  }
  // Must be referentially stable between renders or React re-renders forever.
  return cachedSnapshot;
}

function readConfirmationSnapshot(): ReservationRecord | null {
  if (!confirmationCacheValid) {
    cachedConfirmation = readStoredConfirmation(typeof window === "undefined" ? null : window.sessionStorage);
    confirmationCacheValid = true;
  }
  return cachedConfirmation;
}

function emitChange() {
  cacheValid = false;
  confirmationCacheValid = false;
  for (const listener of listeners) {
    listener();
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  // Keeps duplicate tabs of the same booking in step.
  window.addEventListener("storage", emitChange);

  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      window.removeEventListener("storage", emitChange);
    }
  };
}

function getServerSnapshot() {
  return EMPTY_BOOKING_SESSION;
}

type SessionPatch = Partial<
  Pick<
    BookingSession,
    | "passKey"
    | "passKeyExpiresOn"
    | "passKeyBookedDates"
    | "passKeyMaxGuests"
    | "roomNumber"
    | "guestCount"
    | "date"
    | "tableId"
    | "joinNumber"
    | "selections"
    | "language"
    | "holdId"
    | "holdExpiresAt"
    | "holdDate"
    | "holdGuests"
  >
>;

export function writeBookingSession(patch: SessionPatch) {
  if (typeof window === "undefined") {
    return;
  }

  const storage = window.sessionStorage;

  if (patch.passKey !== undefined) storage.setItem(BOOKING_STORAGE_KEYS.passKey, patch.passKey);
  // An empty string is a real answer here -- "any table" -- so it is stored
  // rather than treated as nothing to write.
  if (patch.tableId !== undefined) storage.setItem(BOOKING_STORAGE_KEYS.tableId, patch.tableId);
  // Empty is a real answer here too: "we are not sitting with anybody".
  if (patch.joinNumber !== undefined) {
    storage.setItem(BOOKING_STORAGE_KEYS.joinNumber, patch.joinNumber);
  }
  if (patch.passKeyExpiresOn !== undefined) {
    storage.setItem(BOOKING_STORAGE_KEYS.passKeyExpiresOn, patch.passKeyExpiresOn);
  }
  if (patch.passKeyBookedDates !== undefined) {
    storage.setItem(BOOKING_STORAGE_KEYS.passKeyBookedDates, JSON.stringify(patch.passKeyBookedDates));
  }
  if (patch.passKeyMaxGuests !== undefined) {
    storage.setItem(BOOKING_STORAGE_KEYS.passKeyMaxGuests, String(patch.passKeyMaxGuests));
  }
  if (patch.roomNumber !== undefined) storage.setItem(BOOKING_STORAGE_KEYS.roomNumber, patch.roomNumber);
  if (patch.guestCount !== undefined) storage.setItem(BOOKING_STORAGE_KEYS.guestCount, String(patch.guestCount));
  if (patch.date !== undefined) storage.setItem(BOOKING_STORAGE_KEYS.date, patch.date);
  if (patch.language !== undefined) storage.setItem(BOOKING_STORAGE_KEYS.language, patch.language);
  if (patch.selections !== undefined) {
    storage.setItem(BOOKING_STORAGE_KEYS.selections, JSON.stringify(patch.selections));
  }
  // Empty is a real answer for all four: "we are holding nothing", which is
  // what letting a hold go has to be able to say.
  if (patch.holdId !== undefined) storage.setItem(BOOKING_STORAGE_KEYS.holdId, patch.holdId);
  if (patch.holdExpiresAt !== undefined) {
    storage.setItem(BOOKING_STORAGE_KEYS.holdExpiresAt, patch.holdExpiresAt);
  }
  if (patch.holdDate !== undefined) storage.setItem(BOOKING_STORAGE_KEYS.holdDate, patch.holdDate);
  if (patch.holdGuests !== undefined) {
    storage.setItem(BOOKING_STORAGE_KEYS.holdGuests, String(patch.holdGuests));
  }

  emitChange();
}

export function clearBookingSession() {
  if (typeof window === "undefined") {
    return;
  }

  for (const key of Object.values(BOOKING_STORAGE_KEYS)) {
    window.sessionStorage.removeItem(key);
  }

  emitChange();
}

export function storeConfirmation(reservation: unknown) {
  if (typeof window === "undefined") {
    return;
  }
  window.sessionStorage.setItem(BOOKING_STORAGE_KEYS.confirmation, JSON.stringify(reservation));

  /**
   * The hold is spent by the time a confirmation exists — the seats moved from
   * held to booked to produce it — so the session must stop naming it.
   *
   * A key may allow several dinners, and a guest who books a second one would
   * otherwise arrive at the calendar with a receipt for seats that are now a
   * booking: the evening would be drawn with four seats added back that nobody
   * has, and the countdown would still be running on the steps after it.
   */
  /**
   * The calendar reads which evenings this key has booked, and it read that
   * list once, at the entry step — so without this a guest booking a second
   * dinner in the same session would be offered the evening they had just
   * taken. The route refuses it either way; this stops the offer being made.
   */
  const booked = readBookingSession(window.sessionStorage).passKeyBookedDates;
  const date = (reservation as { date?: unknown })?.date;

  if (typeof date === "string" && date && !booked.includes(date)) {
    window.sessionStorage.setItem(
      BOOKING_STORAGE_KEYS.passKeyBookedDates,
      JSON.stringify([...booked, date]),
    );
  }

  for (const key of [
    BOOKING_STORAGE_KEYS.holdId,
    BOOKING_STORAGE_KEYS.holdExpiresAt,
    BOOKING_STORAGE_KEYS.holdDate,
    BOOKING_STORAGE_KEYS.holdGuests,
  ]) {
    window.sessionStorage.removeItem(key);
  }

  emitChange();
}

export function useBookingSession() {
  return useSyncExternalStore(subscribe, readSnapshot, getServerSnapshot);
}

/** The reservation just created, for the confirmation screen. */
export function useConfirmation() {
  return useSyncExternalStore(subscribe, readConfirmationSnapshot, () => null);
}

/** True once the client has taken over from the server-rendered markup. */
export function useHydrated() {
  return useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
}

/**
 * Sends the guest back to the earliest step they have not completed, so a
 * deep link to a later step cannot submit a half-empty booking.
 */
export function useBookingGuard(requirements: BookingStepRequirement[]) {
  const router = useRouter();
  const session = useBookingSession();
  const hydrated = useHydrated();
  const missing = hydrated ? findMissingRequirement(session, requirements) : null;

  useEffect(() => {
    if (missing) {
      router.replace(REQUIREMENT_ROUTES[missing]);
    }
  }, [missing, router]);

  return { session, hydrated, ready: hydrated && !missing };
}

export function useSessionSelections() {
  const session = useBookingSession();

  const setSelections = useCallback((selections: BookingSession["selections"]) => {
    writeBookingSession({ selections });
  }, []);

  return [session.selections, setSelections] as const;
}
