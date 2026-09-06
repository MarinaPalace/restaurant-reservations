import { randomUUID } from "crypto";
import { connectToDatabase, isMongoConfigured } from "@/lib/db/connect";
import { RestaurantDateModel } from "@/lib/models/restaurant-date";
import { SeatHoldModel } from "@/lib/models/seat-hold";
import {
  advanceLocalSeatHoldStep,
  consumeLocalSeatHold,
  getLocalSeatHold,
  holdLocalSeats,
  listLocalLiveHoldsForKey,
  listLocalSeatHolds,
  releaseLocalConsumedSeats,
  releaseLocalSeatHold,
  sweepLocalSeatHolds,
} from "@/lib/db/local-store";
import {
  SEAT_HOLD_STEPS,
  SEAT_HOLD_STEP_LABELS,
  SEAT_HOLD_STRAND_MS,
  SeatHoldError,
  furthestSeatHoldStep,
  isSeatHoldStep,
  seatHoldExpiry,
  type SeatHoldRecord,
  type SeatHoldStep,
} from "@/lib/seat-hold";
import { recordAuditEntry } from "@/lib/services/audit-log";

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
 * four, both walked the whole flow, and the second one lost, at the end,
 * after all the work. Worse, the screen said nothing: it bounced them back to
 * the calendar.
 *
 * So the seats are taken at the moment the guest has said enough to take them
 * — how many they are, and which evening — and given back if they do not
 * finish. The second guest now finds the evening full **on the calendar**,
 * which is a true answer arrived at before they have spent any time.
 *
 * ## And the attempt is kept, whichever way it goes
 *
 * A hold is **closed, not deleted** (see the model). Guests come to the desk
 * certain they booked when they got as far as the menu and stopped, and until
 * this there was nothing to check. Now every attempt leaves a row saying who,
 * which evening, how many, when they started and how far they got.
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
 * - **Closing is idempotent by filter.** Every transition requires
 *   `status: "live"`, so of two requests spending or releasing the same hold
 *   exactly one matches, and only that one moves the counter. Releasing twice
 *   cannot give the same seats back twice.
 * - **Conversion never lets go.** Turning a hold into a booking moves the seats
 *   from `heldSeats` to `reservedSeats` in a single update. There is no instant
 *   when they are in neither, so nobody can take the seats out from under a
 *   guest who is pressing Confirm.
 *
 * ## Expiry is swept, never TTL'd
 *
 * A TTL index would throw away both the seats and the footprint: the counter
 * would hold seats for nobody, and the record of the abandoned attempt would be
 * gone. `sweepExpiredHolds` closes the hold, returns the seats and writes the
 * log entry together, and runs whenever seats are taken — so a hold can only
 * linger while nobody is being kept out by it.
 */

function toIso(value: unknown): string {
  if (value instanceof Date) {
    return value.toISOString();
  }
  return String(value ?? "");
}

function toRecord(value: unknown): SeatHoldRecord {
  const hold = value as Record<string, unknown>;
  const step = hold.step;

  return {
    holdId: String(hold.holdId ?? ""),
    date: String(hold.date ?? ""),
    guests: Math.max(0, Number(hold.guests ?? 0)),
    passKeyId: String(hold.passKeyId ?? ""),
    ...(hold.roomNumber ? { roomNumber: String(hold.roomNumber) } : {}),
    ...(isSeatHoldStep(step) ? { step } : {}),
    // Absent on nothing this app writes now, but a document from before the
    // field existed was live by definition — it was holding seats.
    status: (hold.status as SeatHoldRecord["status"]) ?? "live",
    ...(hold.reservationNumber ? { reservationNumber: String(hold.reservationNumber) } : {}),
    expiresAt: toIso(hold.expiresAt),
    ...(hold.closedAt ? { closedAt: toIso(hold.closedAt) } : {}),
    ...(hold.createdAt ? { createdAt: toIso(hold.createdAt) } : {}),
  };
}

/**
 * The line written into the log when a guest walks away mid-booking.
 *
 * Worded for whoever reads it at the desk with a guest standing in front of
 * them, so it says the two things that settle the conversation: that an attempt
 * was genuinely made, and that it did not become a booking.
 */
export function describeAbandonedHold(hold: SeatHoldRecord): string {
  const who = hold.roomNumber ? `Room ${hold.roomNumber}` : "A guest";
  const far = hold.step ? SEAT_HOLD_STEP_LABELS[hold.step] : "started a booking";

  return (
    `${who} started booking ${hold.guests} guest(s) for ${hold.date}, ${far}, ` +
    "and did not finish. The seats were held and then released."
  );
}

async function logAbandonedHold(hold: SeatHoldRecord): Promise<void> {
  await recordAuditEntry({
    action: "booking:abandoned",
    actor: {
      kind: "guest",
      id: hold.passKeyId,
      name: hold.roomNumber ? `Room ${hold.roomNumber}` : "Guest",
    },
    summary: describeAbandonedHold(hold),
  });
}

/* ------------------------------------------------------------------ *
 * Sweeping
 * ------------------------------------------------------------------ */

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

