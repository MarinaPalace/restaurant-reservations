import { randomUUID } from "crypto";
import { connectToDatabase, isMongoConfigured } from "@/lib/db/connect";
import { RestaurantDateModel } from "@/lib/models/restaurant-date";
import { SeatHoldModel } from "@/lib/models/seat-hold";
import {
  consumeLocalSeatHold,
  getLocalSeatHold,
  holdLocalSeats,
  releaseLocalConsumedSeats,
  releaseLocalSeatHold,
  sweepLocalSeatHolds,
} from "@/lib/db/local-store";
import {
  SEAT_HOLD_STRAND_MS,
  SeatHoldError,
  seatHoldExpiry,
  type SeatHoldRecord,
} from "@/lib/seat-hold";

/**
 * Re-exported so callers reach for one module. The shape and the error live in
 * `lib/seat-hold.ts` because the JSON store needs them and must not import the
 * service that imports it.
 */
export { SeatHoldError, type SeatHoldRecord };

/**
 * Seats held while a guest finishes booking.
 *
 * ## The problem this exists for
 *
 * Seats used to be claimed by the last request of the booking — the one that
 * writes the reservation. Everything before it was a promise nobody was
 * keeping. Two guests looking at the same four remaining seats were both shown
 * four, both walked through the menu, and the second one lost, at the end,
 * after all the work. Worse, the screen said nothing: it bounced them back to
 * the calendar.
 *
 * So the seats are taken at the moment the guest has said enough to take them
 * — how many they are, and which evening — and given back if they do not
 * finish. The second guest now finds the evening full **on the calendar**,
 * which is a true answer arrived at before they have spent any time.
 *
 * ## How it is made safe
 *
 * The same way `reservedSeats` is (rule 2.7), because it is the same problem:
 *
 * - **The claim is a single conditional update.** `heldSeats` grows only if
 *   capacity less what is booked and what is already held still covers the
 *   party. Two requests racing for the last four seats both run it; Mongo
 *   applies them one after the other and the second one's filter no longer
 *   matches. No transaction, so a standalone `mongod` works.
 * - **The receipt is written second and unwound on failure.** If the hold
 *   document cannot be created the counter is put straight back, exactly as the
 *   booking route hands a pass-key back.
 * - **Release is idempotent by filter.** The document is deleted with
 *   `findOneAndDelete`, so of two requests releasing the same hold exactly one
 *   gets a document, and only that one decrements. Releasing twice cannot give
 *   the same seats back twice.
 * - **Conversion never lets go.** Turning a hold into a booking moves the seats
 *   from `heldSeats` to `reservedSeats` in a single update. There is no instant
 *   when they are in neither, so nobody can take the seats out from under a
 *   guest who is pressing Confirm.
 *
 * ## Expiry is swept, never TTL'd
 *
 * A TTL index would delete the receipt and leave the counter holding seats for
 * nobody. `sweepExpiredHolds` deletes and decrements together, and it runs
 * whenever anybody looks at an evening's availability — so a hold can only
 * linger while nobody is being kept out by it.
 */

function toRecord(value: unknown): SeatHoldRecord {
  const hold = value as {
    holdId?: unknown;
    date?: unknown;
    guests?: unknown;
    passKeyId?: unknown;
    expiresAt?: unknown;
  };

  return {
    holdId: String(hold.holdId ?? ""),
    date: String(hold.date ?? ""),
    guests: Math.max(0, Number(hold.guests ?? 0)),
    passKeyId: String(hold.passKeyId ?? ""),
    expiresAt: hold.expiresAt instanceof Date ? hold.expiresAt.toISOString() : String(hold.expiresAt ?? ""),
  };
}

/**
 * Gives expired holds their seats back, and sweeps up after a crash.
 *
 * Two jobs, and the second one is the reason `heldSeatsTouchedAt` exists.
 *
 * 1. **Expired holds.** Each is deleted with `findOneAndDelete` — one winner —
 *    and only the winner decrements, guarded so the counter cannot go negative.
 * 2. **Stranded seats.** A crash between deleting a receipt and decrementing
 *    the counter would hold seats no document accounts for. Since every hold
 *    stamps `heldSeatsTouchedAt` as it takes its seats, and no hold outlives
 *    the window, an evening with held seats, no live holds and no hold taken
 *    for longer than that is stranded rather than busy. Only then are the seats
 *    put back — and the update is conditional on the same emptiness, so a hold
 *    arriving in the meantime is not wiped out by it.
 */
/**
 * How long a sweep is allowed to stand in for the next one.
 *
 * Sweeping is two indexed queries and usually finds nothing, but the calendar
 * is read on every page of the booking flow and by every screen in the
 * dashboard, and paying for it each time was measurable. Since a hold lives for
 * fifteen minutes, a few seconds of staleness cannot change any answer that
 * matters: for it to refuse a guest, a hold would have to expire inside this
 * window *and* the evening be full to the seat.
 *
 * The paths where that would actually cost somebody their booking do not use
 * it. `holdSeats` sweeps for real, every time.
 */
