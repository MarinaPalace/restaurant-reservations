import bcrypt from "bcryptjs";
import { connectToDatabase, isMongoConfigured } from "@/lib/db/connect";
import { StaffUserModel } from "@/lib/models/staff-user";
import {
  countLocalAdmins,
  createLocalStaffUser,
  deleteLocalStaffUser,
  findLocalStaffUserByUsername,
  getLocalStaffUser,
  listLocalStaffUsers,
  updateLocalStaffUser,
  type StoredStaffUser,
} from "@/lib/db/local-admin-store";
import { sanitizePermissions } from "@/lib/auth/permissions";
import { ENVIRONMENT_ADMIN_ID } from "@/lib/auth/session";
import { readEnv } from "@/lib/auth/config";
import type { StaffPermission, StaffRole, StaffUserRecord } from "@/types/booking";

/**
 * Staff accounts.
 *
 * Password hashes never leave this module: every function returns a
 * `StaffUserRecord`, which has no hash on it, so a route cannot leak one by
 * forgetting to strip it.
 */

const BCRYPT_ROUNDS = 10;

export class StaffUserError extends Error {
  constructor(public readonly code: "USERNAME_TAKEN" | "NOT_FOUND" | "LAST_ADMIN" | "IMMUTABLE") {
    super(code);
    this.name = "StaffUserError";
  }
}

type MongoStaffDocument = Record<string, unknown>;

function toStaffUserRecord(document: MongoStaffDocument): StaffUserRecord {
  return {
    _id: String(document._id),
    id: String(document._id),
    username: String(document.username),
    name: String(document.name ?? document.username),
    role: document.role === "admin" ? "admin" : "staff",
    permissions: Array.isArray(document.permissions) ? (document.permissions as StaffPermission[]) : [],
    active: document.active !== false,
    createdAt: document.createdAt ? new Date(document.createdAt as string).toISOString() : undefined,
    updatedAt: document.updatedAt ? new Date(document.updatedAt as string).toISOString() : undefined,
    lastLoginAt: document.lastLoginAt ? new Date(document.lastLoginAt as string).toISOString() : undefined,
    createdByName: document.createdByName ? String(document.createdByName) : undefined,
  };
}

function fromStoredUser(user: StoredStaffUser): StaffUserRecord {
  return {
    id: user.id,
    username: user.username,
    name: user.name,
    role: user.role,
    permissions: user.permissions ?? [],
    active: user.active,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
    lastLoginAt: user.lastLoginAt,
    createdByName: user.createdByName,
  };
}

/**
 * The account backed by ADMIN_USERNAME / ADMIN_PASSWORD_HASH.
 *
 * It is not in the database, cannot be edited from the panel, and exists so a
 * deployment with no accounts yet can still be signed into — and so locking
 * everyone out by deleting the last admin is always recoverable.
 */
export function getEnvironmentAdmin(): StaffUserRecord {
  return {
    id: ENVIRONMENT_ADMIN_ID,
    username: readEnv("ADMIN_USERNAME") || "admin",
    name: "Owner account",
    role: "admin",
    permissions: [],
    active: true,
    isEnvironmentAccount: true,
  };
}

export async function listStaffUsers(): Promise<StaffUserRecord[]> {
  if (!isMongoConfigured()) {
    return (await listLocalStaffUsers()).map(fromStoredUser);
  }

  await connectToDatabase();
  const users = await StaffUserModel.find().sort({ username: 1 }).lean();
  return users.map((user) => toStaffUserRecord(user as MongoStaffDocument));
}

/** Resolves whoever a session belongs to, environment account included. */
export async function getStaffUserById(id: string): Promise<StaffUserRecord | null> {
  if (id === ENVIRONMENT_ADMIN_ID) {
    return getEnvironmentAdmin();
  }

  if (!isMongoConfigured()) {
    const user = await getLocalStaffUser(id);
    return user ? fromStoredUser(user) : null;
  }

  // An id that is not a Mongo ObjectId would make findById throw.
  if (!/^[a-f\d]{24}$/i.test(id)) {
    return null;
  }

  await connectToDatabase();
  const user = await StaffUserModel.findById(id).lean();
  return user ? toStaffUserRecord(user as MongoStaffDocument) : null;
}

/**
 * Checks a username and password against the database accounts.
 *
 * Always runs a bcrypt comparison, even when there is no such account, so a
 * wrong username and a wrong password take the same time and cannot be told
 * apart by an attacker enumerating names.
 */
const DUMMY_HASH = bcrypt.hashSync("password-that-is-never-correct", BCRYPT_ROUNDS);

export async function verifyStaffCredentials(
  username: string,
  password: string,
): Promise<StaffUserRecord | null> {
  const wanted = username.trim().toLowerCase();
  let stored: { id: string; passwordHash: string; active: boolean; record: StaffUserRecord } | null = null;

  if (!isMongoConfigured()) {
    const user = await findLocalStaffUserByUsername(wanted);
    if (user) {
      stored = {
        id: user.id,
        passwordHash: user.passwordHash,
        active: user.active,
        record: fromStoredUser(user),
      };
    }
  } else {
    await connectToDatabase();
    const user = await StaffUserModel.findOne({ username: wanted }).lean();
    if (user) {
      const document = user as MongoStaffDocument;
      stored = {
        id: String(document._id),
        passwordHash: String(document.passwordHash),
        active: document.active !== false,
        record: toStaffUserRecord(document),
      };
    }
  }

  const matches = await bcrypt.compare(password ?? "", stored?.passwordHash ?? DUMMY_HASH);

  if (!stored || !matches || !stored.active) {
    return null;
  }

  await touchLastLogin(stored.id);
  return stored.record;
}

