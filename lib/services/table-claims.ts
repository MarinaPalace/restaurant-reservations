import { connectToDatabase, isMongoConfigured } from "@/lib/db/connect";
import { TableClaimModel } from "@/lib/models/table-claim";
import {
  claimLocalTable,
  listLocalTableClaims,
  releaseLocalTable,
} from "@/lib/db/local-store";

/**
 * A place at a table, claimed the way seats on an evening are claimed.
 *
 * `docs/floor-plan.md` §2 is the section this implements, and its first
 * instruction is the important one: **do not solve this with a read-then-write.**
 * "Check the table is free, then save the booking" is exactly the race the seat
 * claim was written to avoid, and it would be wrong perhaps once a month —
 * often enough to matter, rarely enough to be blamed on the guest.
 *
 * ## What is being exhausted
 *
 * Letting a guest pick table 7 adds a *second* thing that can run out, and
 * "seats remaining on the evening" cannot answer it: a room can have twenty
 * free seats and no free table that fits four. So a booking with the floor plan
 * on makes **two** claims — seats on the date, and a place at a table — and the
 * second failing hands the first back.
 *
 * ## Seat accounting is untouched
 *
 * Rule 2.7 governs `reservedSeats` and nothing here goes near it. This is a
 * separate constraint in a separate collection, and the date's seat count means
 * exactly what it meant before.
 *
 * ## Every property here is deliberate
 *
 * - **Claiming never reads before it writes.** Two atomic steps — join, or
 *   open — and the unique index decides the race. See `claimTable` for why it
 *   is not the single upsert the design note sketched.
 * - **Sharing is free.** A claim with two reservation numbers is a shared
 *   table, and growing a party only needs room for the extra guests.
 * - **Releasing is idempotent** (rule 2.7's habit): the filter requires the
 *   reservation to still be on the claim, so releasing twice is a no-op rather
 *   than a table that goes negative.
 */

export type TableClaimRecord = {
  date: string;
  tableId: string;
  guests: number;
  reservationNumbers: string[];
  /**
   * The bookings holding the table whole. A table with anybody here is offered
   * to nobody, whatever `guests` says. See the model for why exclusivity is
   * stated rather than implied by filling the seat count.
   */
  wholeFor: string[];
};

/** Raised when the table could not be had. The caller unwinds its seat claim. */
export class TableClaimError extends Error {
  constructor(readonly code: "TABLE_TAKEN" | "TABLE_TOO_SMALL") {
    super(code);
    this.name = "TableClaimError";
  }
}

/** Mongo's duplicate-key error, which is a *contention* signal here, not a bug. */
function isDuplicateKey(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && (error as { code?: number }).code === 11000);
}

/**
 * Puts a party at a table, or refuses.
 *
 * `seats` comes from the plan and is passed in rather than read here, so this
 * module needs to know nothing about floor plans — and so the caller cannot
 * claim against a table it did not actually look up.
 *
 * ## Why this is two operations and not one upsert
 *
 * `docs/floor-plan.md` §2 sketches this as a single conditional upsert. It
 * cannot be: **MongoDB rejects `$expr` in the query predicate of an upsert**
 * outright, which the concurrency test beside this file found before a line of
 * it reached the booking flow. So the claim is two atomic steps, and neither is
 * a read-then-write:
 *
 * 1. **Join**, a conditional update with no upsert. It matches only if a claim
 *    already exists *and* this party still fits beside whoever is on it.
 * 2. **Open**, a plain insert. The unique index on `(date, tableId)` is what
 *    makes this safe: two parties racing for an empty table both attempt it and
 *    exactly one succeeds.
 *
 * A duplicate-key error from step 2 is **contention, not a bug** — somebody
 * created the claim between our join missing and our insert. Going round again
 * is required rather than defensive: the table may still have room for us, and
 * failing here would refuse a booking that fits.
 *
 * ## The size check covers what `$expr` cannot
 *
 * The `$expr` only ever sees an existing document. An empty table has none, so
 * without the check above it, being first to ask would be enough to seat six
 * people at a four-top.
 */
