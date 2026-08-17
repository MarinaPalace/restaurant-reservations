import { connectToDatabase, isMongoConfigured } from "@/lib/db/connect";
import { PassKeyModel } from "@/lib/models/pass-key";
import {
  consumeLocalPassKey,
  createLocalPassKey,
  deleteLocalPassKey,
  getLocalPassKey,
  getLocalPassKeyByCode,
  listLocalPassKeys,
  reclaimLocalPassKey,
  releaseLocalPassKey,
  revokeLocalPassKey,
  updateLocalPassKey,
} from "@/lib/db/local-admin-store";
import { generatePassKeyCode, normalizePassKey } from "@/lib/pass-key";
import { todayKey } from "@/lib/date";
import { normalizeRoomNumber } from "@/lib/room";
import {
  MAX_USES_CAP,
  MINIMUM_STAY_NIGHTS,
  nightsBetween,
  suggestedUsesForNights,
  type Actor,
  type MenuKind,
  type PassKeyRecord,
} from "@/types/booking";

/**
 * Pass-keys: the proof of being a guest here, and the guest's credential for
 * their own booking.
 *
 * Two invariants matter and both are enforced by a *conditional write*, never
 * by read-then-write:
 *
 * - A key can be spent once. `consumePassKey` only matches a key that is still
 *   active, so two requests racing with the same code cannot both book.
 * - A key is only released from the booking it actually paid for, so a stale
 *   request cannot free a key that has since been spent on something else.
 *
 * This mirrors how seats are claimed in `reservations.ts`: claim first, hand
 * back if the thing you claimed it for fails to write.
 */

export const PASS_KEY_MESSAGES = {
  invalid: "That pass-key is not valid. Please check the slip you were given at reception.",
  used: "That pass-key has no dinners left on it. Please speak to reception.",
  revoked: "That pass-key is no longer valid. Please speak to reception.",
  expired: "That pass-key has expired. Please speak to reception.",
  afterStay: "That evening falls after your stay ends. Please choose an earlier date.",
} as const;

export class PassKeyError extends Error {
  constructor(
    public readonly code: "INVALID" | "USED" | "REVOKED" | "EXPIRED" | "AFTER_STAY",
    message: string,
  ) {
    super(message);
    this.name = "PassKeyError";
  }
}

type MongoPassKeyDocument = Record<string, unknown>;

/**
 * Reads a stored key, filling in what multi-use added.
 *
 * A key written before multi-use has neither counter and a `status` of
 * "active" or "used". It reads as a one-use key, spent or not according to
 * that status — which is exactly what it was, so nothing needed migrating.
 * The same goes for the old single `reservationNumber`.
 */
export function normalizePassKeyCounts(input: {
  maxUses?: unknown;
  usedCount?: unknown;
  status?: unknown;
  reservationNumbers?: unknown;
  reservationNumber?: unknown;
}): Pick<PassKeyRecord, "maxUses" | "usedCount" | "status" | "reservationNumbers"> {
  const maxUses = typeof input.maxUses === "number" && input.maxUses > 0 ? input.maxUses : 1;
  const legacyStatus = input.status === "revoked" || input.status === "used" ? input.status : "active";

  const usedCount =
    typeof input.usedCount === "number"
      ? Math.max(input.usedCount, 0)
      : // No counter: a legacy key, spent iff it said so.
        legacyStatus === "used"
        ? 1
        : 0;

  const reservationNumbers = Array.isArray(input.reservationNumbers)
    ? input.reservationNumbers.map(String)
    : input.reservationNumber
      ? [String(input.reservationNumber)]
      : [];

  return {
    maxUses,
    usedCount,
    // Revoked is the only stored state; "used" is a fact about the counters.
    status: legacyStatus === "revoked" ? "revoked" : usedCount >= maxUses ? "used" : "active",
    reservationNumbers,
  };
}

