import type { Dictionary } from "@/lib/i18n";

/**
 * Server messages, in the guest's language.
 *
 * The API answers with a `code` as well as an English sentence — it has done
 * since pass-keys were added, for exactly this sort of reason — so the screen
 * can look the code up in the dictionary and fall back to the server's own
 * wording when it meets one it does not know. That fallback matters: a new code
 * added on the server appears as understandable English rather than as nothing.
 *
 * The alternative, translating on the server from the request's language, was
 * rejected: the code is the API's contract, and an English sentence in a log or
 * a support ticket is worth more than a Polish one nobody at the desk reads.
 */
const CODES: Record<string, keyof Dictionary["errors"]> = {
  RATE_LIMITED: "rateLimited",
  INVALID: "passKeyInvalid",
  PASS_KEY_INVALID: "passKeyInvalid",
  PASS_KEY_REVOKED: "passKeyRevoked",
  PASS_KEY_USED: "passKeyUsed",
  PASS_KEY_EXPIRED: "passKeyExpired",
  PASS_KEY_AFTER_STAY: "passKeyAfterStay",
  PASS_KEY_TOO_MANY_GUESTS: "passKeyTooManyGuests",
  REVOKED: "passKeyRevoked",
  USED: "passKeyUsed",
  EXPIRED: "passKeyExpired",
  DATE_UNAVAILABLE: "dateUnavailable",
  DATE_FULL: "dateFull",
  BOOKING_CLOSED: "bookingClosed",
  TABLE_JOIN_FAILED: "tableJoinFailed",
  CHANGES_CLOSED: "changesClosed",
  NOT_FOUND: "notFound",
  CHOOSE_RESERVATION: "chooseReservation",
  INVALID_REQUEST: "invalidRequest",
};

export function translateApiError(
  t: Dictionary,
  data: { code?: string; error?: string } | null | undefined,
): string | undefined {
  if (!data) {
    return undefined;
  }

  const key = data.code ? CODES[data.code] : undefined;
  return key ? t.errors[key] : data.error;
}
