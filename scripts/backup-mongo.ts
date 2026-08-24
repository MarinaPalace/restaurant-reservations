import { promises as fs } from "fs";
import path from "path";
import { EJSON } from "bson";
import mongoose from "mongoose";
import { connectToDatabase, isMongoConfigured } from "@/lib/db/connect";
import { describeManifest, dumpDatabase } from "@/lib/backup";

/**
 * Takes a copy of the database.
 *
 *   npm run backup                     # into ./backups/<timestamp>
 *   npm run backup -- --out somewhere
 *
 * Run it with the deployment's environment (for Vercel: `vercel env pull
 * .env.local` first), because it copies whatever `MONGODB_URI` points at.
 *
 * **What comes out is readable and unencrypted**, and it contains guest names,
 * room numbers and contact details. It belongs somewhere you would be willing
 * to keep the reservation book itself, and nowhere else. `backups/` is
 * git-ignored so it cannot be committed by a wide `git add`.
 *
 * One file per collection, plus a manifest. Documents are written as canonical
 * Extended JSON, which is what keeps an `_id` an ObjectId and a `createdAt` a
 * Date; the manifest is plain JSON, because canonical mode would turn
 * `format: 1` into `{ "$numberInt": "1" }` and the restore's version check
 * would then refuse every backup ever taken.
 */

function outputDirectory(): string {
  const flag = process.argv.indexOf("--out");

  if (flag !== -1 && process.argv[flag + 1]) {
    return path.resolve(process.argv[flag + 1]);
  }

  // Colons are not legal in a Windows path, and this is written on one.
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return path.resolve("backups", stamp);
}

async function main() {
  if (!isMongoConfigured()) {
    console.error("MONGODB_URI is not set — there is nothing to back up.");
    process.exit(1);
  }

  await connectToDatabase();

  const db = mongoose.connection.db;
  if (!db) {
    console.error("Connected, but no database was selected by the connection string.");
    process.exit(1);
  }

  const directory = outputDirectory();
  await fs.mkdir(directory, { recursive: true });

  const dump = await dumpDatabase(db);

  for (const [name, rows] of Object.entries(dump.documents)) {
    await fs.writeFile(
      path.join(directory, `${name}.json`),
      EJSON.stringify(rows, { relaxed: false }),
      "utf8",
    );
  }

  await fs.writeFile(
    path.join(directory, "manifest.json"),
    JSON.stringify(dump.manifest, null, 2),
    "utf8",
  );

  console.log(`Backed up to ${directory}\n`);
  console.log(describeManifest(dump.manifest));
  console.log("");
  console.log("  Unencrypted, and it holds guest names and contact details.");
  console.log("  Keep it where you would keep the reservation book.");

  await mongoose.disconnect();
  process.exit(0);
}

main().catch(async (error) => {
  console.error(error);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
