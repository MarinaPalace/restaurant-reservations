import { setTimeout as delay } from "timers/promises";

/**
 * What a guest actually waits for, measured against a real deployment.
 *
 *   npm run measure:images -- https://your-app.vercel.app/booking/menu
 *   npm run measure:images -- https://your-app.vercel.app/booking/menu --passes 3
 *
 * Written after a cache change was judged by the wrong number. The hit rate on
 * `/api/menu/images` looked like it had collapsed — but since dish photos began
 * going through `next/image`, browsers do not request that route at all. Only
 * the optimiser does, to fetch a master. The route's hit rate had stopped
 * describing anything a guest experiences.
 *
 * So this measures the thing itself: fetch the page a guest opens, find every
 * image the page actually references, request them the way a browser would, and
 * report bytes, time and cache status per URL.
 *
 * **Two passes by default, and the second is the one to read.** Almost every
 * guest here is a first-time visitor, so their browser cache is always empty —
 * what carries them is the *shared* CDN cache, already warmed by whoever came
 * before. Pass one warms it; pass two is what an ordinary guest gets.
 */

type Measurement = {
  url: string;
  status: number;
  bytes: number;
  ms: number;
  cache: string;
  type: string;
};

function argument(name: string, fallback?: string) {
  const index = process.argv.indexOf(`--${name}`);
  return index !== -1 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

/**
 * Every image the page points at.
 *
 * Read out of the HTML rather than by driving a browser, so this needs nothing
 * installed. `srcset` matters as much as `src`: a responsive image is a *set*
 * of URLs, and the whole question here is how many of them there are.
 */
function imageUrlsFrom(html: string, origin: string): string[] {
  const found = new Set<string>();

  for (const match of html.matchAll(/(?:src|srcSet|srcset)=\\?"([^"]+)\\?"/g)) {
    for (const candidate of match[1].split(",")) {
      // A srcset entry is "url 640w"; the descriptor is not part of the URL.
      const [raw] = candidate.trim().split(/\s+/);

      if (!raw) continue;

      const cleaned = raw.replace(/&amp;/g, "&");

      if (cleaned.includes("/_next/image") || cleaned.includes("/api/menu/images")) {
        found.add(new URL(cleaned, origin).toString());
      }
    }
  }

  return [...found];
}

async function measure(url: string, accept: string): Promise<Measurement> {
  const started = Date.now();
  const response = await fetch(url, { headers: { Accept: accept }, cache: "no-store" });
  const body = await response.arrayBuffer();

  return {
    url,
    status: response.status,
    bytes: body.byteLength,
    ms: Date.now() - started,
    // Vercel reports HIT, MISS, STALE, PRERENDER or BYPASS here.
    cache: response.headers.get("x-vercel-cache") ?? "(none)",
    type: response.headers.get("content-type") ?? "(none)",
  };
}

function kb(bytes: number) {
  return `${(bytes / 1024).toFixed(0)} KB`;
}

function report(pass: number, results: Measurement[]) {
  const total = results.reduce((sum, entry) => sum + entry.bytes, 0);
  const slowest = [...results].sort((a, b) => b.ms - a.ms).slice(0, 5);

  const byCache = new Map<string, number>();
  const byType = new Map<string, number>();

  for (const entry of results) {
    byCache.set(entry.cache, (byCache.get(entry.cache) ?? 0) + 1);
    byType.set(entry.type, (byType.get(entry.type) ?? 0) + 1);
  }

  const hits = results.filter((entry) => entry.cache === "HIT").length;

  console.log(`\n──── pass ${pass} ────`);
  console.log(`  images:      ${results.length}`);
  console.log(`  total bytes: ${kb(total)}`);
  console.log(`  cache:       ${[...byCache].map(([k, v]) => `${k} ${v}`).join(", ")}`);
  console.log(
    `  hit rate:    ${results.length ? Math.round((hits / results.length) * 100) : 0}%`,
  );
  console.log(`  formats:     ${[...byType].map(([k, v]) => `${k} ${v}`).join(", ")}`);
  console.log(`  slowest:`);

  for (const entry of slowest) {
    console.log(`    ${String(entry.ms).padStart(6)}ms  ${entry.cache.padEnd(6)} ${kb(entry.bytes).padStart(8)}  ${entry.url.slice(0, 96)}`);
  }
}

async function main() {
  const page = process.argv[2];

  if (!page || page.startsWith("--")) {
    console.error("Which page? e.g. npm run measure:images -- https://example.com/booking/menu");
    process.exit(1);
  }

  const passes = Math.max(1, Number(argument("passes", "2")));
  const origin = new URL(page).origin;

  /*
   * What a modern browser sends. The optimiser answers on this header, so
   * asking without it measures a format no guest is served.
   */
  const accept = "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8";

  console.log(`Measuring ${page}`);

  const pageStarted = Date.now();
  const response = await fetch(page, { cache: "no-store" });
  const html = await response.text();
  const pageMs = Date.now() - pageStarted;

  console.log(`  page: ${response.status} in ${pageMs}ms, ${kb(html.length)} of HTML`);
  console.log(`  page cache: ${response.headers.get("x-vercel-cache") ?? "(none)"}`);

  const urls = imageUrlsFrom(html, origin);

  if (urls.length === 0) {
    console.log("\nNo image URLs found in the HTML.");
    console.log("If the menu renders its photos on the client, this cannot see them —");
    console.log("read the Network tab instead, filtered to Img.");
    process.exit(0);
  }

  /**
   * The distinction that matters, and the one the earlier reading got wrong.
   *
   * A responsive image is a *set* of URLs and the browser picks one, so the
   * number of URLs is not what a guest downloads. It is the **cache-key
   * surface**: how many separate objects the CDN has to hold and keep warm for
   * this page. Split the same traffic across more keys and each is requested
   * more rarely — which is when a regional cache starts evicting them.
   *
   * Photos is what a guest sees. Keys is what the cache has to carry.
   */
  const sources = new Set(
    urls.map((url) => new URL(url).searchParams.get("url") ?? url),
  );

  const optimised = urls.filter((url) => url.includes("/_next/image")).length;
  const perPhoto = sources.size ? (urls.length / sources.size).toFixed(1) : "0";

  console.log(`  photos:      ${sources.size}`);
  console.log(`  cache keys:  ${urls.length} (${perPhoto} per photo, ${optimised} via the optimiser)`);
  console.log("");
  console.log("  A browser fetches roughly one key per photo. Every key still has to be held");
  console.log("  and kept warm by the CDN, and a rarely-requested one gets evicted.");

  for (let pass = 1; pass <= passes; pass += 1) {
    const results: Measurement[] = [];

    for (const url of urls) {
      results.push(await measure(url, accept));
    }

    report(pass, results);

    if (pass < passes) {
      await delay(1000);
    }
  }

  console.log("\n  Read the last pass: it is the one with a warmed shared cache,");
  console.log("  which is what a first-time guest actually gets.");
  console.log("");
  console.log("  Every key here was requested moments ago. In production they compete with");
  console.log("  eviction, so a low hit rate on the last pass understates the problem rather");
  console.log("  than overstating it.");
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
