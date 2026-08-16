import { randomBytes } from "crypto";

/**
 * Pass-keys: the proof that somebody is actually staying here.
 *
 * A guest is handed one at check-in and types it into the booking flow. It is
 * the only way a reservation can be created, which closes the hole where
 * anyone who knew a room number could book a table, and it is what a guest
 * later presents to change or cancel their booking — the reservation number is
 * not a secret, because guests read it out to each other to share a table.
 *
 * The code is designed to be typed on a phone by somebody reading a printed
 * slip:
 *
 * - **Crockford base32** — the digits plus A–Z without `I`, `L`, `O` and `U`.
 *   The confusable characters simply do not occur, and the ones people type
 *   anyway are folded onto what they meant (`O` → `0`, `I`/`l` → `1`).
 * - **Case-insensitive**, so a phone keyboard capitalising the first letter
 *   does not matter.
 * - **Dashes are decoration.** They are stripped before anything is compared,
 *   so `vdm-k7qp-3m2x-r4tn`, `VDMK7QP3M2XR4TN` and `vdm k7qp 3m2x r4tn` are
 *   all the same key.
 * - **60 bits of entropy** in twelve characters. Guessing one is not a
 *   realistic attack even before the rate limit in front of it.
 */

/** Crockford base32: no I, L, O or U, so nothing in a code is ambiguous. */
export const PASS_KEY_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

export const PASS_KEY_PREFIX = "VDM";

/**
 * Ten characters at five bits each — fifty bits, about a quadrillion codes.
 *
 * Shortened from twelve because a guest types this off a printed card on a
 * phone, and every character is a chance to give up. Ten is the balance: two
 * fewer to type, and still far beyond brute force over HTTP, especially behind
 * the rate limiter.
 */
export const PASS_KEY_LENGTH = 10;

/**
 * Codes issued before the length changed are still in guests' hands, so they
 * must keep working. Anything in this range is a plausible key and is looked
 * up rather than rejected out of hand.
 */
export const MIN_ACCEPTED_PASS_KEY_LENGTH = 8;
export const MAX_ACCEPTED_PASS_KEY_LENGTH = 12;

/** Two blocks of five: `VDM-K7QP3-M2XR4`. */
const GROUP_SIZE = 5;

/**
 * What people type when they mean an alphabet character. Applied before
 * validation, so the usual misreadings of a printed slip still work.
 */
const CONFUSABLES: Record<string, string> = {
  O: "0",
  I: "1",
  L: "1",
  U: "V",
};

/**
 * Reduces any way of writing a key to the one canonical form used for storage
 * and comparison: the bare characters, upper-cased, no prefix, no separators.
 */
export function normalizePassKey(value: string | null | undefined): string {
  const upper = String(value ?? "")
    .trim()
    .toUpperCase();

  // The prefix is a readability aid on the printed slip, not part of the code.
  const withoutPrefix = upper.startsWith(`${PASS_KEY_PREFIX}-`)
    ? upper.slice(PASS_KEY_PREFIX.length + 1)
    : upper;

  let normalized = "";

  for (const character of withoutPrefix) {
    const folded = CONFUSABLES[character] ?? character;
    if (PASS_KEY_ALPHABET.includes(folded)) {
      normalized += folded;
    }
    // Anything else — dashes, spaces, punctuation — is decoration and dropped.
  }

  return normalized;
}

/**
 * Whether this could be a key at all — the cheap check before a database
 * lookup. Deliberately a *range*, not an exact length, so keys issued under
 * the previous twelve-character format are still accepted from guests holding
 * an older card.
 */
export function isValidPassKeyFormat(value: string | null | undefined): boolean {
  const length = normalizePassKey(value).length;
  return length >= MIN_ACCEPTED_PASS_KEY_LENGTH && length <= MAX_ACCEPTED_PASS_KEY_LENGTH;
}

/**
 * How a key is shown to staff and printed for the guest: `VDM-K7QP-3M2X-R4TN`.
 * Grouping is what makes a twelve-character code copyable by eye.
 */
export function formatPassKey(value: string | null | undefined): string {
  const normalized = normalizePassKey(value);

  if (!normalized) {
    return "";
  }

  const groups: string[] = [];
  for (let index = 0; index < normalized.length; index += GROUP_SIZE) {
    groups.push(normalized.slice(index, index + GROUP_SIZE));
  }

  return `${PASS_KEY_PREFIX}-${groups.join("-")}`;
}

/**
 * A fresh code.
 *
 * Characters are drawn by rejection sampling rather than `byte % 32`: the
 * alphabet is 32 long and a byte is 256, so the modulo happens to be uniform
 * here, but rejection stays correct if the alphabet is ever changed.
 */
export function generatePassKeyCode(): string {
  let code = "";

  while (code.length < PASS_KEY_LENGTH) {
    for (const byte of randomBytes(PASS_KEY_LENGTH)) {
      if (code.length === PASS_KEY_LENGTH) {
        break;
      }

      const index = byte % 256;
      if (index >= PASS_KEY_ALPHABET.length * Math.floor(256 / PASS_KEY_ALPHABET.length)) {
        continue;
      }

      code += PASS_KEY_ALPHABET[index % PASS_KEY_ALPHABET.length];
    }
  }

  return code;
}