async function touchLastLogin(id: string) {
  try {
    if (!isMongoConfigured()) {
      await updateLocalStaffUser(id, { lastLoginAt: new Date().toISOString() });
      return;
    }

    await connectToDatabase();
    await StaffUserModel.updateOne({ _id: id }, { $set: { lastLoginAt: new Date() } });
  } catch (error) {
    // A sign-in must not fail because the timestamp could not be written.
    console.error("[staff] failed to record last login", error);
  }
}

export async function createStaffUser(input: {
  username: string;
  password: string;
  name: string;
  role: StaffRole;
  permissions: unknown;
  createdByName?: string;
}): Promise<StaffUserRecord> {
  const username = input.username.trim().toLowerCase();
  const permissions = sanitizePermissions(input.permissions, input.role);
  const passwordHash = await bcrypt.hash(input.password, BCRYPT_ROUNDS);

  // The environment account's name is reserved: two accounts answering to the
  // same username would make it ambiguous which one a sign-in meant.
  if (username === (readEnv("ADMIN_USERNAME") || "admin").toLowerCase()) {
    throw new StaffUserError("USERNAME_TAKEN");
  }

  if (!isMongoConfigured()) {
    const result = await createLocalStaffUser({
      username,
      passwordHash,
      name: input.name.trim(),
      role: input.role,
      permissions,
      createdByName: input.createdByName,
    });

    if (!result.ok) {
      throw new StaffUserError("USERNAME_TAKEN");
    }

    return fromStoredUser(result.user);
  }

  await connectToDatabase();

  if (await StaffUserModel.exists({ username })) {
    throw new StaffUserError("USERNAME_TAKEN");
  }

  try {
    const created = await StaffUserModel.create({
      username,
      passwordHash,
      name: input.name.trim(),
      role: input.role,
      permissions,
      active: true,
      createdByName: input.createdByName,
    });

    return toStaffUserRecord(created.toObject() as MongoStaffDocument);
  } catch (error) {
    // The unique index is the real guard; the check above only makes the
    // common case a tidy message.
    if ((error as { code?: number }).code === 11000) {
      throw new StaffUserError("USERNAME_TAKEN");
    }
    throw error;
  }
}

export async function updateStaffUser(
  id: string,
  patch: { name?: string; role?: StaffRole; permissions?: unknown; active?: boolean; password?: string },
): Promise<StaffUserRecord> {
  if (id === ENVIRONMENT_ADMIN_ID) {
    // It lives in the environment; there is nothing here to write.
    throw new StaffUserError("IMMUTABLE");
  }

  const existing = await getStaffUserById(id);
  if (!existing) {
    throw new StaffUserError("NOT_FOUND");
  }

  const nextRole = patch.role ?? existing.role;

  // Demoting or disabling the last administrator would lock the panel to
  // whoever holds the environment password, which may be nobody on duty.
  const losingAdmin =
    existing.role === "admin" && (nextRole !== "admin" || patch.active === false);
  if (losingAdmin && (await countActiveAdmins(id)) === 0) {
    throw new StaffUserError("LAST_ADMIN");
  }

  const update: Record<string, unknown> = {};

  if (patch.name !== undefined) update.name = patch.name.trim();
  if (patch.role !== undefined) update.role = patch.role;
  if (patch.active !== undefined) update.active = patch.active;
  if (patch.permissions !== undefined || patch.role !== undefined) {
    update.permissions = sanitizePermissions(patch.permissions ?? existing.permissions, nextRole);
  }
  if (patch.password) {
    update.passwordHash = await bcrypt.hash(patch.password, BCRYPT_ROUNDS);
  }

  if (!isMongoConfigured()) {
    const updated = await updateLocalStaffUser(id, update as Partial<StoredStaffUser>);
    if (!updated) {
      throw new StaffUserError("NOT_FOUND");
    }
    return fromStoredUser(updated);
  }

  await connectToDatabase();
  const updated = await StaffUserModel.findByIdAndUpdate(id, { $set: update }, { returnDocument: "after" }).lean();

  if (!updated) {
    throw new StaffUserError("NOT_FOUND");
  }

  return toStaffUserRecord(updated as MongoStaffDocument);
}

export async function deleteStaffUser(id: string): Promise<StaffUserRecord> {
  if (id === ENVIRONMENT_ADMIN_ID) {
    throw new StaffUserError("IMMUTABLE");
  }

  const existing = await getStaffUserById(id);
  if (!existing) {
    throw new StaffUserError("NOT_FOUND");
  }

  if (existing.role === "admin" && (await countActiveAdmins(id)) === 0) {
    throw new StaffUserError("LAST_ADMIN");
  }

  if (!isMongoConfigured()) {
    const removed = await deleteLocalStaffUser(id);
    if (!removed) {
      throw new StaffUserError("NOT_FOUND");
    }
    return fromStoredUser(removed);
  }

  await connectToDatabase();
  const removed = await StaffUserModel.findByIdAndDelete(id).lean();
  if (!removed) {
    throw new StaffUserError("NOT_FOUND");
  }

  return toStaffUserRecord(removed as MongoStaffDocument);
}

/** Active administrators in the database, not counting the given account. */
async function countActiveAdmins(excludeId?: string): Promise<number> {
  if (!isMongoConfigured()) {
    return countLocalAdmins(excludeId);
  }

  await connectToDatabase();
  const filter: Record<string, unknown> = { role: "admin", active: true };
  if (excludeId) {
    filter._id = { $ne: excludeId };
  }

  return StaffUserModel.countDocuments(filter);
}
