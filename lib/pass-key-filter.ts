import { normalizePassKey } from "@/lib/pass-key";
import type { PassKeyRecord } from "@/types/booking";

/**
 * Narrowing the issued-keys list down to the ones somebody is looking for.
 *
 * Pure and on its own, rather than inline in the manager's `useMemo`, because
 * the list has grown past a hundred keys and what it hides is now worth
 * testing. A filter that quietly drops a key is a guest at the desk holding a
 * card reception cannot find.
 */

/** What the key *is*: still good, spent, or withdrawn. */
export type PassKeyStatusFilter = "all" | "active" | "used" | "revoked";

/**
 * Which flow the key belongs to.
 *
 * Separate from the status rather than another button in the same row: "the
 * active invitations" is the question reception actually asks, and one row of
 * mutually exclusive buttons cannot answer it. Two independent choices can.
 */
export type PassKeyKindFilter = "all" | "standard" | "premium";

export const PASS_KEY_STATUS_FILTERS = ["all", "active", "used", "revoked"] as const;
export const PASS_KEY_KIND_FILTERS = ["all", "standard", "premium"] as const;

/** In the words the desk uses, not the words the database uses. */
export const PASS_KEY_KIND_LABELS: Record<PassKeyKindFilter, string> = {
  all: "All types",
  standard: "In-house",
  premium: "Invitations",
};

/**
 * Whether a key is an invitation.
 *
 * **Absent reads as in-house**, which is what every key issued before
 * invitations existed looks like — so `kind !== "premium"` rather than
 * `kind === "standard"`, or a hundred older keys would answer neither filter
 * and vanish from both lists.
 */
export function isInvitationKey(key: Pick<PassKeyRecord, "kind">): boolean {
  return key.kind === "premium";
}

/**
 * Does this key match what reception typed?
 *
 * They search by whatever is in front of them: the reference on the hotel
 * booking, the room, a name, the address an invitation went to, or the code on
 * the card the guest is holding. The code is matched in canonical form, so it
 * is found whether it was typed with dashes or without.
 */
function matchesQuery(key: PassKeyRecord, query: string): boolean {
  const needle = query.trim().toLowerCase();

  if (!needle) {
    return true;
  }

  const haystack = [key.reservationRef, key.roomNumber, key.guestName, key.guestEmail]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (haystack.includes(needle)) {
    return true;
  }

  const codeNeedle = normalizePassKey(query);
  return codeNeedle.length > 0 && key.code.includes(codeNeedle);
}

export function filterPassKeys(
  keys: readonly PassKeyRecord[],
  filters: { status: PassKeyStatusFilter; kind: PassKeyKindFilter; query: string },
): PassKeyRecord[] {
  return keys.filter((key) => {
    if (filters.status !== "all" && key.status !== filters.status) {
      return false;
    }

    if (filters.kind !== "all" && isInvitationKey(key) !== (filters.kind === "premium")) {
      return false;
    }

    return matchesQuery(key, filters.query);
  });
}

/**
 * How many of each kind there are, for the labels on the buttons.
 *
 * Counted against the *status* selection and the search rather than the whole
 * list, so "Invitations 0" means "none among these", which is the honest
 * answer to a button somebody is deciding whether to press.
 */
export function countByKind(keys: readonly PassKeyRecord[]): Record<PassKeyKindFilter, number> {
  const premium = keys.filter(isInvitationKey).length;

  return { all: keys.length, premium, standard: keys.length - premium };
}
