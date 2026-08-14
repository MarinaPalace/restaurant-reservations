import bcrypt from "bcryptjs";
import { timingSafeEqual } from "crypto";
import { AdminConfigError } from "@/lib/auth/session";

const DEVELOPMENT_PASSWORD = "admin123";

let developmentHash: string | null = null;

function getAdminUsername() {
  return process.env.ADMIN_USERNAME ?? "admin";
}

function getAdminPasswordHash() {
  const configured = process.env.ADMIN_PASSWORD_HASH;
  if (configured) {
    return configured;
  }

  if (process.env.NODE_ENV === "production") {
    throw new AdminConfigError("ADMIN_PASSWORD_HASH must be set in production.");
  }

  if (!developmentHash) {
    developmentHash = bcrypt.hashSync(DEVELOPMENT_PASSWORD, 10);
    console.warn(
      `[admin] ADMIN_PASSWORD_HASH is not set. Falling back to the development password "${DEVELOPMENT_PASSWORD}". ` +
        "Set ADMIN_PASSWORD_HASH before deploying.",
    );
  }

  return developmentHash;
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
 * Verifies admin credentials. Always runs the bcrypt comparison, even when the
 * username is wrong, so a wrong username and a wrong password take the same
 * amount of time and cannot be told apart.
 */
export async function verifyAdminCredentials(username: string, password: string) {
  const expectedHash = getAdminPasswordHash();
  const usernameMatches = Boolean(username) && safeEquals(username, getAdminUsername());
  const passwordMatches = await bcrypt.compare(password ?? "", expectedHash);

  return usernameMatches && passwordMatches;
}
