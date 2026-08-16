import { formatPassKey } from "@/lib/pass-key";
import { formatShortDate } from "@/lib/date";
import type { PassKeyRecord } from "@/types/booking";

/**
 * A pass-key as a card the guest keeps in a wallet.
 *
 * Sized to a real credit card (85.6 × 53.98 mm) so it fits where guests
 * already put their room key, and laid out as an invitation rather than a
 * receipt — this is how the restaurant introduces itself.
 *
 * The dimensions are in millimetres deliberately: this is designed for paper,
 * and the on-screen preview is the approximate one, not the print.
 *
 * **The QR is anchored to a corner, and that is not a stylistic choice.** It
 * used to sit in a flex row beside the text. Flex items default to
 * `min-width: auto`, so the pass-key — fifteen monospace characters — refused
 * to shrink below its own width and pushed the QR column past the edge of a
 * card that is a fixed size with `overflow: hidden`. The code was in the DOM
 * and painted outside the card, which is a hard fault to see: the element
 * inspector shows it perfectly. Positioned absolutely it cannot be displaced,
 * whatever the text alongside it does.
 *
 * Colours are literal rather than theme tokens. A card is printed and handed
 * over, so it must look the same whatever theme the person at the desk happens
 * to be using, and it must not turn white-on-white in a light palette.
 */

/** Ivory card stock, deep teal ink, gold rule. */
const INK = "#14343d";
const INK_SOFT = "#4a6670";
const GOLD = "#a8842c";

/**
 * The corner the code lives in, and the room the text leaves clear for it.
 *
 * 18mm is not arbitrary. A 33-module code at that width prints each module
 * around half a millimetre, which is about the floor for a phone camera
 * reading it off paper at arm's length. Smaller looks tidier and scans worse.
 */
const QR_BLOCK_WIDTH = "18mm";
const TEXT_INSET = "24mm";

export function PassKeyCard({
  passKey,
  bookingUrl,
  qrDataUri,
  restaurantName,
}: {
  passKey: PassKeyRecord;
  /** The address printed on the card, and what the QR encodes. */
  bookingUrl: string;
  /**
   * The QR code, already drawn on the server and inlined. Passed in rather
   * than fetched: there is then no request to fail while a card is printing,
   * and no authentication in the path of an image. `null` only if drawing it
   * failed, in which case the card still works — the code is printed beside
   * it — so the square is simply left empty.
   */
  qrDataUri: string | null;
  restaurantName: string;
}) {
  const dinners = passKey.maxUses > 1 ? `${passKey.maxUses} dinners` : "One dinner";
  const isInvitation = passKey.kind === "premium";

  return (
    <article
      data-pass-key-card=""
      data-card-kind={isInvitation ? "invitation" : "in-house"}
      className="relative overflow-hidden rounded-[3mm]"
      style={{ width: "85.6mm", height: "53.98mm", backgroundColor: "#fbf7ef", color: INK }}
    >
      {/* A soft wash of house colour, warmer for an invitation than a room key. */}
      <div
        aria-hidden="true"
        data-card-wash=""
        className="pointer-events-none absolute inset-0"
        style={{
          background: isInvitation
            ? "linear-gradient(135deg, #f6e7c8 0%, #fbf7ef 46%, #fdfaf4 100%)"
            : "linear-gradient(135deg, #dbeae9 0%, #fbf7ef 46%, #fdfaf4 100%)",
        }}
      />

      {/* A hairline rule inset from the edge, the way a menu card is ruled. */}
      <div
        aria-hidden="true"
        data-card-rule=""
        className="pointer-events-none absolute inset-[2mm] rounded-[2mm]"
        style={{ border: `0.25mm solid ${GOLD}80` }}
      />

      {/* Top right, anchored to the card itself so nothing can displace it. */}
      <div className="absolute" style={{ top: "3.6mm", right: "3.6mm", width: QR_BLOCK_WIDTH }}>
        <span
          className="block rounded-[1mm]"
          style={{ backgroundColor: "#ffffff", border: `0.2mm solid ${GOLD}55`, padding: "0.7mm" }}
        >
          {qrDataUri ? (
            // Square by ratio rather than by a height that depends on a flex
            // parent — that is how it collapsed to nothing once already.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={qrDataUri}
              alt=""
              style={{ display: "block", width: "100%", height: "auto", aspectRatio: "1 / 1" }}
            />
          ) : (
            <span style={{ display: "block", width: "100%", aspectRatio: "1 / 1" }} />
          )}
        </span>
        <p
          className="text-center uppercase"
          style={{ fontSize: "1.7mm", letterSpacing: "0.12em", marginTop: "0.7mm", color: GOLD }}
        >
          Scan to book
        </p>
      </div>

      <div className="relative flex flex-col justify-between" style={{ height: "100%", padding: "4.5mm" }}>
        {/*
          The header and the code stop short of the corner; the footer runs the
          full width, because the QR block ends well above it.
        */}
        <header style={{ paddingRight: TEXT_INSET }}>
          <p className="display leading-none" style={{ fontSize: "4mm", color: INK }}>
            {restaurantName}
          </p>
          <p
            className="uppercase"
            style={{ fontSize: "2.1mm", letterSpacing: "0.2em", marginTop: "0.8mm", color: GOLD }}
          >
            {isInvitation ? "An invitation" : "Dinner is included"}
          </p>
        </header>

        <div style={{ paddingRight: TEXT_INSET }}>
          <p className="uppercase" style={{ fontSize: "2.2mm", letterSpacing: "0.16em", color: INK_SOFT }}>
            Your pass-key
          </p>
          <p
            className="font-mono font-bold leading-none"
            style={{
              fontSize: "5mm",
              letterSpacing: "0.04em",
              marginTop: "0.6mm",
              color: INK,
              whiteSpace: "nowrap",
            }}
          >
            {formatPassKey(passKey.code)}
          </p>
        </div>

        <footer style={{ fontSize: "2.2mm", lineHeight: 1.25, color: INK_SOFT }}>
          <p className="truncate font-semibold" style={{ color: INK }}>
            {bookingUrl}
          </p>
          <p className="truncate" style={{ marginTop: "0.4mm" }}>
            {dinners}
            {passKey.maxGuests ? ` · up to ${passKey.maxGuests} at table` : ""}
            {passKey.expiresOn ? ` · until ${formatShortDate(passKey.expiresOn)}` : ""}
          </p>
          {passKey.roomNumber || passKey.guestName ? (
            <p className="truncate" style={{ color: GOLD }}>
              {passKey.roomNumber ? `Room ${passKey.roomNumber}` : passKey.guestName}
            </p>
          ) : null}
        </footer>
      </div>
    </article>
  );
}