export async function claimTable(input: {
  date: string;
  tableId: string;
  seats: number;
  guests: number;
  reservationNumber: string;
  /**
   * Take this table **whole**: one table of a row pushed together.
   *
   * Nobody can be sold a seat at a table shoved against somebody's dinner, so
   * the whole table leaves the room. Said by `wholeFor` rather than by claiming
   * every seat, so that the count stays the number of people actually at it.
   */
  whole?: boolean;
  /**
   * The booking already at this table whose claim may be joined.
   *
   * The party being sat with, named by the guest. Without it a table anybody is
   * at is simply taken; with it, a row can be pushed onto them.
   */
  joiningWith?: string;
}): Promise<TableClaimRecord> {
  /**
   * A party bigger than the table cannot sit at it — unless the table is one of
   * a row, where the party is spread across all of them and counted against the
   * first. What the row seats between them is settled before this, by
   * `findPlanCombination`, which is the only place that knows what the join
   * costs in chairs.
   */
  if (!input.whole && input.guests > input.seats) {
    throw new TableClaimError("TABLE_TOO_SMALL");
  }

  if (!isMongoConfigured()) {
    return claimLocalTable(input);
  }

  await connectToDatabase();

  if (input.whole) {
    /**
     * A table of a row pushed together. Taken entirely — nobody can be sold a
     * seat at a table shoved against somebody's dinner — which is said by
     * `wholeFor` rather than by inflating the count of who is sitting there.
     */
    if (input.joiningWith) {
      /**
       * Onto the party being sat with. Conditional like everything else here:
       * it matches only a claim that booking is actually on, so a made-up
       * number cannot take a stranger's table, and `$ne` keeps a retried
       * request from adding itself twice.
       */
      const shared = await TableClaimModel.findOneAndUpdate(
        {
          date: input.date,
          tableId: input.tableId,
          reservationNumbers: { $all: [input.joiningWith], $ne: input.reservationNumber },
        },
        {
          $inc: { guests: input.guests },
          $addToSet: {
            reservationNumbers: input.reservationNumber,
            wholeFor: input.reservationNumber,
          },
        },
        { returnDocument: "after" },
      ).lean();

      if (shared) {
        return toRecord(shared);
      }
    }

    const already = await TableClaimModel.findOne({
      date: input.date,
      tableId: input.tableId,
      reservationNumbers: input.reservationNumber,
    }).lean();

    if (already) {
      return toRecord(already);
    }

    /**
     * Nobody here yet. The unique index decides the race, exactly as it does
     * for an ordinary table — and a duplicate now means somebody else has the
     * table, which for a row is the end of it: half a table cannot be pushed
     * against a stranger.
     */
    try {
      const created = await TableClaimModel.create({
        date: input.date,
        tableId: input.tableId,
        guests: input.guests,
        reservationNumbers: [input.reservationNumber],
        wholeFor: [input.reservationNumber],
      });

      return toRecord(created.toObject());
    } catch (error) {
      if (isDuplicateKey(error)) {
        throw new TableClaimError("TABLE_TAKEN");
      }

      throw error;
    }
  }

  for (let attempt = 0; attempt < 2; attempt += 1) {
    /**
     * Step 1 — join a claim that is already there.
     *
     * `$ne` on our own number matters: without it, a retried request would
     * match its own claim, `$inc` the guests a second time and `$addToSet` the
     * number to no effect — a table quietly filling up with one booking.
     */
    const joined = await TableClaimModel.findOneAndUpdate(
      {
        date: input.date,
        tableId: input.tableId,
        reservationNumbers: { $ne: input.reservationNumber },
        $expr: {
          $and: [
            { $lte: [{ $add: [{ $ifNull: ["$guests", 0] }, input.guests] }, input.seats] },
            /**
             * And nobody is holding it whole. A table in a row pushed together
             * counts only the people actually at it, so its spare seats look
             * for sale and are not: they are where the next table now stands.
             */
            { $eq: [{ $size: { $ifNull: ["$wholeFor", []] } }, 0] },
          ],
        },
      },
      {
        $inc: { guests: input.guests },
        $addToSet: { reservationNumbers: input.reservationNumber },
      },
      { returnDocument: "after" },
    ).lean();

    if (joined) {
      return toRecord(joined);
    }

    /**
     * The join can miss for three reasons, and they are not the same answer.
     * This is the one where we are already seated — a retried request, or a
     * caller being careful — and the honest response is the claim we hold.
     */
    const mine = await TableClaimModel.findOne({
      date: input.date,
      tableId: input.tableId,
      reservationNumbers: input.reservationNumber,
    }).lean();

    if (mine) {
      return toRecord(mine);
    }

    /** Step 2 — nobody is here yet. The index decides who opens the table. */
    try {
      const created = await TableClaimModel.create({
        date: input.date,
        tableId: input.tableId,
        guests: input.guests,
        reservationNumbers: [input.reservationNumber],
      });

      return toRecord(created.toObject());
    } catch (error) {
      // Somebody opened it first. Go round once and try to join them instead.
      if (isDuplicateKey(error) && attempt === 0) {
        continue;
      }

      if (isDuplicateKey(error)) {
        throw new TableClaimError("TABLE_TAKEN");
      }

      throw error;
    }
  }

  // Joined nothing, hold nothing, and could not open it: the table is full.
  throw new TableClaimError("TABLE_TAKEN");
}

/**
 * Takes a booking off a table.
 *
 * Idempotent by filter, not by checking first: `reservationNumbers` must still
 * contain this booking for the update to match, so a cancel that runs twice —
 * or a release that races a cancel — cannot decrement the count twice and leave
 * a table that looks free while somebody is sitting at it.
 *
 * The document is deleted once nobody is on it, so an evening's claims stay a
 * list of tables actually in use rather than a row per table ever booked.
 */
