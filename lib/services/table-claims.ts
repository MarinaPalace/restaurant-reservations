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
}): Promise<TableClaimRecord> {
  if (input.guests > input.seats) {
    throw new TableClaimError("TABLE_TOO_SMALL");
  }

  if (!isMongoConfigured()) {
    return claimLocalTable(input);
  }

  await connectToDatabase();

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
        $expr: { $lte: [{ $add: [{ $ifNull: ["$guests", 0] }, input.guests] }, input.seats] },
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

  const updated = await TableClaimModel.findOneAndUpdate(
    { date: input.date, tableId: input.tableId, reservationNumbers: input.reservationNumber },
    { $inc: { guests: -input.guests }, $pull: { reservationNumbers: input.reservationNumber } },
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
  };

  return {
    date: String(claim.date ?? ""),
    tableId: String(claim.tableId ?? ""),
    guests: Math.max(0, Number(claim.guests ?? 0)),
    reservationNumbers: Array.isArray(claim.reservationNumbers)
      ? claim.reservationNumbers.map(String)
      : [],
  };
}
