/**
 * A small in-memory rate limiter.
 *
 * It exists because the pass-key is now the only thing standing between a
 * stranger and a table: fifty bits is far too large to guess, but nothing
 * should be free to try a thousand codes a second.
 *
 * **Its limits are deliberate and worth knowing.** The counters live in this
 * process, so on serverless each instance keeps its own and the effective
 * limit is the configured one times the number of warm instances. That is
 * fine for what this defends against — a script hammering one endpoint — and
 * not fine as a defence against a distributed attacker. If that ever matters,
 * move the counters to Redis or put the limit in front of the app; the call
 * sites do not change.
 */

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

/** Stops the map growing without bound on a long-lived server. */
const MAX_TRACKED_KEYS = 10_000;

export type RateLimitResult = {
  allowed: boolean;
  /** Seconds until the window resets. For the Retry-After header. */
  retryAfterSeconds: number;
  remaining: number;
};

export function checkRateLimit(
  key: string,
  options: { limit: number; windowMs: number },
  now = Date.now(),
): RateLimitResult {
  const existing = buckets.get(key);

  if (!existing || existing.resetAt <= now) {
    if (buckets.size >= MAX_TRACKED_KEYS) {
      // Cheapest possible eviction: drop everything already expired, and if
      // that frees nothing, start again. Precision here is not worth a heap.
      for (const [entry, bucket] of buckets) {
        if (bucket.resetAt <= now) {
          buckets.delete(entry);
        }
      }
      if (buckets.size >= MAX_TRACKED_KEYS) {
        buckets.clear();
      }
    }

    buckets.set(key, { count: 1, resetAt: now + options.windowMs });
    return { allowed: true, retryAfterSeconds: 0, remaining: options.limit - 1 };
  }

  existing.count += 1;

  if (existing.count > options.limit) {
    return {
      allowed: false,
      retryAfterSeconds: Math.max(Math.ceil((existing.resetAt - now) / 1000), 1),
      remaining: 0,
    };
  }

  return { allowed: true, retryAfterSeconds: 0, remaining: options.limit - existing.count };
}

/**
 * Who to count against. Behind Vercel the client address is in
 * `x-forwarded-for`; the first entry is the original client, the rest are
 * proxies. Falls back to a single shared bucket rather than to no limit at
 * all — if the address cannot be read, everyone shares one, which throttles
 * rather than exempts.
 */
export function clientKeyFrom(request: Request, scope: string) {
  const forwarded = request.headers.get("x-forwarded-for");
  const address = forwarded?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown";
  return `${scope}:${address}`;
}

/** Clears every counter. Tests only. */
export function resetRateLimits() {
  buckets.clear();
}
