import { RESERVATION_PREFIX } from "@/lib/brand";
import {
  MAX_ACCEPTED_PASS_KEY_LENGTH,
  MIN_ACCEPTED_PASS_KEY_LENGTH,
  PASS_KEY_ALPHABET,
  normalizePassKey,
} from "@/lib/pass-key";

/**
 * Working out what reception has just been handed.
 *
 * ## One box, four things
 *
 * A guest at the desk can produce any of these, and the person serving them
 * should not have to know which is which before they can start:
 *
 * - **A scanned pass-key card**, whose QR encodes a booking *link* rather than
 *   a bare code — `https://…/booking?k=VDM-K7QP3-M2XR4`. Nothing about it looks
 *   like a code until the `k` is pulled out of it.
 * - **A scanned confirmation card**, whose QR is the reservation number.
 * - **A pass-key typed by hand**, in any of the ways `normalizePassKey`
 *   already tolerates — dashes, spaces, lower case, an `O` for a `0`.
 * - **The hotel's own booking reference**, which is what is on the paperwork
 *   at the front desk and the thing that survives a guest changing rooms.
 *
 * ## It guesses more than one thing on purpose
 *
 * Some strings could be two of the above, and the honest response is not to
 * pick one. This returns every reading the input plausibly has, and the lookup
 * tries all of them: a search that returns the guest is worth more than a
 * classifier that is elegantly certain and wrong. There is no cost to trying —
 * each is one indexed query behind a staff login.
 *
 * The three forms happen not to collide in practice, which is worth knowing
 * rather than relying on. A reservation number is the house prefix and six hex
 * characters; a pass-key normalises to between eight and twelve; a hotel
 * reference is short and all digits. But formats change, and a lookup that
 * quietly stopped finding people would be discovered at the desk.
 */

export type GuestLookupCandidates = {
  /** Canonical pass-key, if the input could be one. */
  passKey?: string;
  /** A restaurant reservation number, upper-cased with its prefix. */
  reservationNumber?: string;
  /** The hotel's own booking reference. */
  hotelRef?: string;
};

/**
 * The code inside a scanned card's QR, or the input unchanged.
 *
 * A pass-key card encodes `…/booking?k=CODE`; an invitation card encodes
 * `…/premium/CODE`, with the code as the last path segment. Anything that is
 * not a URL is handed back as it came.
 */
export function unwrapScannedValue(raw: string): string {
  const value = raw.trim();

  if (!/^https?:\/\//i.test(value)) {
    return value;
  }

  try {
    const url = new URL(value);
    const fromQuery = url.searchParams.get("k");

    if (fromQuery) {
      return fromQuery;
    }

    /**
     * An invitation link carries the code as the last segment. Taken only when
     * it is not one of the words the app's own routes are made of, so
     * `…/booking` does not read as a code called "booking".
     */
    const segments = url.pathname.split("/").filter(Boolean);
    const last = segments.at(-1);

    return last && !ROUTE_WORDS.has(last.toLowerCase()) ? last : value;
  } catch {
    // Not a URL after all. Nothing is lost by trying the raw string.
    return value;
  }
}

/** Path segments that are part of an address rather than something scanned. */
const ROUTE_WORDS = new Set(["booking", "premium", "admin", "manage", "confirmation"]);

/** A reservation number: the house prefix, a dash, and four to twelve characters. */
const RESERVATION_NUMBER = new RegExp(`^${RESERVATION_PREFIX}-[0-9A-Z]{4,12}$`);

/**
 * Every reading of what was scanned or typed.
 *
 * Empty when the input could not be any of them, which the screen says plainly
 * rather than running three searches that will find nothing.
 */
export function parseGuestLookup(raw: string): GuestLookupCandidates {
  const value = unwrapScannedValue(raw).trim();

  if (!value) {
    return {};
  }

  const candidates: GuestLookupCandidates = {};
  const upper = value.toUpperCase().replace(/\s+/g, "");

  if (RESERVATION_NUMBER.test(upper)) {
    candidates.reservationNumber = upper;
  }

  /**
   * A pass-key, if what is left after stripping decoration is the right length
   * and made only of the alphabet keys use.
   *
   * The alphabet check matters: `normalizePassKey` *drops* anything outside it
   * rather than refusing, so a hotel reference like `10-2245` would otherwise
   * arrive here as the perfectly plausible key `102245`.
   */
  const normalized = normalizePassKey(value);
  const looksLikeKey =
    normalized.length >= MIN_ACCEPTED_PASS_KEY_LENGTH &&
    normalized.length <= MAX_ACCEPTED_PASS_KEY_LENGTH &&
    [...normalized].every((character) => PASS_KEY_ALPHABET.includes(character));

  if (looksLikeKey) {
    candidates.passKey = normalized;
  }

  /**
   * The hotel's reference. Digits, and short — five of them today, but written
   * as a range because the number of digits is the hotel's business and has
   * changed before.
   */
  if (/^\d{3,10}$/.test(upper)) {
    candidates.hotelRef = upper;
  }

  return candidates;
}

/** Whether anything at all can be searched for. */
export function hasGuestLookupCandidates(candidates: GuestLookupCandidates): boolean {
  return Boolean(candidates.passKey || candidates.reservationNumber || candidates.hotelRef);
}
