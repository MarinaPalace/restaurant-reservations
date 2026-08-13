export function readStoredSessionString(storage: Storage | undefined | null, key: string, fallback = "") {
  if (!storage) {
    return fallback;
  }

  return storage.getItem(key) ?? fallback;
}

export function readStoredGuestCount(storage: Storage | undefined | null): number {
  if (!storage) {
    return 1;
  }

  const rawValue = readStoredSessionString(storage, "booking-guest-count", "1");
  const guestCount = Number(rawValue);
  return Number.isFinite(guestCount) && guestCount > 0 ? guestCount : 1;
}
