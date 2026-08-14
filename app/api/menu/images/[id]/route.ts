import { NextResponse } from "next/server";
import { findMenuImage } from "@/lib/services/restaurant";

/**
 * Serves an uploaded dish photo. The menu response points here instead of
 * inlining base64, so browsers cache the picture across page loads.
 */
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
        // Safe to cache hard: the URL carries a hash of the image, so
        // replacing the photo produces a different URL.
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch (error) {
    console.error("[menu] failed to serve image", error);
    return new NextResponse("Unable to load image", { status: 500 });
  }
}