function toPassKeyRecord(document: MongoPassKeyDocument): PassKeyRecord {
  return {
    _id: String(document._id),
    id: String(document._id),
    code: String(document.code),
    kind: document.kind === "premium" ? "premium" : "standard",
    reservationRef: document.reservationRef ? String(document.reservationRef) : undefined,
    roomNumber: document.roomNumber ? String(document.roomNumber) : undefined,
    guestName: document.guestName ? String(document.guestName) : undefined,
    checkInOn: document.checkInOn ? String(document.checkInOn) : undefined,
    maxGuests: typeof document.maxGuests === "number" ? document.maxGuests : undefined,
    nights: typeof document.nights === "number" ? document.nights : undefined,
    expiresOn: document.expiresOn ? String(document.expiresOn) : undefined,
    ...normalizePassKeyCounts(document),
    issuedById: document.issuedById ? String(document.issuedById) : undefined,
    issuedByName: document.issuedByName ? String(document.issuedByName) : undefined,
    issuedAt: document.createdAt ? new Date(document.createdAt as string).toISOString() : undefined,
    usedAt: document.usedAt ? new Date(document.usedAt as string).toISOString() : undefined,
    revokedAt: document.revokedAt ? new Date(document.revokedAt as string).toISOString() : undefined,
    note: document.note ? String(document.note) : undefined,
  };
}

/**
 * Why this key cannot be used right now, worded for the guest, or `null` if it
 * can.
 *
 * Expiry is computed rather than stored: a key that has passed its date is
 * simply not usable, with no scheduled job needed to go and mark it.
 */
export function describePassKeyProblem(
  key: PassKeyRecord | null,
  now = new Date(),
): { code: PassKeyError["code"]; message: string } | null {
  if (!key) {
    return { code: "INVALID", message: PASS_KEY_MESSAGES.invalid };
  }

  if (key.status === "revoked") {
    return { code: "REVOKED", message: PASS_KEY_MESSAGES.revoked };
  }

  if (key.usedCount >= key.maxUses) {
    return { code: "USED", message: PASS_KEY_MESSAGES.used };
  }

  if (key.expiresOn && key.expiresOn < todayKey(now)) {
    return { code: "EXPIRED", message: PASS_KEY_MESSAGES.expired };
  }

  return null;
}

/** Whether a key may still be spent. */
export function isPassKeyUsable(key: PassKeyRecord | null, now = new Date()) {
  return describePassKeyProblem(key, now) === null;
}

/**
 * A party may shrink but never grow.
 *
 * Reception records the party size from the hotel booking when the key is
 * issued. Coming with fewer is ordinary — people drop out of dinner — but the
 * seats were never held for more, so a larger table is refused. A key with no
 * limit recorded (every key issued before this existed) is only bound by the
 * restaurant's own maximum.
 */
export function describeGuestCountProblem(
  key: Pick<PassKeyRecord, "maxGuests">,
  guestCount: number,
): string | null {
  if (!key.maxGuests || guestCount <= key.maxGuests) {
    return null;
  }

  return (
    `Your booking with us is for ${key.maxGuests} ` +
    `${key.maxGuests === 1 ? "guest" : "guests"}, so dinner can be booked for up to ${key.maxGuests}. ` +
    "Please speak to reception if your party has grown."
  );
}

/**
 * A dinner has to fall within the stay the key was issued for. Without this a
 * guest could book an evening weeks after they check out, holding a seat
 * nobody will sit in.
 */
export function isDateWithinStay(key: Pick<PassKeyRecord, "expiresOn">, date: string) {
  return !key.expiresOn || date <= key.expiresOn;
}

export async function getPassKeyByCode(rawCode: string): Promise<PassKeyRecord | null> {
  const code = normalizePassKey(rawCode);
  if (!code) {
    return null;
  }

  if (!isMongoConfigured()) {
    return getLocalPassKeyByCode(code);
  }

  await connectToDatabase();
  const key = await PassKeyModel.findOne({ code }).lean();
  return key ? toPassKeyRecord(key as MongoPassKeyDocument) : null;
}

export async function getPassKeyById(id: string): Promise<PassKeyRecord | null> {
  if (!id) {
    return null;
  }

  if (!isMongoConfigured()) {
    return getLocalPassKey(id);
  }

  if (!/^[a-f\d]{24}$/i.test(id)) {
    return null;
  }

  await connectToDatabase();
  const key = await PassKeyModel.findById(id).lean();
  return key ? toPassKeyRecord(key as MongoPassKeyDocument) : null;
}

export async function listPassKeys(): Promise<PassKeyRecord[]> {
  if (!isMongoConfigured()) {
    return listLocalPassKeys();
  }

  await connectToDatabase();
  const keys = await PassKeyModel.find().sort({ createdAt: -1 }).limit(500).lean();
  return keys.map((key) => toPassKeyRecord(key as MongoPassKeyDocument));
}

