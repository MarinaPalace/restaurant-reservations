import type { Instrumentation } from "next";
import { reportError } from "@/lib/observability";

/**
 * Every server error Next catches, reported in one place.
 *
 * This is the gap the route handlers do not cover. They each wrap their work in
 * `try`/`catch`, log, and answer 500 — so anything they catch is accounted for.
 * Anything they *do not* is what lands here: an error thrown while rendering a
 * server component, a failure in a page rather than a route, a bug in the
 * middleware, a crash between the handler returning and the response being
 * sent. Until now none of that was recorded anywhere but Vercel's raw log.
 *
 * The error React hands over is not always the one that was thrown — a render
 * error is processed on its way here — which is why `digest` is reported. It is
 * the only thing tying a line in the log to the reference the guest was shown
 * on screen.
 */
export const onRequestError: Instrumentation.onRequestError = (error, request, context) => {
  reportError({
    scope: "server",
    // Grouped by the route file rather than the URL, so one broken page is one
    // line in the log however many rooms visited it.
    event: `unhandled:${context.routeType}:${context.routePath || request.path}`,
    error,
    context: {
      path: request.path,
      method: request.method,
      routerKind: context.routerKind,
      routeType: context.routeType,
      routePath: context.routePath,
      revalidateReason: context.revalidateReason,
    },
  });
};