const SWEEP_THROTTLE_MS = 3_000;

/** Per scope, so an evening being fought over is not starved by the whole-list read. */
const lastSweptAt = new Map<string, number>();

/**
 * A sweep, unless one has just run.
 *
 * For reads that only *display* availability. Anything that takes seats out of
 * the room, or refuses somebody because there are none, calls
 * `sweepExpiredHolds` directly and pays the price.
 */
export async function sweepExpiredHoldsThrottled(date?: string): Promise<void> {
  const scope = date ?? "*";
  const now = Date.now();
  const last = lastSweptAt.get(scope) ?? 0;

  if (now - last < SWEEP_THROTTLE_MS) {
    return;
  }

  /**
   * Stamped before the work rather than after, so a burst of concurrent reads
   * queues one sweep rather than all of them — the request that set the stamp
   * is the one that does it.
   */
  lastSweptAt.set(scope, now);

  // A sweep that throws must not lock the scope until the throttle lapses;
  // the next read should be free to try again.
  try {
    await sweepExpiredHolds(date);
  } catch (error) {
    lastSweptAt.set(scope, last);
    throw error;
  }
}

/** Forgets when anything was last swept. Tests only. */
export function resetSweepThrottle() {
  lastSweptAt.clear();
}

export async function sweepExpiredHolds(date?: string): Promise<void> {
  if (!isMongoConfigured()) {
    await sweepLocalSeatHolds(date);
    return;
  }

  await connectToDatabase();

  const now = new Date();
  const expired = await SeatHoldModel.find({
    expiresAt: { $lte: now },
    ...(date ? { date } : {}),
  })
    .limit(200)
    .lean();

  for (const hold of expired) {
    const record = toRecord(hold);

    // One winner takes the document; only the winner gives the seats back.
    const claimed = await SeatHoldModel.findOneAndDelete({ holdId: record.holdId }).lean();
    if (!claimed) {
      continue;
    }

    await RestaurantDateModel.updateOne(
      { date: record.date, heldSeats: { $gte: record.guests } },
      { $inc: { heldSeats: -record.guests } },
    );
  }

  await releaseStrandedSeats(date, now);
}

/** The safety net described above. Never runs while a hold is actually live. */
async function releaseStrandedSeats(date: string | undefined, now: Date): Promise<void> {
  const strandedBefore = new Date(now.getTime() - SEAT_HOLD_STRAND_MS);

  const suspects = await RestaurantDateModel.find({
    heldSeats: { $gt: 0 },
    ...(date ? { date } : {}),
    $or: [
      { heldSeatsTouchedAt: { $lte: strandedBefore } },
      // Seats held on a date that has never recorded a hold can only be a
      // leftover from a crash before the stamp was written.
      { heldSeatsTouchedAt: { $exists: false } },
    ],
  })
    .limit(50)
    .lean();

  for (const suspect of suspects) {
    const dateKey = String(suspect.date);
    const live = await SeatHoldModel.countDocuments({ date: dateKey, expiresAt: { $gt: now } });

    if (live > 0) {
      continue;
    }

    /**
     * Conditional on the evening still being as empty as it was read. A hold
     * taken between the count above and this update bumps `heldSeatsTouchedAt`
     * before it touches the counter, so the filter stops matching and the new
     * hold keeps its seats.
     */
    await RestaurantDateModel.updateOne(
      {
        date: dateKey,
        heldSeats: Number(suspect.heldSeats ?? 0),
        $or: [
          { heldSeatsTouchedAt: { $lte: strandedBefore } },
          { heldSeatsTouchedAt: { $exists: false } },
        ],
      },
      { $set: { heldSeats: 0 } },
    );
  }
}

/**
 * Holds seats for a party, or refuses because there are none.
 *
 * `previousHoldId` is released first, so changing the date or the party size
 * moves a hold rather than taking a second one. Released before the new one is
 * taken on purpose: a guest reducing a party of six to four on the last five
 * seats of an evening would otherwise be refused by their own hold.
 *
 * The window that opens between the two — seats let go, not yet retaken — is
 * the price of that, and it is the right way round: losing seats to somebody
 * else while changing your mind is honest, and being told an evening is full by
 * seats you are holding yourself is not.
 */
