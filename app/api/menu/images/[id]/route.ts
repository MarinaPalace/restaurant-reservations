import { NextResponse } from "next/server";
import { findMenuImage } from "@/lib/services/restaurant";

/**
 * Serves an uploaded dish photo. The menu response points here instead of
 * inlining base64, so the picture can be cached on its own.
 *
 * The URL carries a hash of the image, so a replaced photo is a different URL
 * and nothing here ever has to be revalidated or purged. That makes every
 * cache below safe to set to a year.
 *
 * `s-maxage` is the one that matters. Almost every guest opens this app once
 * and never returns, so `max-age` — the browser's cache — is the cache that
 * can never help them: they have no previous visit to have filled it. What
 * does help is that all of them are asking for the *same* thirty photographs.
 * One fill of the shared CDN cache serves every guest after it.
 *
 * Vercel only caches a function response on its CDN when the header carries
 * `s-maxage` (or a targeted `CDN-Cache-Control`); `max-age` alone is passed
 * to the browser and nothing else. Without it every guest cost us one function
 * invocation and one database read per photo, for bytes that had not changed
 * in weeks.
 */
const IMMUTABLE_YEAR = "public, max-age=31536000, s-maxage=31536000, immutable";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const image = await findMenuImage(id);

    if (!image) {
      return new NextResponse("Not found", { status: 404 });
    }

    return new NextResponse(new Uint8Array(image.body), {
      headers: {
        "Content-Type": image.contentType,
        "Content-Length": String(image.body.byteLength),
        "Cache-Control": IMMUTABLE_YEAR,
        // Stated separately so the CDN keeps the photo for a year even if the
        // browser directive above is ever shortened.
        "CDN-Cache-Control": IMMUTABLE_YEAR,
      },
    });
  } catch (error) {
    console.error("[menu] failed to serve image", error);
    // Deliberately uncached: a photo that failed to load must be retried on
    // the next request rather than pinned at the edge for a year.
    return new NextResponse("Unable to load image", {
      status: 500,
      headers: { "Cache-Control": "no-store" },
    });
  }
}
