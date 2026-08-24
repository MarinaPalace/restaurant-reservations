/**
 * What the server says when something goes wrong, in a shape a machine can
 * group.
 *
 * There is no error-tracking vendor here on purpose: Vercel already captures
 * everything written to stdout and stderr, and its log view can filter on the
 * fields of a JSON line. So a line is emitted as JSON rather than as prose,
 * and the cost of that is one function.
 *
 * `console.error("[admin] failed to cancel reservation", error)` is greppable
 * and nothing more. The same failure written here can be filtered to one
 * `scope`, counted by `event`, and read with the reservation number beside it —
 * which is the difference between "there are errors" and "cancellations are
 * failing for one room since Tuesday".
 *
 * **Nothing here may throw.** It is called from `catch` blocks and from the
 * error hook itself; a reporter that fails while reporting turns a handled
 * error into an unhandled one.
 */

/**
 * Field names whose values never appear in a log.
 *
 * The pass-key is the whole of a guest's authorisation — a key in a log line
 * is a key in every downstream system that log reaches, held by whoever can
 * read them. Matched loosely, because the day somebody adds `guestPassKey` is
 * the day an exact list stops working.
 */
const SECRET_FIELDS = /pass[_-]?key|password|secret|token|authorization|cookie|session/i;

const REDACTED = "[redacted]";

function redact(value: unknown, depth = 0): unknown {
  if (depth > 4 || value === null || typeof value !== "object") {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((entry) => redact(entry, depth + 1));
  }

  const out: Record<string, unknown> = {};

  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    out[key] = SECRET_FIELDS.test(key) ? REDACTED : redact(entry, depth + 1);
  }

  return out;
}

function describeError(error: unknown) {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
      // Next tags render errors with a digest; it is the only way to tie a
      // reported error back to the one the browser was shown.
      ...(typeof (error as unknown as { digest?: unknown }).digest === "string"
        ? { digest: (error as unknown as { digest: string }).digest }
        : {}),
    };
  }

  return { name: "NonError", message: String(error) };
}

export type ErrorReport = {
  /** The part of the app that failed: `admin`, `booking`, `menu`, `auth`. */
  scope: string;
  /**
   * What failed, as a stable slug rather than a sentence — this is what gets
   * counted and alerted on, so it must not change when the wording does.
   */
  event: string;
  error: unknown;
  /** Anything that helps identify the failure. Secrets are stripped. */
  context?: Record<string, unknown>;
};

/**
 * One JSON line per failure, on stderr.
 *
 * Written with `console.error` rather than a transport, because on Vercel that
 * *is* the transport, and a line already on stderr cannot be lost by a
 * reporting client that failed to flush before the function froze.
 */
export function reportError({ scope, event, error, context }: ErrorReport): void {
  try {
    console.error(
      JSON.stringify({
        level: "error",
        at: new Date().toISOString(),
        scope,
        event,
        ...describeError(error),
        ...(context ? { context: redact(context) as Record<string, unknown> } : {}),
      }),
    );
  } catch {
    // Serialising failed — a circular context, most likely. Say so plainly
    // rather than losing the failure that was being reported.
    console.error(`[${scope}] ${event} (context could not be serialised)`);
  }
}
