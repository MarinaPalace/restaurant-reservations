import { randomUUID } from "crypto";
import { getDataFilePath, readJsonFile, writeJsonFile } from "@/lib/db/json-file";
import { withStoreLock } from "@/lib/db/store-lock";
import type { AuditEntry, PassKeyRecord, StaffPermission, StaffRole } from "@/types/booking";

/**
 * The file-backed half of staff accounts, pass-keys and the audit log, used
 * when MONGODB_URI is not configured — that is, in local development.
 *
 * It shares one lock with the rest of the JSON store (`store-lock.ts`),
 * because spending a pass-key and writing the reservation it paid for must not
 * interleave with another request doing the same.
 */

const USERS_FILE = "staff-users.json";
const PASS_KEYS_FILE = "pass-keys.json";
const AUDIT_FILE = "audit-log.json";

/** How much of the log is kept locally. Mongo keeps everything. */
const LOCAL_AUDIT_LIMIT = 2000;

/** The stored shape of an account, password hash included. Never leaves this layer. */
export type StoredStaffUser = {
  id: string;
  username: string;
  passwordHash: string;
  name: string;
  role: StaffRole;
  permissions: StaffPermission[];
  active: boolean;
  createdAt: string;
  updatedAt: string;
  lastLoginAt?: string;
  createdByName?: string;
};

async function readUsers(): Promise<StoredStaffUser[]> {
  const users = await readJsonFile<StoredStaffUser[]>(getDataFilePath(USERS_FILE), []);
  return Array.isArray(users) ? users : [];
}

async function readPassKeys(): Promise<PassKeyRecord[]> {
  const keys = await readJsonFile<PassKeyRecord[]>(getDataFilePath(PASS_KEYS_FILE), []);
  return Array.isArray(keys) ? keys : [];
}

async function readAudit(): Promise<AuditEntry[]> {
  const entries = await readJsonFile<AuditEntry[]>(getDataFilePath(AUDIT_FILE), []);
  return Array.isArray(entries) ? entries : [];
}

/* ------------------------------------------------------------------ *
 * Staff accounts
 * ------------------------------------------------------------------ */

export async function listLocalStaffUsers(): Promise<StoredStaffUser[]> {
  const users = await readUsers();
  return [...users].sort((a, b) => a.username.localeCompare(b.username));
}

export async function getLocalStaffUser(id: string): Promise<StoredStaffUser | null> {
  return (await readUsers()).find((user) => user.id === id) ?? null;
}

export async function findLocalStaffUserByUsername(username: string): Promise<StoredStaffUser | null> {
  const wanted = username.trim().toLowerCase();
  return (await readUsers()).find((user) => user.username === wanted) ?? null;
}

export async function createLocalStaffUser(input: {
  username: string;
  passwordHash: string;
  name: string;
  role: StaffRole;
  permissions: StaffPermission[];
  createdByName?: string;
}): Promise<{ ok: true; user: StoredStaffUser } | { ok: false; reason: "USERNAME_TAKEN" }> {
  return withStoreLock(async () => {
    const users = await readUsers();
    const username = input.username.trim().toLowerCase();

    if (users.some((user) => user.username === username)) {
      return { ok: false as const, reason: "USERNAME_TAKEN" as const };
    }

    const timestamp = new Date().toISOString();
    const user: StoredStaffUser = {
      id: randomUUID(),
      username,
      passwordHash: input.passwordHash,
      name: input.name,
      role: input.role,
      permissions: input.permissions,
      active: true,
      createdAt: timestamp,
      updatedAt: timestamp,
      createdByName: input.createdByName,
    };

    users.push(user);
    await writeJsonFile(getDataFilePath(USERS_FILE), users);

    return { ok: true as const, user };
  });
}

export async function updateLocalStaffUser(
  id: string,
  patch: Partial<Pick<StoredStaffUser, "name" | "role" | "permissions" | "active" | "passwordHash" | "lastLoginAt">>,
): Promise<StoredStaffUser | null> {
  return withStoreLock(async () => {
    const users = await readUsers();
    const index = users.findIndex((user) => user.id === id);
    if (index === -1) {
      return null;
    }

    users[index] = { ...users[index], ...patch, updatedAt: new Date().toISOString() };
    await writeJsonFile(getDataFilePath(USERS_FILE), users);
    return users[index];
  });
}

export async function deleteLocalStaffUser(id: string): Promise<StoredStaffUser | null> {
  return withStoreLock(async () => {
    const users = await readUsers();
    const index = users.findIndex((user) => user.id === id);
    if (index === -1) {
      return null;
    }

    const [removed] = users.splice(index, 1);
    await writeJsonFile(getDataFilePath(USERS_FILE), users);
    return removed;
  });
}

export async function countLocalAdmins(excludeId?: string): Promise<number> {
  const users = await readUsers();
  return users.filter((user) => user.role === "admin" && user.active && user.id !== excludeId).length;
}

