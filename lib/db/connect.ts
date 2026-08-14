import mongoose from "mongoose";

/**
 * Serverless-safe connection handling.
 *
 * On Vercel each request may run in a fresh execution context while the
 * module cache is reused unpredictably. Two things matter:
 *
 * 1. The in-flight connection *promise* is cached on globalThis, not a
 *    boolean set after the fact. Caching a boolean let concurrent
 *    invocations each call mongoose.connect, opening a new connection every
 *    time and eventually exhausting the Atlas connection limit.
 * 2. Failures are thrown rather than swallowed. Returning `false` on error
 *    meant callers carried on and queried a disconnected client, surfacing
 *    as an unrelated timeout instead of "cannot reach the database".
 */

declare global {
  var __mongoosePromise: Promise<typeof mongoose> | undefined;
}

export function getMongoUri() {
  // Trimmed because a pasted connection string often carries a stray newline.
  return process.env.MONGODB_URI?.trim() || undefined;
}

export function isMongoConfigured() {
  return Boolean(getMongoUri());
}

export async function connectToDatabase() {
  const uri = getMongoUri();

  if (!uri) {
    throw new Error("MONGODB_URI is not configured.");
  }

  // 1 = connected. Reuse the live connection.
  if (mongoose.connection.readyState === 1) {
    return mongoose;
  }

  if (!globalThis.__mongoosePromise) {
    globalThis.__mongoosePromise = mongoose
      .connect(uri, {
        // Fail fast instead of queueing queries against a dead connection.
        bufferCommands: false,
        serverSelectionTimeoutMS: 10_000,
        maxPoolSize: 10,
      })
      .catch((error) => {
        // Clear the cache so the next request retries rather than reusing a
        // permanently rejected promise.
        globalThis.__mongoosePromise = undefined;
        throw error;
      });
  }

  return globalThis.__mongoosePromise;
}
