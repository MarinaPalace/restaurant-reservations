/**
 * How long a guest's seats are held while they finish booking.
 *
 * Fifteen minutes is long enough to read a menu for a party of six and short
 * enough that an abandoned tab does not keep an evening shut. It is a constant
 * rather than a setting because both ends have to agree on it — the server
 * stamps the expiry, the screen counts down to it — and a number that could
 * differ between them is a countdown that lies.
 */
export const SEAT_HOLD_MINUTES = 15;

export const SEAT_HOLD_MS = SEAT_HOLD_MINUTES * 60_000;

/**
 * A grace period on top of the hold before its seats may be swept back by the
 * safety net rather than by the hold itself.
 *
 * Only the net uses it. An expired hold is released the moment anybody looks
 * at the evening; this is for the seats of a hold whose document never made it,
 * where the only evidence left is that nothing has happened for a while.
 */
export const SEAT_HOLD_STRAND_MS = SEAT_HOLD_MS + 60_000;

/** Ids are opaque to everything but the store, and never guessable. */
export const SEAT_HOLD_ID_LENGTH = 36;

export function seatHoldExpiry(now: Date = new Date()): Date {
  return new Date(now.getTime() + SEAT_HOLD_MS);
}

export function isSeatHoldLive(expiresAt: string | Date | undefined, now: Date = new Date()): boolean {
  if (!expiresAt) {
    return false;
  }

  const time = expiresAt instanceof Date ? expiresAt.getTime() : Date.parse(expiresAt);
  return Number.isFinite(time) && time > now.getTime();
}

/**
 * Whole seconds left on a hold, floored at zero.
 *
 * Floored rather than rounded: a countdown that shows 1 while the server has
 * already let the seats go is the same lie in miniature that this feature
 * exists to stop.
 */
export function seatHoldSecondsLeft(expiresAt: string | Date | undefined, now: Date = new Date()): number {
  if (!expiresAt) {
    return 0;
  }

  const time = expiresAt instanceof Date ? expiresAt.getTime() : Date.parse(expiresAt);
  if (!Number.isFinite(time)) {
    return 0;
  }

  return Math.max(0, Math.floor((time - now.getTime()) / 1000));
}

/** `14:03`, the way a countdown is read. */
export function formatSeatHoldClock(secondsLeft: number): string {
  const safe = Math.max(0, Math.floor(secondsLeft));
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

/**
 * A guest's claim on some seats while they finish booking.
 *
 * The shape lives here rather than beside the service so that the JSON store
 * can speak it without importing the service that imports the store. Both
 * stores return exactly this, so the route above them cannot tell which it is
 * talking to.
 */
export type SeatHoldRecord = {
  holdId: string;
  date: string;
  guests: number;
  passKeyId: string;
  /** ISO instant. Unlike `date`, this is a moment, not a calendar day. */
  expiresAt: string;
};

/** Raised when seats could not be held. The route turns it into a 409. */
export class SeatHoldError extends Error {
  constructor(readonly code: "DATE_CLOSED" | "DATE_FULL") {
    super(code);
    this.name = "SeatHoldError";
  }
}
