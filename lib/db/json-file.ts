import { promises as fs } from "fs";
import path from "path";

/**
 * Serialises writes per file so two concurrent requests cannot interleave a
 * read-modify-write cycle and lose one of the updates.
 */
const writeQueues = new Map<string, Promise<unknown>>();

export function getDataFilePath(fileName: string) {
  // Overridable so tests never touch the real data directory. The override is
  // marked ignorable because an unresolvable path makes Turbopack trace the
  // entire project into the server bundle.
  const override = process.env.LOCAL_STORE_DIR;
  if (override) {
    return path.join(/* turbopackIgnore: true */ override, fileName);
  }

  // Statically scoped so the build only traces the data folder.
  return path.join(process.cwd(), "data", fileName);
}

export async function readJsonFile<T>(filePath: string, fallback: T): Promise<T> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    if (!raw.trim()) {
      return fallback;
    }
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/** Writes via a temp file + rename so a crash cannot leave truncated JSON. */
export async function writeJsonFile<T>(filePath: string, data: T): Promise<T> {
  const previous = writeQueues.get(filePath) ?? Promise.resolve();

  const next = previous
    .catch(() => undefined)
    .then(async () => {
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      const tempPath = `${filePath}.${process.pid}.tmp`;
      await fs.writeFile(tempPath, JSON.stringify(data, null, 2), "utf8");
      await fs.rename(tempPath, filePath);
      return data;
    });

  writeQueues.set(filePath, next);

  try {
    return await next;
  } finally {
    if (writeQueues.get(filePath) === next) {
      writeQueues.delete(filePath);
    }
  }
}