export async function holdSeats(input: {
  date: string;
  guests: number;
  passKeyId: string;
  previousHoldId?: string;
}): Promise<SeatHoldRecord> {
  if (input.previousHoldId) {
    await releaseSeatHold(input.previousHoldId);
  }

  if (!isMongoConfigured()) {
    return holdLocalSeats(input);
  }

  await connectToDatabase();

  // Expired holds on this evening go back first, or a guest would be refused
  // seats that three abandoned tabs are still nominally sitting in.
  await sweepExpiredHolds(input.date);

  const expiresAt = seatHoldExpiry();

  /**
   * The atomic gate. Capacity, less what is booked and what is already held,
   * has to cover this party — checked and taken in one update, so two requests
   * for the last four seats cannot both pass.
   *
   * `heldSeatsTouchedAt` is stamped in the same update, before the receipt is
   * written, which is what makes the stranded-seat net above safe.
   */
  const claimed = await RestaurantDateModel.findOneAndUpdate(
    {
      date: input.date,
      isOpen: true,
      $expr: {
        $gte: [
          { $subtract: ["$capacity", { $add: ["$reservedSeats", { $ifNull: ["$heldSeats", 0] }] }] },
          input.guests,
        ],
      },
    },
    { $inc: { heldSeats: input.guests }, $set: { heldSeatsTouchedAt: new Date() } },
    { returnDocument: "after" },
  ).lean();

  if (!claimed) {
    const existing = await RestaurantDateModel.findOne({ date: input.date }).lean();
    throw new SeatHoldError(!existing || !existing.isOpen ? "DATE_CLOSED" : "DATE_FULL");
  }

  const holdId = randomUUID();

  try {
    await SeatHoldModel.create({
      holdId,
      date: input.date,
      guests: input.guests,
      passKeyId: input.passKeyId,
      expiresAt,
    });
  } catch (error) {
    // No receipt, so nothing would ever give these seats back. Hand them over
    // immediately rather than waiting for the net to notice in sixteen minutes.
    await RestaurantDateModel.updateOne(
      { date: input.date, heldSeats: { $gte: input.guests } },
      { $inc: { heldSeats: -input.guests } },
    );
    throw error;
  }

  return {
    holdId,
    date: input.date,
    guests: input.guests,
    passKeyId: input.passKeyId,
    expiresAt: expiresAt.toISOString(),
  };
}

/**
 * Gives a hold's seats back. Returns what was released, or nothing.
 *
 * Idempotent by construction: the document is the thing being competed for, so
 * a second call finds nothing and decrements nothing.
 */
export async function releaseSeatHold(holdId: string): Promise<SeatHoldRecord | null> {
  if (!holdId) {
    return null;
  }

  if (!isMongoConfigured()) {
    return releaseLocalSeatHold(holdId);
  }

  await connectToDatabase();

  const released = await SeatHoldModel.findOneAndDelete({ holdId }).lean();
  if (!released) {
    return null;
  }

  const record = toRecord(released);

  await RestaurantDateModel.updateOne(
    { date: record.date, heldSeats: { $gte: record.guests } },
    { $inc: { heldSeats: -record.guests } },
  );

  return record;
}

/** The hold as it stands, live or not. The screen uses it to count down. */
export async function getSeatHold(holdId: string): Promise<SeatHoldRecord | null> {
  if (!holdId) {
    return null;
  }

  if (!isMongoConfigured()) {
    return getLocalSeatHold(holdId);
  }

  await connectToDatabase();
  const hold = await SeatHoldModel.findOne({ holdId }).lean();
  return hold ? toRecord(hold) : null;
}

/**
 * Turns a hold into booked seats.
 *
 * The one operation that must not have a gap in it. The receipt is deleted
 * first — one winner, so a double-submitted booking cannot spend the same hold
 * twice — and then the seats move from `heldSeats` to `reservedSeats` in a
 * single update. At no point are they in neither, so no concurrent booking can
 * take the seats of a guest who is halfway through confirming.
 *
 * Refuses a hold that is not this party's, not this evening's, or not big
 * enough: the caller has to be booking what it actually holds.
 */
export async function consumeSeatHold(input: {
  holdId: string;
  date: string;
  guests: number;
  passKeyId: string;
}): Promise<SeatHoldRecord | null> {
  if (!input.holdId) {
    return null;
  }

  if (!isMongoConfigured()) {
    return consumeLocalSeatHold(input);
  }

  await connectToDatabase();

  const consumed = await SeatHoldModel.findOneAndDelete({
    holdId: input.holdId,
    date: input.date,
    passKeyId: input.passKeyId,
    guests: { $gte: input.guests },
    expiresAt: { $gt: new Date() },
  }).lean();

  if (!consumed) {
    return null;
  }

  const record = toRecord(consumed);

  /**
   * The move. `heldSeats` gives up everything the hold took — which may be more
   * than is being booked, if the party shrank on the way — while
   * `reservedSeats` takes only what the booking is for, so the difference goes
   * back to the room instead of being quietly kept.
   */
  await RestaurantDateModel.updateOne(
    { date: record.date, heldSeats: { $gte: record.guests } },
    { $inc: { reservedSeats: input.guests, heldSeats: -record.guests } },
  );

  return record;
}

/**
 * Hands back seats a consumed hold paid for, when the booking then failed.
 *
 * The hold is gone by this point — it was spent — so the seats go back to the
 * room rather than to the hold, and the guest starts again. The same shape as
 * the pass-key being handed back on that path.
 */
export async function refundConsumedHold(date: string, guests: number): Promise<void> {
  if (!isMongoConfigured()) {
    await releaseLocalConsumedSeats(date, guests);
    return;
  }

  await connectToDatabase();
  await RestaurantDateModel.updateOne(
    { date, reservedSeats: { $gte: guests } },
    { $inc: { reservedSeats: -guests } },
  );
}