/* ------------------------------------------------------------------ *
 * Pass-keys
 * ------------------------------------------------------------------ */

export async function listLocalPassKeys(): Promise<PassKeyRecord[]> {
  const keys = await readPassKeys();
  return [...keys].sort((a, b) => (b.issuedAt ?? "").localeCompare(a.issuedAt ?? ""));
}

export async function getLocalPassKeyByCode(code: string): Promise<PassKeyRecord | null> {
  return (await readPassKeys()).find((key) => key.code === code) ?? null;
}

export async function getLocalPassKey(id: string): Promise<PassKeyRecord | null> {
  return (await readPassKeys()).find((key) => key.id === id) ?? null;
}

export async function createLocalPassKey(
  key: Omit<PassKeyRecord, "id">,
): Promise<{ ok: true; key: PassKeyRecord } | { ok: false; reason: "CODE_TAKEN" }> {
  return withStoreLock(async () => {
    const keys = await readPassKeys();

    if (keys.some((entry) => entry.code === key.code)) {
      return { ok: false as const, reason: "CODE_TAKEN" as const };
    }

    const created: PassKeyRecord = { ...key, id: randomUUID() };
    keys.push(created);
    await writeJsonFile(getDataFilePath(PASS_KEYS_FILE), keys);

    return { ok: true as const, key: created };
  });
}

/**
 * Spends a key, but only while it is still active — the status filter is what
 * stops two requests racing to book with the same key and both winning.
 */
export async function consumeLocalPassKey(
  code: string,
  reservationNumber: string,
): Promise<PassKeyRecord | null> {
  return withStoreLock(async () => {
    const keys = await readPassKeys();
    const index = keys.findIndex((key) => key.code === code && key.status === "active");
    if (index === -1) {
      return null;
    }

    keys[index] = {
      ...keys[index],
      status: "used",
      reservationNumber,
      usedAt: new Date().toISOString(),
    };

    await writeJsonFile(getDataFilePath(PASS_KEYS_FILE), keys);
    return keys[index];
  });
}

/**
 * Hands a spent key back, so a guest who cancels — or whose booking failed to
 * write — can book again. Only ever releases the key from the reservation it
 * was actually spent on.
 */
export async function releaseLocalPassKey(
  id: string,
  reservationNumber: string,
): Promise<PassKeyRecord | null> {
  return withStoreLock(async () => {
    const keys = await readPassKeys();
    const index = keys.findIndex(
      (key) => key.id === id && key.status === "used" && key.reservationNumber === reservationNumber,
    );
    if (index === -1) {
      return null;
    }

    keys[index] = { ...keys[index], status: "active", usedAt: undefined };
    await writeJsonFile(getDataFilePath(PASS_KEYS_FILE), keys);
    return keys[index];
  });
}

/** Re-spends a released key when a cancellation is undone. */
export async function reclaimLocalPassKey(
  id: string,
  reservationNumber: string,
): Promise<PassKeyRecord | null> {
  return withStoreLock(async () => {
    const keys = await readPassKeys();
    const index = keys.findIndex((key) => key.id === id && key.status === "active");
    if (index === -1) {
      return null;
    }

    keys[index] = {
      ...keys[index],
      status: "used",
      reservationNumber,
      usedAt: new Date().toISOString(),
    };

    await writeJsonFile(getDataFilePath(PASS_KEYS_FILE), keys);
    return keys[index];
  });
}

export async function revokeLocalPassKey(id: string): Promise<PassKeyRecord | null> {
  return withStoreLock(async () => {
    const keys = await readPassKeys();
    const index = keys.findIndex((key) => key.id === id);
    if (index === -1) {
      return null;
    }

    keys[index] = { ...keys[index], status: "revoked", revokedAt: new Date().toISOString() };
    await writeJsonFile(getDataFilePath(PASS_KEYS_FILE), keys);
    return keys[index];
  });
}

/* ------------------------------------------------------------------ *
 * Audit log
 * ------------------------------------------------------------------ */

export async function appendLocalAuditEntry(entry: Omit<AuditEntry, "id">): Promise<AuditEntry> {
  return withStoreLock(async () => {
    const entries = await readAudit();
    const created: AuditEntry = { ...entry, id: randomUUID() };

    entries.push(created);

    // Newest kept; the local store is a development convenience, not an
    // archive.
    const trimmed = entries.slice(-LOCAL_AUDIT_LIMIT);
    await writeJsonFile(getDataFilePath(AUDIT_FILE), trimmed);

    return created;
  });
}

export async function listLocalAuditEntries(options: {
  reservationNumber?: string;
  limit?: number;
}): Promise<AuditEntry[]> {
  const entries = await readAudit();
  const filtered = options.reservationNumber
    ? entries.filter((entry) => entry.reservationNumber === options.reservationNumber)
    : entries;

  return [...filtered].sort((a, b) => b.at.localeCompare(a.at)).slice(0, options.limit ?? 200);
}