export class ShortStayError extends Error {
  constructor() {
    super(`Dinner is for guests staying ${MINIMUM_STAY_NIGHTS} nights or more.`);
    this.name = "ShortStayError";
  }
}

/**
 * Issues a key at check-in.
 *
 * The stay length is the entitlement, so a shorter stay is refused here rather
 * than being caught later in the booking flow — reception finds out while the
 * guest is still standing in front of them. `allowShortStay` exists because a
 * hotel always has exceptions; it is recorded on the key and in the log.
 */
export async function issuePassKey(input: {
  /** `premium` issues an invitation key rather than an in-house one. */
  kind?: MenuKind;
  reservationRef?: string;
  roomNumber?: string;
  guestName?: string;
  checkInOn?: string;
  expiresOn?: string;
  maxGuests?: number;
  /** Dinners this key may book. Defaults to what the stay length earns. */
  maxUses?: number;
  note?: string;
  allowShortStay?: boolean;
  actor: Actor;
}): Promise<PassKeyRecord> {
  // Worked out from the dates rather than typed, so they cannot disagree.
  const nights = nightsBetween(input.checkInOn, input.expiresOn);

  /**
   * The five-night rule is about earning dinner as part of a stay, so it does
   * not apply to an invitation — those guests are not staying here at all.
   */
  if (
    input.kind !== "premium" &&
    !input.allowShortStay &&
    typeof nights === "number" &&
    nights < MINIMUM_STAY_NIGHTS
  ) {
    throw new ShortStayError();
  }

  const maxUses = Math.min(
    Math.max(input.maxUses ?? suggestedUsesForNights(nights), 1),
    MAX_USES_CAP,
  );

  const base = {
    kind: input.kind ?? ("standard" as const),
    reservationRef: input.reservationRef?.trim() || undefined,
    roomNumber: input.roomNumber ? normalizeRoomNumber(input.roomNumber) : undefined,
    guestName: input.guestName?.trim() || undefined,
    checkInOn: input.checkInOn,
    nights,
    expiresOn: input.expiresOn,
    maxGuests: input.maxGuests,
    maxUses,
    usedCount: 0,
    status: "active" as const,
    reservationNumbers: [] as string[],
    issuedById: input.actor.id,
    issuedByName: input.actor.name,
    note: input.note?.trim() || undefined,
  };

  // Retry on the (vanishingly rare) chance of a code that is already in use.
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = generatePassKeyCode();

    if (!isMongoConfigured()) {
      const result = await createLocalPassKey({ ...base, code, issuedAt: new Date().toISOString() });
      if (result.ok) {
        return result.key;
      }
      continue;
    }

    await connectToDatabase();

    try {
      const created = await PassKeyModel.create({ ...base, code });
      return toPassKeyRecord(created.toObject() as MongoPassKeyDocument);
    } catch (error) {
      if ((error as { code?: number }).code === 11000) {
        continue;
      }
      throw error;
    }
  }

  throw new Error("Could not generate a unique pass-key.");
}

/**
 * Spends a key on a booking. Returns `null` when the key was not active, which
 * is how a race between two bookings with the same code is resolved: exactly
 * one of them gets a record back.
 */
export async function consumePassKey(
  code: string,
  reservationNumber: string,
): Promise<PassKeyRecord | null> {
  const normalized = normalizePassKey(code);
  if (!normalized) {
    return null;
  }

  if (!isMongoConfigured()) {
    return consumeLocalPassKey(normalized, reservationNumber);
  }

  await connectToDatabase();

  /**
   * One conditional update, and the condition is "there is a use left".
   *
   * `$expr` compares the two counters inside the write itself, so two requests
   * racing with the same code cannot both succeed on the last remaining use —
   * exactly as the seat accounting compares capacity to reserved.
   *
   * The `$ifNull` wrappers are what let a key written before multi-use take
   * part: it reads as 0 of 1.
   */
  const consumed = await PassKeyModel.findOneAndUpdate(
    {
      code: normalized,
      status: { $ne: "revoked" },
      $expr: {
        $lt: [{ $ifNull: ["$usedCount", 0] }, { $ifNull: ["$maxUses", 1] }],
      },
    },
    {
      $inc: { usedCount: 1 },
      $addToSet: { reservationNumbers: reservationNumber },
      $set: { usedAt: new Date() },
    },
    { returnDocument: "after" },
  ).lean();

  if (!consumed) {
    return null;
  }

  // Keep the legacy status field agreeing with the counters, so anything
  // reading the raw document still sees the truth.
  const record = toPassKeyRecord(consumed as MongoPassKeyDocument);
  await PassKeyModel.updateOne({ _id: record.id }, { $set: { status: record.status } });

  return record;
}

