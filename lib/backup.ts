import type { Db } from "mongodb";

/**
 * Taking a copy of the database, and putting one back.
 *
 * Written as a library with the file handling left to the scripts, for one
 * reason: a backup nobody has ever restored is not a backup, and the only way
 * to know this one works is to run the round trip in a test. `scripts/` cannot
 * be tested — it reads `process.argv` and calls `process.exit` — so the part
 * worth trusting lives here and `lib/backup.mongo.test.ts` drives it against a
 * real server.
 *
 * **Documents are serialised as Extended JSON, never plain JSON.** An `_id` is
 * an ObjectId and a `createdAt` is a Date; plain `JSON.stringify` turns both
 * into strings, and a restore from that produces a database that looks right,
 * loads in the app, and fails every query that matches on an id. That failure
 * arrives on the day you are restoring from backup, which is the worst day to
 * find it.
 */

/** Bumped only if the on-disk shape changes in a way a reader must know about. */
export const BACKUP_FORMAT = 1;

export type BackupManifest = {
  format: number;
  takenAt: string;
  database: string;
  collections: { name: string; count: number }[];
};

export type DatabaseDump = {
  manifest: BackupManifest;
  /** Collection name → its documents, as they came out. */
  documents: Record<string, unknown[]>;
};

/**
 * Everything, including collections this codebase does not know about.
 *
 * Deliberately not driven from the Mongoose models: a backup that only copies
 * what the current code remembers will quietly drop a collection left behind by
 * an older version, and a restore would then present that loss as a success.
 */
export async function dumpDatabase(db: Db): Promise<DatabaseDump> {
  const collections = await db.listCollections().toArray();
  const documents: Record<string, unknown[]> = {};
  const counted: { name: string; count: number }[] = [];

  // Sorted so two backups of the same data produce the same file.
  for (const collection of [...collections].sort((a, b) => a.name.localeCompare(b.name))) {
    const name = collection.name;

    // A view has no documents of its own; copying one would invent them.
    if (collection.type === "view") {
      continue;
    }

    const rows = await db.collection(name).find({}).toArray();
    documents[name] = rows;
    counted.push({ name, count: rows.length });
  }

  return {
    manifest: {
      format: BACKUP_FORMAT,
      takenAt: new Date().toISOString(),
      database: db.databaseName,
      collections: counted,
    },
    documents,
  };
}

export class RestoreRefused extends Error {}

export type RestoreOptions = {
  /**
   * `refuse-if-populated` — the default and the one to use in anger. A restore
   * into a database that already holds data is almost always somebody pointing
   * at the wrong environment, and the cost of being wrong is the live data.
   *
   * `replace` — drop each collection in the backup, then write it. Only this
   * ever destroys anything, and only what the backup is about to replace: a
   * collection the backup does not mention is left alone rather than tidied
   * away, because a backup is not a statement about what should not exist.
   */
  mode?: "refuse-if-populated" | "replace";
};

export type RestoreSummary = { collection: string; inserted: number }[];

export async function restoreDatabase(
  db: Db,
  dump: DatabaseDump,
  { mode = "refuse-if-populated" }: RestoreOptions = {},
): Promise<RestoreSummary> {
  if (dump.manifest.format !== BACKUP_FORMAT) {
    throw new RestoreRefused(
      `This backup is format ${dump.manifest.format}; this build reads format ${BACKUP_FORMAT}.`,
    );
  }

  if (mode === "refuse-if-populated") {
    const existing = await db.listCollections().toArray();

    for (const collection of existing) {
      if ((await db.collection(collection.name).countDocuments({}, { limit: 1 })) > 0) {
        throw new RestoreRefused(
          `${db.databaseName} already holds data (${collection.name}). ` +
            "Restore into an empty database, or pass --replace if you mean to overwrite this one.",
        );
      }
    }
  }

  const summary: RestoreSummary = [];

  for (const [name, rows] of Object.entries(dump.documents)) {
    if (mode === "replace") {
      // `deleteMany` rather than `drop`, so a collection that does not exist
      // yet is not an error and indexes defined elsewhere survive.
      await db.collection(name).deleteMany({});
    }

    if (rows.length > 0) {
      await db.collection(name).insertMany(rows as Record<string, unknown>[], { ordered: false });
    }

    summary.push({ collection: name, inserted: rows.length });
  }

  return summary;
}

/** What the backup says it holds, for a human about to trust it. */
export function describeManifest(manifest: BackupManifest): string {
  const total = manifest.collections.reduce((sum, entry) => sum + entry.count, 0);
  const lines = manifest.collections.map((entry) => `    ${entry.name}: ${entry.count}`);

  return [
    `  database:  ${manifest.database}`,
    `  taken at:  ${manifest.takenAt}`,
    `  documents: ${total}`,
    ...lines,
  ].join("\n");
}
