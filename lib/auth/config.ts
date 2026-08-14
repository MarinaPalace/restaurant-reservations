/**
 * Validates the admin secrets and explains precisely what is wrong.
 *
 * Every value is trimmed: a hash or secret pasted into a dashboard or an
 * .env file very often carries a trailing newline or space, which silently
 * turns a correct password into a failed login.
 */

export const BCRYPT_HASH_PATTERN = /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/;

export const MIN_SECRET_LENGTH = 16;

export type AdminConfigProblem = {
  variable: "ADMIN_PASSWORD_HASH" | "ADMIN_SESSION_SECRET" | "ADMIN_USERNAME";
  detail: string;
};

export function readEnv(name: string) {
  const value = process.env[name];
  return typeof value === "string" ? value.trim() : undefined;
}

export function describePasswordHashProblem(rawHash: string | undefined): string | null {
  if (!rawHash) {
    return "not set";
  }

  if (BCRYPT_HASH_PATTERN.test(rawHash)) {
    return null;
  }

  // The classic failure: a shell expanded the $2b / $10 segments of the hash,
  // so what arrives is a truncated fragment rather than a bcrypt hash.
  if (!rawHash.startsWith("$")) {
    return (
      "does not start with '$'. The '$' segments were probably expanded by a shell — " +
      "wrap the value in single quotes, or paste it into the Vercel dashboard rather than a shell command"
    );
  }

  if (/^\$2[aby]\$\d{2}\$/.test(rawHash)) {
    return `has the right prefix but is ${rawHash.length} characters instead of 60 — it looks truncated`;
  }

  return `is not a bcrypt hash (expected something like $2b$10$… and 60 characters, got ${rawHash.length})`;
}

export function describeSessionSecretProblem(rawSecret: string | undefined): string | null {
  if (!rawSecret) {
    return "not set";
  }

  if (rawSecret.length < MIN_SECRET_LENGTH) {
    return `is only ${rawSecret.length} characters; it must be at least ${MIN_SECRET_LENGTH}`;
  }

  return null;
}

/** Everything wrong with the current admin configuration. */
export function findAdminConfigProblems(): AdminConfigProblem[] {
  const problems: AdminConfigProblem[] = [];

  const hashProblem = describePasswordHashProblem(readEnv("ADMIN_PASSWORD_HASH"));
  if (hashProblem) {
    problems.push({ variable: "ADMIN_PASSWORD_HASH", detail: hashProblem });
  }

  const secretProblem = describeSessionSecretProblem(readEnv("ADMIN_SESSION_SECRET"));
  if (secretProblem) {
    problems.push({ variable: "ADMIN_SESSION_SECRET", detail: secretProblem });
  }

  return problems;
}