/**
 * Hands a key back so the guest can book again — after they cancel, or when
 * the reservation the key was spent on failed to write.
 *
 * The reservation number is part of the filter on purpose: a late request must
 * not release a key that has since been spent on a different booking.
 */
export async function releasePassKey(id: string, reservationNumber: string): Promise<PassKeyRecord | null> {
  if (!id) {
    return null;
  }

  if (!isMongoConfigured()) {
    return releaseLocalPassKey(id, reservationNumber);
  }

  if (!/^[a-f\d]{24}$/i.test(id)) {
    return null;
  }

  await connectToDatabase();

  /**
   * Give one use back — and only the use this booking took. Matching on the
   * reservation number is what stops a late request refunding a use that was
   * since spent on a different dinner.
   *
   * The legacy single-value field is matched too, so a booking made before
   * multi-use can still be cancelled.
   */
  const released = await PassKeyModel.findOneAndUpdate(
    {
      _id: id,
      $or: [{ reservationNumbers: reservationNumber }, { reservationNumber }],
      $expr: { $gt: [{ $ifNull: ["$usedCount", 1] }, 0] },
    },
    {
      $inc: { usedCount: -1 },
      $pull: { reservationNumbers: reservationNumber },
      $unset: { reservationNumber: "" },
    },
    { returnDocument: "after" },
  ).lean();

  if (!released) {
    return null;
  }

  const record = toPassKeyRecord(released as MongoPassKeyDocument);
  await PassKeyModel.updateOne({ _id: record.id }, { $set: { status: record.status } });

  return record;
}

/**
 * Spends a released key again when a cancellation is undone. Fails when the
 * guest has already booked something else with it, which is exactly right: the
 * key is spent, and that restore must not go through.
 */
export async function reclaimPassKey(id: string, reservationNumber: string): Promise<PassKeyRecord | null> {
  if (!id) {
    return null;
  }

  if (!isMongoConfigured()) {
    return reclaimLocalPassKey(id, reservationNumber);
  }

  if (!/^[a-f\d]{24}$/i.test(id)) {
    return null;
  }

  await connectToDatabase();

  const reclaimed = await PassKeyModel.findOneAndUpdate(
    {
      _id: id,
      status: { $ne: "revoked" },
      $expr: { $lt: [{ $ifNull: ["$usedCount", 0] }, { $ifNull: ["$maxUses", 1] }] },
    },
    {
      $inc: { usedCount: 1 },
      $addToSet: { reservationNumbers: reservationNumber },
      $set: { usedAt: new Date() },
    },
    { returnDocument: "after" },
  ).lean();

  if (!reclaimed) {
    return null;
  }

  const record = toPassKeyRecord(reclaimed as MongoPassKeyDocument);
  await PassKeyModel.updateOne({ _id: record.id }, { $set: { status: record.status } });

  return record;
}

export class UpdatePassKeyError extends Error {
  constructor(public readonly code: "NOT_FOUND" | "BELOW_USED") {
    super(code);
    this.name = "UpdatePassKeyError";
  }
}

/**
 * Changes the expiry, the number of dinners, or the note on a key already in a
 * guest's hand — a stay being extended, usually.
 *
 * `maxUses` may not drop below what has already been booked: that would
 * retroactively invalidate a dinner the guest is expecting to eat. Reception
 * has to cancel the booking first, which is the honest order to do it in.
 */
