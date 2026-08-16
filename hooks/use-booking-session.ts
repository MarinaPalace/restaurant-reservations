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
    | "selections"
    | "language"
  >
>;

export function writeBookingSession(patch: SessionPatch) {
  if (typeof window === "undefined") {
    return;
  }

  const storage = window.sessionStorage;

  if (patch.passKey !== undefined) storage.setItem(BOOKING_STORAGE_KEYS.passKey, patch.passKey);
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
