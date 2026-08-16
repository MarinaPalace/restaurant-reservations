import QRCode from "qrcode";

/**
 * QR codes, drawn on the server and inlined as data URIs.
 *
 * Three earlier attempts at this failed in ways worth recording, because each
 * looked correct:
 *
 * 1. Generated in the browser inside an effect, with the failure caught and
 *    swallowed — so a card printed a blank square and said nothing.
 * 2. Fetched from a guarded API route as an `<img src>`. The route worked, but
 *    the SVG it returned carried only a `viewBox` and no `width`/`height`, so
 *    the image had no intrinsic size and collapsed to nothing as a flex item.
 * 3. Both of the above still depended on a request succeeding at the moment
 *    the card was printed.
 *
 * So: the bytes are produced here, on the server, with explicit dimensions,
 * and handed to the card already encoded. There is no request to fail, nothing
 * to load before printing, and no authentication in the path of an image.
 */

/** Big enough that a phone camera reads it after being scaled down to ~18mm. */
const PIXEL_SIZE = 320;

export async function qrDataUri(value: string): Promise<string | null> {
  if (!value) {
    return null;
  }

  try {
    const svg = await QRCode.toString(value, {
      type: "svg",
      margin: 0,
      // `width` is what makes the SVG carry width and height attributes rather
      // than a bare viewBox. Without it the image has no intrinsic size.
      width: PIXEL_SIZE,
      /**
       * M recovers roughly 15% of the code — what a fold or a coffee ring
       * across a card in a pocket costs. H is sturdier but packs more modules
       * into the same few millimetres, and past a point the camera is the
       * limit rather than the redundancy.
       */
      errorCorrectionLevel: "M",
      color: { dark: "#14343d", light: "#ffffff" },
    });

    // base64 rather than percent-encoding: an SVG is full of characters that
    // would need escaping in a data URI, and this cannot be got subtly wrong.
    return `data:image/svg+xml;base64,${Buffer.from(svg, "utf8").toString("base64")}`;
  } catch (error) {
    // A card without a QR is still perfectly usable — the code is printed
    // beside it — so this must never take the page down with it.
    console.error("[qr] failed to draw a code", error);
    return null;
  }
}

/** Draws several at once, keyed however the caller wants to look them up. */
export async function qrDataUris(entries: { id: string; value: string }[]) {
  const codes = await Promise.all(entries.map((entry) => qrDataUri(entry.value)));

  return Object.fromEntries(
    entries.map((entry, index) => [entry.id, codes[index]]).filter(([, code]) => code !== null),
  ) as Record<string, string>;
}
