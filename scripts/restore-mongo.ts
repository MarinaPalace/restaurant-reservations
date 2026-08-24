import { promises as fs } from "fs";
import path from "path";
import { EJSON } from "bson";
import mongoose from "mongoose";
import { connectToDatabase, getMongoUri, isMongoConfigured } from "@/lib/db/connect";
import { describeManifest, restoreDatabase, RestoreRefused, type DatabaseDump } from "@/lib/backup";

/**
 * Puts a backup back.
 *
 *   npm run restore -- ./backups/2026-08-24T19-00-00-000Z
 *   npm run restore -- ./backups/<stamp> --replace
 *
 * `MONGODB_URI` decides where it lands, so **check it before running this**;
 * the script prints the database it is about to write to and refuses by default
 * if anything is already there. That refusal is the whole safety design: the
 * expensive mistake is not a bad backup, it is a good backup restored over the
 * live one. `--replace` is how you say you meant it.
 *
 * The restore drill — taking a real backup and putting it into a scratch
 * database — is a thing to *do*, not a thing to have written. `docs/backup.md`
 * has the steps.
 */

function backupDirectory(): string {
  const given = process.argv[2];

  if (!given || given.startsWith("--")) {
    console.error("Which backup? e.g. npm run restore -- ./backups/2026-08-24T19-00-00-000Z");
    process.exit(1);
  }

  return path.resolve(given);
}

async function readDump(directory: string): Promise<DatabaseDump> {
  const manifest = JSON.parse(await fs.readFile(path.join(directory, "manifest.json"), "utf8"));
  const documents: Record<string, unknown[]> = {};

  for (const entry of manifest.collections as { name: string }[]) {
    const raw = await fs.readFile(path.join(directory, `${entry.name}.json`), "utf8");
    documents[entry.name] = EJSON.parse(raw, { relaxed: false }) as unknown[];
  }

  return { manifest, documents };
}

async function main() {
  if (!isMongoConfigured()) {
    console.error("MONGODB_URI is not set — there is nowhere to restore to.");
    process.exit(1);
  }

  const directory = backupDirectory();
  const replace = process.argv.includes("--replace");
  const dump = await readDump(directory);

  console.log(`Restoring ${directory}\n`);
  console.log(describeManifest(dump.manifest));
  console.log("");

  // The host, never the credentials in front of it.
  const target = getMongoUri()?.replace(/\/\/[^@]*@/, "//***@");
  console.log(`  into: ${target}`);
  console.log(`  mode: ${replace ? "REPLACE — existing documents will be deleted" : "only if empty"}`);
  console.log("");

  await connectToDatabase();

  const db = mongoose.connection.db;
  if (!db) {
    console.error("Connected, but no database was selected by the connection string.");
    process.exit(1);
  }

  try {
    const summary = await restoreDatabase(db, dump, {
      mode: replace ? "replace" : "refuse-if-populated",
    });

    for (const line of summary) {
      console.log(`  ✓ ${line.collection}: ${line.inserted}`);
    }

    console.log("\nRestored.");
  } catch (error) {
    if (error instanceof RestoreRefused) {
      console.error(`\nRefused: ${error.message}`);
      await mongoose.disconnect();
      process.exit(1);
    }

    throw error;
  }

  await mongoose.disconnect();
  process.exit(0);
}

main().catch(async (error) => {
  console.error(error);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
