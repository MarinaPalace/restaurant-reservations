import { connectToDatabase, isMongoConfigured } from "@/lib/db/connect";
import { PassKeyModel } from "@/lib/models/pass-key";
import {
  consumeLocalPassKey,
  createLocalPassKey,
  getLocalPassKey,
  getLocalPassKeyByCode,
  listLocalPassKeys,
  reclaimLocalPassKey,
  releaseLocalPassKey,
  revokeLocalPassKey,
} from "@/lib/db/local-admin-store";
import { generatePassKeyCode, normalizePassKey } from "@/lib/pass-key";
import { todayKey } from "@/lib/date";
import { normalizeRoomNumber } from "@/lib/room";
import { MINIMUM_STAY_NIGHTS, type Actor, type PassKeyRecord } from "@/types/booking";

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
  used: "That pass-key has already been used for a reservation. Please speak to reception.",
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

function toPassKeyRecord(document: MongoPassKeyDocument): PassKeyRecord {
  return {
    _id: String(document._id),
    id: String(document._id),
    code: String(document.code),
    roomNumber: document.roomNumber ? String(document.roomNumber) : undefined,
    guestName: document.guestName ? String(document.guestName) : undefined,
    nights: typeof document.nights === "number" ? document.nights : undefined,
    expiresOn: document.expiresOn ? String(document.expiresOn) : undefined,
    status: (document.status as PassKeyRecord["status"]) ?? "active",
    reservationNumber: document.reservationNumber ? String(document.reservationNumber) : undefined,
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

  if (key.status === "used") {
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
  roomNumber?: string;
  guestName?: string;
  nights?: number;
  expiresOn?: string;
  note?: string;
  allowShortStay?: boolean;
  actor: Actor;
}): Promise<PassKeyRecord> {
  const nights = input.nights;

  if (!input.allowShortStay && typeof nights === "number" && nights < MINIMUM_STAY_NIGHTS) {
    throw new ShortStayError();
  }

  const base = {
    roomNumber: input.roomNumber ? normalizeRoomNumber(input.roomNumber) : undefined,
    guestName: input.guestName?.trim() || undefined,
    nights,
    expiresOn: input.expiresOn,
    status: "active" as const,
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

  const consumed = await PassKeyModel.findOneAndUpdate(
    { code: normalized, status: "active" },
    { $set: { status: "used", reservationNumber, usedAt: new Date() } },
    { returnDocument: "after" },
  ).lean();

  return consumed ? toPassKeyRecord(consumed as MongoPassKeyDocument) : null;
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

  const released = await PassKeyModel.findOneAndUpdate(
    { _id: id, status: "used", reservationNumber },
    { $set: { status: "active" }, $unset: { usedAt: "" } },
    { returnDocument: "after" },
  ).lean();

  return released ? toPassKeyRecord(released as MongoPassKeyDocument) : null;
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
    { _id: id, status: "active" },
    { $set: { status: "used", reservationNumber, usedAt: new Date() } },
    { returnDocument: "after" },
  ).lean();

  return reclaimed ? toPassKeyRecord(reclaimed as MongoPassKeyDocument) : null;
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
