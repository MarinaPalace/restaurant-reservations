import { parseGuestLookup, type GuestLookupCandidates } from "@/lib/guest-lookup";
import { fromDateKey, toDateKey, todayKey } from "@/lib/date";
import {
  findPassKeysByReservationRef,
  getPassKeyByCode,
  getPassKeyById,
} from "@/lib/services/pass-keys";
import {
  getReservationByNumber,
  getReservationsByPassKey,
} from "@/lib/services/reservations";
import { listSeatHolds } from "@/lib/services/seat-holds";
import type { PassKeyRecord, ReservationRecord } from "@/types/booking";
import { isSeatHoldHolding, type SeatHoldRecord } from "@/lib/seat-hold";

/**
 * Finding a guest from whatever they can show the desk.
 *
 * ## Why this is a search and not a lookup
 *
 * The desk is handed one string and does not know what it is. It could be a
 * scanned pass-key card, a scanned confirmation card, a code read aloud, or the
 * hotel's own booking reference off the paperwork. `parseGuestLookup` says what
 * the string *could* be — sometimes more than one thing — and this tries each,
 * because a search that finds the guest beats a classifier that is elegantly
 * certain and wrong. Every attempt is one indexed query behind a staff login.
 *
 * ## It answers with the key, not just the booking
 *
 * A reservation number identifies one dinner. What reception is nearly always
 * asked is about the *guest* — "what have we got for room 402" — so a number
 * that resolves to a booking is followed back to the key that paid for it, and
 * everything else on that key comes too. Finding one dinner and hiding the
 * other is how a guest ends up at the wrong sitting.
 *
 * ## And with what they started and did not finish
 *
 * The unfinished attempts come back alongside, because the hardest version of
 * this conversation is the one where there is no booking at all and the guest
 * is certain there is.
 */

/**
 * What the desk is told about a guest's key — deliberately not the key itself.
 *
 * The code is **omitted**, and that is the whole point of this type existing.
 * A reservation number is not a secret: guests read it aloud to other rooms so
 * they can be seated together, and rule 2.5 turns on that fact. This page
 * resolves a number back to its key, so returning the code would have handed
 * anybody who overheard a number — through any signed-in account, including the
 * tablet left at the pass with only `service:record` — the one credential that
 * cancels that guest's dinner.
 *
 * Reception does not need it. They need to know whose key it is, whether it
 * still works, and what is booked on it. Reading a code is `/admin/pass-keys`,
 * which requires `passkeys:issue`.
 */
export type GuestLookupKey = Pick<
  PassKeyRecord,
  | "id"
  | "kind"
  | "roomNumber"
  | "guestName"
  | "reservationRef"
  | "status"
  | "expiresOn"
  | "usedCount"
  | "maxUses"
>;

/** Strips a key down to what the desk may see. */
function toLookupKey(key: PassKeyRecord): GuestLookupKey {
  return {
    id: key.id,
    kind: key.kind,
    roomNumber: key.roomNumber,
    guestName: key.guestName,
    reservationRef: key.reservationRef,
    status: key.status,
    expiresOn: key.expiresOn,
    usedCount: key.usedCount,
    maxUses: key.maxUses,
  };
}

export type GuestLookupMatch = {
  passKey: GuestLookupKey;
  reservations: ReservationRecord[];
  /**
   * Bookings this key started and did not turn into a reservation, newest
   * first — both the ones still going and the ones that came to nothing.
   *
   * The live ones matter as much as the abandoned ones, and are the answer to
   * the more urgent version of the question: a guest at the desk with no
   * booking may be one who gave up last night, or one whose partner is
   * upstairs on the menu step right now. Those need opposite replies, and
   * without the live ones the desk cannot tell them apart.
   *
   * Only ever a few: they are read per evening from the reservations this key
   * has plus the evenings still ahead of it, rather than by scanning history.
   */
  unfinished: SeatHoldRecord[];
};

export type GuestLookupResult = {
  /** What the input was taken for, so the screen can say how it searched. */
  candidates: GuestLookupCandidates;
  matches: GuestLookupMatch[];
  /**
   * A booking found by number whose key has since been deleted.
   *
   * Rare and worth showing rather than swallowing: the dinner is real and on
   * the sheet, and reception still has to seat them.
   */
  orphanReservations: ReservationRecord[];
};

