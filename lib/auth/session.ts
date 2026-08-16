import { createHmac, randomBytes, timingSafeEqual } from "crypto";
import { cookies } from "next/headers";
import { describeSessionSecretProblem, readEnv } from "@/lib/auth/config";

export const ADMIN_SESSION_COOKIE = "admin_session";

const SESSION_TTL_SECONDS = 60 * 60 * 8;

/**
 * The account backed by ADMIN_USERNAME / ADMIN_PASSWORD_HASH rather than the
 * database. It is the way into a deployment that has no staff accounts yet.
 */
export const ENVIRONMENT_ADMIN_ID = "env-admin";

/** Ids are embedded in the signed payload, so they must not contain its separators. */
const SESSION_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * Thrown when the deployment is missing the secrets required to run the admin
 * area. Routes turn this into a 503 so a misconfigured server fails closed
 * instead of silently accepting everybody.
 */
export class AdminConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AdminConfigError";
  }
}

/**
 * Development-only fallback secret. It is regenerated on every process start,
 * so sessions do not survive a restart, but they can never be forged either.
 */
let developmentSecret: string | null = null;

function getSessionSecret() {
  const configured = readEnv("ADMIN_SESSION_SECRET");
  const problem = describeSessionSecretProblem(configured);

  if (!problem) {
    return configured as string;
  }

  if (process.env.NODE_ENV === "production") {
    throw new AdminConfigError(`ADMIN_SESSION_SECRET ${problem}.`);
  }

  if (!developmentSecret) {
    developmentSecret = randomBytes(32).toString("hex");
  }

  return developmentSecret;
}

function sign(payload: string) {
  return createHmac("sha256", getSessionSecret()).update(payload).digest("base64url");
}

function safeEquals(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) {
    return false;
  }
  return timingSafeEqual(left, right);
}

/**
 * Builds a tamper-proof `<expiresAt>:<userId>.<signature>` session value.
 *
 * The signed payload carries *which* account is signed in, because the audit
 * log has to be able to name the person who cancelled a booking, and because
 * permissions differ per account. Both are inside the signature, so neither
 * can be edited by hand.
 */
export function createSessionValue(options: { userId?: string; nowMs?: number } = {}) {
  const { userId = ENVIRONMENT_ADMIN_ID, nowMs = Date.now() } = options;

  if (!SESSION_ID_PATTERN.test(userId)) {
    throw new Error("Session user id contains characters that would corrupt the token.");
  }

  const expiresAt = Math.floor(nowMs / 1000) + SESSION_TTL_SECONDS;
  const payload = `${expiresAt}:${userId}`;
  return `${payload}.${sign(payload)}`;
}

/**
 * Verifies a session value and returns who it belongs to, or `null`.
 *
 * A payload of nothing but digits is a token issued before sessions carried an
 * identity. It stays valid and reads as the environment administrator, so a
 * deploy does not sign every member of staff out mid-service.
 */
export function readSessionValue(
  value: string | undefined | null,
  nowMs = Date.now(),
): { userId: string; expiresAt: number } | null {
  if (!value) {
    return null;
  }

  const separatorIndex = value.lastIndexOf(".");
  if (separatorIndex <= 0) {
    return null;
  }

  const payload = value.slice(0, separatorIndex);
  const signature = value.slice(separatorIndex + 1);

  if (!signature) {
    return null;
  }

  const [expiresAtPart, userIdPart] = splitPayload(payload);
  if (expiresAtPart === null) {
    return null;
  }

  if (!safeEquals(signature, sign(payload))) {
    return null;
  }

  if (expiresAtPart * 1000 <= nowMs) {
    return null;
  }

  return { userId: userIdPart, expiresAt: expiresAtPart };
}

function splitPayload(payload: string): [number | null, string] {
  const separator = payload.indexOf(":");

  if (separator === -1) {
    // Legacy token: an expiry and nothing else.
    return [/^\d+$/.test(payload) ? Number(payload) : null, ENVIRONMENT_ADMIN_ID];
  }

  const expiresAt = payload.slice(0, separator);
  const userId = payload.slice(separator + 1);

  if (!/^\d+$/.test(expiresAt) || !SESSION_ID_PATTERN.test(userId)) {
    return [null, ENVIRONMENT_ADMIN_ID];
  }

  return [Number(expiresAt), userId];
}

export function verifySessionValue(value: string | undefined | null, nowMs = Date.now()) {
  return readSessionValue(value, nowMs) !== null;
}

export const sessionCookieOptions = {
  httpOnly: true,
  sameSite: "lax",
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: SESSION_TTL_SECONDS,
} as const;

export async function startAdminSession(userId: string = ENVIRONMENT_ADMIN_ID) {
  const cookieStore = await cookies();
  cookieStore.set(ADMIN_SESSION_COOKIE, createSessionValue({ userId }), sessionCookieOptions);
}

export async function endAdminSession() {
  const cookieStore = await cookies();
  cookieStore.set(ADMIN_SESSION_COOKIE, "", { ...sessionCookieOptions, maxAge: 0, expires: new Date(0) });
}

/** The signed-in account id, or `null`. Reads the cookie, nothing else. */
export async function getSessionUserId() {
  const cookieStore = await cookies();
  return readSessionValue(cookieStore.get(ADMIN_SESSION_COOKIE)?.value)?.userId ?? null;
}

/**
 * Authoritative check that *somebody* is signed in. What they are allowed to
 * do on top of that is `requirePermission` in lib/auth/guard.ts.
 */
export async function isAdminAuthenticated() {
  return (await getSessionUserId()) !== null;
}
