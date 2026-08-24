import { describe, expect, it } from "vitest";
import { promises as fs } from "fs";
import path from "path";

/**
 * Every public route that changes something must be throttled.
 *
 * The pass-key is the only credential a guest has, so an unthrottled endpoint
 * is somewhere to try codes. The lookup routes were all limited from the
 * start; `manage/cancel` was missed — the most destructive of the set, because
 * a correct guess there does not read a booking, it cancels somebody's dinner.
 * Nothing about it looked different from the outside, which is exactly why a
 * person re-reading the routes would not have caught it either.
 *
 * So it is asserted rather than remembered. A new public POST arrives with
 * this test failing until it is either limited or listed below with a reason.
 *
 * Admin routes are deliberately out of scope: they sit behind `requireStaff`,
 * so there is a session to take away, and sign-in itself *is* limited.
 */

const PUBLIC_API = path.join(process.cwd(), "app", "api");

/** Routes under the public tree that legitimately need no limiter. */
const EXEMPT = new Map<string, string>([
  [
    path.join("menu", "route.ts"),
    "Read-only catalogue, held in a cache in front of the database.",
  ],
  [
    path.join("menu", "images", "[id]", "route.ts"),
    "Read-only bytes, served from the CDN and immutable.",
  ],
  [
    path.join("restaurant", "dates", "route.ts"),
    "Read-only availability, no state and no secret.",
  ],
  [
    path.join("restaurant", "dates", "[date]", "route.ts"),
    "Read-only availability for one evening.",
  ],
  [path.join("restaurant", "tables", "route.ts"), "Read-only room layout."],
  [path.join("premium", "dates", "route.ts"), "Read-only availability."],
]);

async function routeFiles(directory: string): Promise<string[]> {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const found: string[] = [];

  for (const entry of entries) {
    const full = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      found.push(...(await routeFiles(full)));
    } else if (entry.name === "route.ts") {
      found.push(full);
    }
  }

  return found;
}

describe("rate limiting on the routes a stranger can reach", () => {
  it("throttles every public route that writes", async () => {
    const files = await routeFiles(PUBLIC_API);
    const unthrottled: string[] = [];

    for (const file of files) {
      const relative = path.relative(PUBLIC_API, file);

      // Staff routes have a session behind them; sign-in is limited separately.
      if (relative.startsWith(`admin${path.sep}`)) {
        continue;
      }

      if (EXEMPT.has(relative)) {
        continue;
      }

      const source = await fs.readFile(file, "utf8");
      const writes = /export async function (POST|PATCH|PUT|DELETE)/.test(source);

      if (writes && !source.includes("checkRateLimit")) {
        unthrottled.push(relative);
      }
    }

    expect(unthrottled).toEqual([]);
  });

  it("keeps the exemption list honest — every entry still exists and still only reads", async () => {
    for (const [relative, reason] of EXEMPT) {
      const source = await fs.readFile(path.join(PUBLIC_API, relative), "utf8");

      expect(reason.length).toBeGreaterThan(0);
      expect(/export async function (POST|PATCH|PUT|DELETE)/.test(source)).toBe(false);
    }
  });
});