export async function updatePassKey(
  id: string,
  patch: {
    roomNumber?: string | null;
    reservationRef?: string | null;
    guestName?: string | null;
    expiresOn?: string | null;
    maxUses?: number;
    maxGuests?: number | null;
    note?: string;
  },
): Promise<{ before: PassKeyRecord; after: PassKeyRecord }> {
  const before = await getPassKeyById(id);
  if (!before) {
    throw new UpdatePassKeyError("NOT_FOUND");
  }

  if (patch.maxUses !== undefined && patch.maxUses < before.usedCount) {
    throw new UpdatePassKeyError("BELOW_USED");
  }

  const next: PassKeyRecord = {
    ...before,
    roomNumber:
      patch.roomNumber === undefined
        ? before.roomNumber
        : patch.roomNumber
          ? normalizeRoomNumber(patch.roomNumber)
          : undefined,
    reservationRef:
      patch.reservationRef === undefined ? before.reservationRef : (patch.reservationRef || undefined),
    guestName: patch.guestName === undefined ? before.guestName : (patch.guestName || undefined),
    expiresOn: patch.expiresOn === undefined ? before.expiresOn : (patch.expiresOn ?? undefined),
    maxUses: patch.maxUses ?? before.maxUses,
    maxGuests: patch.maxGuests === undefined ? before.maxGuests : (patch.maxGuests ?? undefined),
    note: patch.note === undefined ? before.note : patch.note || undefined,
  };

  // Raising the allowance can bring a spent key back to life, which is the
  // point of extending a stay.
  next.status = next.status === "revoked" ? "revoked" : next.usedCount >= next.maxUses ? "used" : "active";

  if (!isMongoConfigured()) {
    const saved = await updateLocalPassKey(id, {
      roomNumber: next.roomNumber,
      reservationRef: next.reservationRef,
      guestName: next.guestName,
      expiresOn: next.expiresOn,
      maxUses: next.maxUses,
      maxGuests: next.maxGuests,
      note: next.note,
      status: next.status,
    });

    if (!saved) {
      throw new UpdatePassKeyError("NOT_FOUND");
    }

    return { before, after: saved };
  }

  await connectToDatabase();

  const saved = await PassKeyModel.findByIdAndUpdate(
    id,
    {
      $set: {
        maxUses: next.maxUses,
        status: next.status,
        ...(patch.roomNumber === undefined ? {} : { roomNumber: next.roomNumber ?? null }),
        ...(patch.reservationRef === undefined ? {} : { reservationRef: next.reservationRef ?? null }),
        ...(patch.guestName === undefined ? {} : { guestName: next.guestName ?? null }),
        ...(patch.expiresOn === undefined ? {} : { expiresOn: patch.expiresOn ?? null }),
        ...(patch.maxGuests === undefined ? {} : { maxGuests: patch.maxGuests ?? null }),
        ...(patch.note === undefined ? {} : { note: patch.note || null }),
      },
    },
    { returnDocument: "after" },
  ).lean();

  if (!saved) {
    throw new UpdatePassKeyError("NOT_FOUND");
  }

  return { before, after: toPassKeyRecord(saved as MongoPassKeyDocument) };
}

/**
 * Erases a key outright.
 *
 * Revoking is the everyday action and keeps the record; this is for keys that
 * should never have existed — a misprint, a test row. Administrators only, for
 * the same reason deleting a reservation is: it cannot be undone.
 *
 * Any booking already made with it keeps its own record. The reservation loses
 * the key it pointed at, which means that guest can no longer self-serve it —
 * reception handles them, exactly as for a booking taken at the desk.
 */
export async function deletePassKey(id: string): Promise<PassKeyRecord | null> {
  if (!isMongoConfigured()) {
    return deleteLocalPassKey(id);
  }

  if (!/^[a-f\d]{24}$/i.test(id)) {
    return null;
  }

  await connectToDatabase();
  const removed = await PassKeyModel.findByIdAndDelete(id).lean();
  return removed ? toPassKeyRecord(removed as MongoPassKeyDocument) : null;
}

export async function revokePassKey(id: string): Promise<PassKeyRecord | null> {
  if (!isMongoConfigured()) {
    return revokeLocalPassKey(id);
  }

  if (!/^[a-f\d]{24}$/i.test(id)) {
    return null;
  }

  await connectToDatabase();

  const revoked = await PassKeyModel.findByIdAndUpdate(
    id,
    { $set: { status: "revoked", revokedAt: new Date() } },
    { returnDocument: "after" },
  ).lean();

  return revoked ? toPassKeyRecord(revoked as MongoPassKeyDocument) : null;
}
