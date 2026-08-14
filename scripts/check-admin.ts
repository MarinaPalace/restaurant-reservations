import bcrypt from "bcryptjs";
import {
  describePasswordHashProblem,
  describeSessionSecretProblem,
  readEnv,
} from "@/lib/auth/config";

/**
 * Diagnoses admin sign-in problems.
 *
 *   npm run check:admin -- 'the-password-you-are-typing'
 *
 * Run it with the same environment as the deployment (for Vercel:
 * `vercel env pull .env.local` first) to see which variable is at fault.
 */

const candidatePassword = process.argv[2];

function mask(value: string | undefined) {
  if (!value) return "(not set)";
  if (value.length <= 12) return `${value[0]}…${value[value.length - 1]} (${value.length} chars)`;
  return `${value.slice(0, 7)}…${value.slice(-4)} (${value.length} chars)`;
}

const username = readEnv("ADMIN_USERNAME");
const hash = readEnv("ADMIN_PASSWORD_HASH");
const secret = readEnv("ADMIN_SESSION_SECRET");

console.log("Admin configuration\n");
console.log(`  ADMIN_USERNAME        ${username ?? "(not set — defaults to 'admin')"}`);
console.log(`  ADMIN_PASSWORD_HASH   ${mask(hash)}`);
console.log(`  ADMIN_SESSION_SECRET  ${mask(secret)}`);
console.log("");

let failures = 0;

const hashProblem = describePasswordHashProblem(hash);
if (hashProblem) {
  failures += 1;
  console.log(`  ✗ ADMIN_PASSWORD_HASH ${hashProblem}`);
} else {
  console.log("  ✓ ADMIN_PASSWORD_HASH is a well-formed bcrypt hash");
}

const secretProblem = describeSessionSecretProblem(secret);
if (secretProblem) {
  failures += 1;
  console.log(`  ✗ ADMIN_SESSION_SECRET ${secretProblem}`);
} else {
  console.log("  ✓ ADMIN_SESSION_SECRET is long enough");
}

if (candidatePassword && hash && !hashProblem) {
  const matches = bcrypt.compareSync(candidatePassword, hash);
  if (matches) {
    console.log("  ✓ the password you passed matches ADMIN_PASSWORD_HASH");
  } else {
    failures += 1;
    console.log("  ✗ the password you passed does NOT match ADMIN_PASSWORD_HASH");
  }
} else if (!candidatePassword) {
  console.log("\n  Tip: pass your password to check it against the hash:");
  console.log("       npm run check:admin -- 'your-password'");
}

if (failures === 0) {
  console.log("\nConfiguration looks correct.");
  console.log("If sign-in still fails on Vercel, redeploy: environment variable");
  console.log("changes do not apply to an already-built deployment.");
} else {
  console.log(`\n${failures} problem(s) found.`);
  process.exitCode = 1;
}