export async function releaseTable(input: {
  date: string;
  tableId: string;
  guests: number;
  reservationNumber: string;
}): Promise<void> {
  if (!isMongoConfigured()) {
    await releaseLocalTable(input);
    return;
  }

  await connectToDatabase();

  /**
   * Gives back exactly what was taken, and lets go of the table.
   *
   * Plain again, and symmetric by construction: what a booking counted against
   * a table is `seatsToClaim`, and its caller passes that same number back
   * here. `wholeFor` is pulled alongside, so the last row to let go of a table
   * is what puts it back in the room.
   */
  const updated = await TableClaimModel.findOneAndUpdate(
    { date: input.date, tableId: input.tableId, reservationNumbers: input.reservationNumber },
    {
      $inc: { guests: -input.guests },
      $pull: {
        reservationNumbers: input.reservationNumber,
        wholeFor: input.reservationNumber,
      },
    },
    { returnDocument: "after" },
  ).lean();

  if (updated && (updated as { reservationNumbers?: string[] }).reservationNumbers?.length === 0) {
    await TableClaimModel.deleteOne({ date: input.date, tableId: input.tableId });
  }
}

/** Every table in use on an evening. One cheap read for the picker. */
export async function listTableClaims(date: string): Promise<TableClaimRecord[]> {
  if (!isMongoConfigured()) {
    return listLocalTableClaims(date);
  }

  await connectToDatabase();
  const claims = await TableClaimModel.find({ date }).lean();
  return claims.map(toRecord);
}

function toRecord(value: unknown): TableClaimRecord {
  const claim = value as {
    date?: unknown;
    tableId?: unknown;
    guests?: unknown;
    reservationNumbers?: unknown;
    wholeFor?: unknown;
  };

  return {
    date: String(claim.date ?? ""),
    tableId: String(claim.tableId ?? ""),
    guests: Math.max(0, Number(claim.guests ?? 0)),
    reservationNumbers: Array.isArray(claim.reservationNumbers)
      ? claim.reservationNumbers.map(String)
      : [],
    // Absent on every claim written before tables could be joined onto a party
    // already seated, which reads as "nobody holds this whole" — what those
    // claims meant.
    wholeFor: Array.isArray(claim.wholeFor) ? claim.wholeFor.map(String) : [],
  };
}

/* ------------------------------------------------------------------ *
 * Tables pushed together
 * ------------------------------------------------------------------ */

/** The shape both stores hold a claimed plan table in. */
export type HeldTable = { id: string; label: string; seats: number };

/**
 * How many people one table of a booking's holding is counted for.
 *
 * **One table: the party.** Which is what it has always been, and what lets two
 * rooms share a four-top — the second books the same table and joins the claim.
 *
 * **A row: the party, once.** Counted against the first table of the row and
 * nothing against the rest, so that adding up a row gives the number of people
 * at it and not some multiple of them.
 *
 * It used to claim every seat of every table — 4 and 4 for a party of five on
 * two four-tops — because that was how the row was made unsellable to anybody
 * else. It said something false to do it. A party of five on three two-tops
 * recorded as six, and the next question anybody asked of that number got the
 * wrong answer: a guest wanting to join them was told the table was full when a
 * chair was empty. Exclusivity is `wholeFor`'s job now, and this is free to be
 * the truth.
 */
export function seatsToClaim(
  held: readonly HeldTable[],
  table: HeldTable,
  guests: number,
): number {
  if (held.length <= 1) {
    return guests;
  }

  return table.id === held[0].id ? guests : 0;
}

/**
 * What a booking's tables are called between them: `7`, or `11 + 12 + 13`.
 *
 * This becomes `tableNumber`, which is the string the service sheet, the board
 * and `groupRoomRowsByTable` have always keyed on — the continuity point the
 * whole floor-plan feature rests on (`docs/floor-plan.md` §3).
 *
 * ## The lowest number first, and every number kept
 *
 * **Lowest first**, so a booking is filed under the table staff would call it
 * by. The tables arrive in the order they physically stand, which for a row
 * running right to left reads `13 + 12 + 11` — accurate about the room and
 * wrong on a sheet, where a party is looked up by the first number written.
 *
 * **Every number kept**, joined by `+`. Writing only the lowest would file it
 * correctly and hide that two more tables are gone: staff reading `11` would
 * lay one table and sell the other two. The `+` is also what the board splits
 * on to light up every table of a merged party, so the whole string has to
 * survive.
 *
 * Sorted the way people read table numbers, not the way strings sort — `2`
 * before `11`, and a label like `A3` still lands somewhere sensible.
 */
export function tableNumberFrom(held: readonly HeldTable[] | undefined): string | undefined {
  if (!held?.length) {
    return undefined;
  }

  return held
    .map((table) => table.label)
    .sort((one, other) => one.localeCompare(other, undefined, { numeric: true }))
    .join(" + ");
}
