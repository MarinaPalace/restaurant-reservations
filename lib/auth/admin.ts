import bcrypt from "bcryptjs";
import { timingSafeEqual } from "crypto";
import { AdminConfigError } from "@/lib/auth/session";
import { describePasswordHashProblem, readEnv } from "@/lib/auth/config";

const DEVELOPMENT_PASSWORD = "admin123";

let developmentHash: string | null = null;

function getAdminUsername() {
  return readEnv("ADMIN_USERNAME") || "admin";
}

function getAdminPasswordHash() {
  const configured = readEnv("ADMIN_PASSWORD_HASH");
  const problem = describePasswordHashProblem(configured);

  if (!problem) {
    return configured as string;
  }

  if (process.env.NODE_ENV === "production") {
    // Names the actual fault so it is visible in the server logs rather than
    // presenting as an ordinary wrong password.
    throw new AdminConfigError(`ADMIN_PASSWORD_HASH ${problem}.`);
  }

  if (configured) {
    console.warn(`[admin] Ignoring ADMIN_PASSWORD_HASH: it ${problem}.`);
  }

  if (!developmentHash) {
    developmentHash = bcrypt.hashSync(DEVELOPMENT_PASSWORD, 10);
    console.warn(
      `[admin] Using the development password "${DEVELOPMENT_PASSWORD}". ` +
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
  const usernameMatches = Boolean(username) && safeEquals(username.trim(), getAdminUsername());
  const passwordMatches = await bcrypt.compare(password ?? "", expectedHash);

  if (!usernameMatches && passwordMatches) {
    console.warn(`[admin] Password correct but username "${username}" does not match ADMIN_USERNAME.`);
  }

  return usernameMatches && passwordMatches;
}