/** Evenings worth asking about, so the unfinished list is a query and not a scan. */
function eveningsOf(reservations: ReservationRecord[]): string[] {
  return [...new Set(reservations.map((entry) => entry.date))];
}

async function unfinishedFor(passKey: PassKeyRecord, reservations: ReservationRecord[]) {
  const evenings = eveningsOf(reservations);

  /**
   * An attempt that never became a booking leaves no reservation to find its
   * evening from, so the evenings the guest actually booked are not enough on
   * their own. The upcoming ones are added: an abandoned attempt is nearly
   * always for a night still ahead, which is exactly when somebody asks.
   */
  const today = todayKey();

  if (passKey.expiresOn && passKey.expiresOn >= today) {
    /**
     * Walked with `fromDateKey`/`toDateKey` rather than `toISOString().slice(0,10)`
     * (rule 2.1). The banned form converts to UTC first, so west of Greenwich
     * it names yesterday — and this is the lookup whose whole job is to find
     * *tonight's* abandoned attempt.
     */
    for (const day = fromDateKey(today); ; day.setDate(day.getDate() + 1)) {
      const key = toDateKey(day);

      if (key > passKey.expiresOn) {
        break;
      }

      if (!evenings.includes(key)) {
        evenings.push(key);
      }
    }
  }

  const found: SeatHoldRecord[] = [];

  // Capped: a long stay is a lot of evenings, and this is a desk panel.
  for (const evening of evenings.slice(0, 21)) {
    for (const hold of await listSeatHolds(evening, 20)) {
      if (hold.passKeyId !== passKey.id) {
        continue;
      }

      /**
       * `listSeatHolds` returns live and abandoned, and both belong here. A
       * hold whose clock has run out but which nothing has swept yet reads as
       * live in the store and is not — `isSeatHoldHolding` asks the question
       * properly, so the desk is never told somebody is mid-booking when their
       * seats went back ten minutes ago.
       */
      if (hold.status === "abandoned" || isSeatHoldHolding(hold)) {
        found.push(hold);
      }
    }
  }

  return found.sort((one, other) => (other.createdAt ?? "").localeCompare(one.createdAt ?? ""));
}

async function matchFor(passKey: PassKeyRecord): Promise<GuestLookupMatch> {
  const reservations = await getReservationsByPassKey(passKey.id);

  return {
    // Stripped here rather than in the screen: hiding a credential in the UI
    // is not access control (rule 2.5), and the route serves JSON to anything
    // that asks.
    passKey: toLookupKey(passKey),
    reservations,
    unfinished: await unfinishedFor(passKey, reservations),
  };
}

/**
 * Everything the desk can find from one scanned or typed string.
 *
 * Deliberately never throws for "not found": an empty `matches` is a real
 * answer that the screen shows as *nothing found for this*, which is different
 * from an error and is what the person at the desk actually needs to read.
 */
export async function findGuestBy(raw: string): Promise<GuestLookupResult> {
  const candidates = parseGuestLookup(raw);
  const byId = new Map<string, PassKeyRecord>();
  const orphanReservations: ReservationRecord[] = [];

  if (candidates.passKey) {
    const key = await getPassKeyByCode(candidates.passKey);
    if (key) {
      byId.set(key.id, key);
    }
  }

  if (candidates.reservationNumber) {
    const reservation = await getReservationByNumber(candidates.reservationNumber);

    if (reservation) {
      // Followed back to the key, so the answer is the guest rather than the
      // one dinner that happened to be scanned.
      const key = reservation.passKeyId ? await getPassKeyById(reservation.passKeyId) : null;

      if (key) {
        byId.set(key.id, key);
      } else {
        orphanReservations.push(reservation);
      }
    }
  }

  if (candidates.hotelRef) {
    for (const key of await findPassKeysByReservationRef(candidates.hotelRef)) {
      byId.set(key.id, key);
    }
  }

  const matches = await Promise.all([...byId.values()].map(matchFor));

  return { candidates, matches, orphanReservations };
}
