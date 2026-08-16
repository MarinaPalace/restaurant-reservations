import QRCode from "qrcode";
import { NextResponse } from "next/server";
import { isDenied, requireStaff } from "@/lib/auth/guard";

/**
 * A QR code as an SVG, drawn on the server.
 *
 * It is generated here rather than in the browser for two reasons. The Node
 * build of `qrcode` is the one that is certain to work — the browser build has
 * to survive bundling, and when it does not the card simply prints with an
 * empty white square, which is exactly the sort of failure nobody notices
 * until a guest cannot scan it. And an `<img>` the browser has already loaded
 * prints far more reliably than markup injected after hydration.
 *
 * Nothing leaves the building: the SVG is produced locally, so a front desk
 * with no internet still prints working cards.
 */
export async function GET(request: Request) {
  const auth = await requireStaff("passkeys:issue");
  if (isDenied(auth)) {
    return auth;
  }

  const value = new URL(request.url).searchParams.get("data");

  if (!value || value.length > 512) {
    return NextResponse.json({ error: "Nothing to encode." }, { status: 400 });
  }

  try {
    const svg = await QRCode.toString(value, {
      type: "svg",
      margin: 0,
      /**
       * M recovers roughly 15% of the code, which is what a fold or a coffee
       * ring across a card in a pocket costs. H would be sturdier but packs
       * more modules into the same 20mm, and past a point the camera is the
       * limit rather than the redundancy.
       */
      errorCorrectionLevel: "M",
      color: { dark: "#14343d", light: "#ffffff" },
    });

    return new NextResponse(svg, {
      headers: {
        "Content-Type": "image/svg+xml",
        // The code for a given key never changes, so it may be cached hard.
        "Cache-Control": "private, max-age=31536000, immutable",
      },
    });
  } catch (error) {
    console.error("[admin] failed to draw a QR code", error);
    return NextResponse.json({ error: "Unable to draw a QR code." }, { status: 500 });
  }
}