/**
 * Closes holds whose time has run out, and sweeps up after a crash.
 *
 * Three things happen to an expired hold and they belong together: its seats go
 * back to the room, it is marked `abandoned` so the attempt stays on the
 * record, and a line goes into the log for whoever is asked about it later.
 *
 * The second job is the reason `heldSeatsTouchedAt` exists. A crash between
 * closing a hold and decrementing the counter would hold seats no live document
 * accounts for. Since every hold stamps the evening as it takes its seats, and
 * no hold outlives the window, an evening with held seats, no live holds and
 * nothing taken for longer than that is stranded rather than busy. Only then
 * are the seats put back — and the update is conditional on the same emptiness,
 * so a hold arriving in the meantime is not wiped out by it.
 */
export async function sweepExpiredHolds(date?: string): Promise<void> {
  if (!isMongoConfigured()) {
    for (const hold of await sweepLocalSeatHolds(date)) {
      await logAbandonedHold(hold);
    }
    return;
  }

  await connectToDatabase();

  const now = new Date();
  const expired = await SeatHoldModel.find({
    status: "live",
    expiresAt: { $lte: now },
    ...(date ? { date } : {}),
  })
    .limit(200)
    .lean();

  for (const hold of expired) {
    const record = toRecord(hold);

    /**
     * One winner closes it. `status: "live"` in the filter is what keeps a
     * sweep racing the guest's own Confirm safe: whichever lands first takes
     * the hold, and the other matches nothing.
     */
    const closed = await SeatHoldModel.findOneAndUpdate(
      { holdId: record.holdId, status: "live" },
      { $set: { status: "abandoned", closedAt: now } },
    ).lean();

    if (!closed) {
      continue;
    }

    await RestaurantDateModel.updateOne(
      { date: record.date, heldSeats: { $gte: record.guests } },
      { $inc: { heldSeats: -record.guests } },
    );

    // After the seats, never before: a log write that failed must not be able
    // to keep an evening shut.
    await logAbandonedHold(record);
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
    const live = await SeatHoldModel.countDocuments({
      date: dateKey,
      status: "live",
      expiresAt: { $gt: now },
    });

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

/* ------------------------------------------------------------------ *
 * Taking, giving back, and spending
 * ------------------------------------------------------------------ */

/**
 * Closes every live hold a key still has, and reports the furthest step any of
 * them reached.
 *
 * Called before a new hold is taken, so a key can never hold two evenings at
 * once whatever the browser did or did not remember. The step comes back with
 * it because an attempt that reached the menu and then changed date has still
 * reached the menu, and the footprint should say so.
 *
 * Each is closed through `releaseSeatHold`, so the seats go back through the
 * same one-winner filter as everywhere else rather than by a second path that
 * could disagree with it.
 */
async function releaseOtherHolds(passKeyId: string): Promise<{ step?: SeatHoldStep }> {
  let step: SeatHoldStep | undefined;

  for (const hold of await listLiveHoldsForKey(passKeyId)) {
    const released = await releaseSeatHold(hold.holdId);

    if (released?.step) {
      step = furthestSeatHoldStep(step, released.step);
    }
  }

  return { step };
}

/** The holds a key is still holding seats with. Usually none, sometimes one. */
async function listLiveHoldsForKey(passKeyId: string): Promise<SeatHoldRecord[]> {
  if (!passKeyId) {
    return [];
  }

  if (!isMongoConfigured()) {
    return listLocalLiveHoldsForKey(passKeyId);
  }

  await connectToDatabase();

  const holds = await SeatHoldModel.find({
    passKeyId,
    status: "live",
    expiresAt: { $gt: new Date() },
  })
    .limit(20)
    .lean();

  return holds.map(toRecord);
}

/**
 * Holds seats for a party, or refuses because there are none.
 *
 * `previousHoldId` is closed first, so changing the date or the party size
 * moves a hold rather than taking a second one. Closed before the new one is
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
  roomNumber?: string;
  previousHoldId?: string;
}): Promise<SeatHoldRecord> {
  /**
   * Every hold this key already has goes back first — not just the one the
   * browser remembered.
   *
   * The model says a key holds seats on one evening at a time, and until this
   * that was enforced only by the client sending `previousHoldId`. Several
   * ordinary things break that promise: a reply lost on a flaky lobby wi-fi
   * (the hold committed, the browser forgot the id), a refusal that returns
   * before a hold is taken while the screen still clears its copy, or simply
   * two tabs, since `sessionStorage` is per-tab.
   *
   * Each of those left a live hold nobody could name, and the guest's *next*
   * attempt was then refused `DATE_FULL` by their own abandoned seats — for a
   * quarter of an hour, on the evening they were trying to book. That is the
   * exact refusal this feature exists to delete, arriving from inside it.
   *
   * So the key is the thing asked about, and the id passed in is only used to
   * decide which hold the step is inherited from.
   */
  const previous = input.previousHoldId ? await releaseSeatHold(input.previousHoldId) : null;
  const inherited = previous?.step ?? (await releaseOtherHolds(input.passKeyId)).step;

  if (!isMongoConfigured()) {
    return holdLocalSeats({ ...input, step: inherited });
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
    const created = await SeatHoldModel.create({
      holdId,
      date: input.date,
      guests: input.guests,
      passKeyId: input.passKeyId,
      roomNumber: input.roomNumber,
      step: inherited ?? "date",
      status: "live",
      expiresAt,
    });

    return toRecord(created.toObject());
  } catch (error) {
    // No receipt, so nothing would ever give these seats back. Hand them over
    // immediately rather than waiting for the net to notice in sixteen minutes.
    await RestaurantDateModel.updateOne(
      { date: input.date, heldSeats: { $gte: input.guests } },
      { $inc: { heldSeats: -input.guests } },
    );
    throw error;
  }
}

/**
 * Records how far a guest has got, so an unfinished attempt says so.
 *
 * Best-effort and never in the guest's way: it moves one field on a document
 * that already exists and cannot fail a booking. It only ever moves forward, so
 * tapping Back does not make the footprint shrink.
 */
export async function advanceSeatHoldStep(holdId: string, step: SeatHoldStep): Promise<void> {
  if (!holdId) {
    return;
  }

  if (!isMongoConfigured()) {
    await advanceLocalSeatHoldStep(holdId, step);
    return;
  }

  await connectToDatabase();

  /**
   * One conditional update, not a read followed by a write.
   *
   * The steps are reported with `keepalive` as the guest moves, so two can be
   * in flight at once — and read-then-write let them land summary-then-menu and
   * walk the recorded step *backwards*. Naming the steps this one is allowed to
   * overwrite makes the filter do the comparison, which no interleaving can get
   * wrong. A hold already further along matches nothing and is left alone.
   */
  await SeatHoldModel.updateOne(
    { holdId, status: "live", step: { $in: stepsBefore(step) } },
    { $set: { step } },
  );
}

/** The steps a hold may be at for `step` to still be an advance on it. */
function stepsBefore(step: SeatHoldStep): (SeatHoldStep | null)[] {
  const earlier = SEAT_HOLD_STEPS.slice(0, SEAT_HOLD_STEPS.indexOf(step));

  // `null` and the absent field cover holds written before steps were recorded.
  return [...earlier, null];
}

/**
 * Gives a hold's seats back. Returns what was released, or nothing.
 *
 * Idempotent by construction: `status: "live"` is the thing being competed for,
 * so a second call matches nothing and decrements nothing.
 */
export async function releaseSeatHold(holdId: string): Promise<SeatHoldRecord | null> {
  if (!holdId) {
    return null;
  }

  if (!isMongoConfigured()) {
    return releaseLocalSeatHold(holdId);
  }

  await connectToDatabase();

  const released = await SeatHoldModel.findOneAndUpdate(
    { holdId, status: "live" },
    { $set: { status: "released", closedAt: new Date() } },
  ).lean();

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

/** The hold as it stands, live or closed. The screen uses it to count down. */
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
 * What happened on one evening: who is holding seats now, and who walked away.
 *
 * The dashboard's answer to "a guest says they booked and there is no booking".
 * Newest first, and capped, because this is a panel rather than a report.
 */
export async function listSeatHolds(date: string, limit = 50): Promise<SeatHoldRecord[]> {
  if (!isMongoConfigured()) {
    return listLocalSeatHolds(date, limit);
  }

  await connectToDatabase();

  const holds = await SeatHoldModel.find({ date, status: { $in: ["live", "abandoned"] } })
    .sort({ createdAt: -1 })
    .limit(Math.min(limit, 200))
    .lean();

  return holds.map(toRecord);
}

/**
 * Turns a hold into booked seats.
 *
 * The one operation that must not have a gap in it. The hold is closed first —
 * one winner, so a double-submitted booking cannot spend the same hold twice —
 * and then the seats move from `heldSeats` to `reservedSeats` in a single
 * update. At no point are they in neither, so no concurrent booking can take
 * the seats of a guest who is halfway through confirming.
 *
 * Refuses a hold that is not this party's, not this evening's, or not big
 * enough: the caller has to be booking what it actually holds.
 */
export async function consumeSeatHold(input: {
  holdId: string;
  date: string;
  guests: number;
  passKeyId: string;
  reservationNumber?: string;
}): Promise<SeatHoldRecord | null> {
  if (!input.holdId) {
    return null;
  }

  if (!isMongoConfigured()) {
    return consumeLocalSeatHold(input);
  }

  await connectToDatabase();

  const consumed = await SeatHoldModel.findOneAndUpdate(
    {
      holdId: input.holdId,
      status: "live",
      date: input.date,
      passKeyId: input.passKeyId,
      guests: { $gte: input.guests },
      expiresAt: { $gt: new Date() },
    },
    {
      $set: {
        status: "booked",
        closedAt: new Date(),
        reservationNumber: input.reservationNumber,
        step: "summary",
      },
    },
  ).lean();

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
 * Hands back seats a spent hold paid for, when the booking then failed.
 *
 * The hold is closed by this point, so the seats go back to the room rather
 * than to the hold, and the guest starts again. The same shape as the pass-key
 * being handed back on that path.
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
