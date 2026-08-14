import { createHmac, randomBytes, timingSafeEqual } from "crypto";
import { cookies } from "next/headers";
import { describeSessionSecretProblem, readEnv } from "@/lib/auth/config";

export const ADMIN_SESSION_COOKIE = "admin_session";

const SESSION_TTL_SECONDS = 60 * 60 * 8;

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

/** Builds a tamper-proof `<expiresAt>.<signature>` session value. */
export function createSessionValue(nowMs = Date.now()) {
  const expiresAt = Math.floor(nowMs / 1000) + SESSION_TTL_SECONDS;
  const payload = String(expiresAt);
  return `${payload}.${sign(payload)}`;
}

export function verifySessionValue(value: string | undefined | null, nowMs = Date.now()) {
  if (!value) {
    return false;
  }

  const separatorIndex = value.lastIndexOf(".");
  if (separatorIndex <= 0) {
    return false;
  }

  const payload = value.slice(0, separatorIndex);
  const signature = value.slice(separatorIndex + 1);

  if (!/^\d+$/.test(payload) || !signature) {
    return false;
  }

  if (!safeEquals(signature, sign(payload))) {
    return false;
  }

  return Number(payload) * 1000 > nowMs;
}

export const sessionCookieOptions = {
  httpOnly: true,
  sameSite: "lax",
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: SESSION_TTL_SECONDS,
} as const;

export async function startAdminSession() {
  const cookieStore = await cookies();
  cookieStore.set(ADMIN_SESSION_COOKIE, createSessionValue(), sessionCookieOptions);
}

export async function endAdminSession() {
  const cookieStore = await cookies();
  cookieStore.set(ADMIN_SESSION_COOKIE, "", { ...sessionCookieOptions, maxAge: 0, expires: new Date(0) });
}

/** Authoritative admin check. Every admin page and API route goes through this. */
export async function isAdminAuthenticated() {
  const cookieStore = await cookies();
  return verifySessionValue(cookieStore.get(ADMIN_SESSION_COOKIE)?.value);
}
