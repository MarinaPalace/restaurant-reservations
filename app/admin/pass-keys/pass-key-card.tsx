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
 * Colours are literal rather than theme tokens. A card is printed and handed
 * over, so it must look the same whatever theme the person at the desk happens
 * to be using, and it must not turn white-on-white in a light palette.
 */

/** Ivory card stock, deep teal ink, gold rule. */
const INK = "#14343d";
const INK_SOFT = "#4a6670";
const GOLD = "#a8842c";

export function PassKeyCard({
  passKey,
  bookingUrl,
  restaurantName,
}: {
  passKey: PassKeyRecord;
  /** Where the QR points, and what is printed under it. */
  bookingUrl: string;
  restaurantName: string;
}) {
  const dinners = passKey.maxUses > 1 ? `${passKey.maxUses} dinners` : "One dinner";
  const isInvitation = passKey.kind === "premium";

  const target = bookingUrl.startsWith("http") ? bookingUrl : `https://${bookingUrl}`;
  /**
   * Drawn by the server rather than in the browser: the Node build of `qrcode`
   * is the one certain to work, and an image the browser has already fetched
   * prints far more reliably than markup injected after hydration.
   */
  const qrSrc = `/api/admin/pass-keys/qr?data=${encodeURIComponent(target)}`;

  return (
    <article
      data-pass-key-card=""
      data-card-kind={isInvitation ? "invitation" : "in-house"}
      className="relative flex h-[53.98mm] w-[85.6mm] overflow-hidden rounded-[3mm]"
      style={{ backgroundColor: "#fbf7ef", color: INK }}
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

      <div className="relative flex flex-1 flex-col justify-between p-[4.5mm]">
        <header>
          <p className="display text-[4mm] leading-none" style={{ color: INK }}>
            {restaurantName}
          </p>
          <p className="mt-[0.8mm] text-[2.1mm] uppercase tracking-[0.22em]" style={{ color: GOLD }}>
            {isInvitation ? "An invitation to dine" : "Dinner is part of your stay"}
          </p>
        </header>

        <div>
          <p className="text-[2.2mm] uppercase tracking-[0.16em]" style={{ color: INK_SOFT }}>
            Your pass-key
          </p>
          <p
            className="mt-[0.6mm] font-mono text-[5.6mm] font-bold leading-none tracking-[0.06em]"
            style={{ color: INK }}
          >
            {formatPassKey(passKey.code)}
          </p>
        </div>

        <footer className="text-[2.2mm] leading-tight" style={{ color: INK_SOFT }}>
          <p className="truncate font-semibold" style={{ color: INK }}>
            {bookingUrl}
          </p>
          <p className="mt-[0.5mm]">
            {dinners}
            {passKey.expiresOn ? ` · valid until ${formatShortDate(passKey.expiresOn)}` : ""}
          </p>
          {passKey.roomNumber || passKey.guestName ? (
            <p className="truncate" style={{ color: GOLD }}>
              {passKey.roomNumber ? `Room ${passKey.roomNumber}` : passKey.guestName}
            </p>
          ) : null}
        </footer>
      </div>

      <div className="relative flex w-[26mm] shrink-0 flex-col items-center justify-center gap-[1mm] p-[3mm]">
        {/* White behind the code, so a camera reads it off the tinted stock. */}
        <span
          className="flex size-[20mm] items-center justify-center rounded-[1.2mm] p-[1mm]"
          style={{ backgroundColor: "#ffffff", border: `0.2mm solid ${GOLD}55` }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={qrSrc} alt="" width={72} height={72} className="size-full" />
        </span>
        <p className="text-[1.8mm] uppercase tracking-[0.14em]" style={{ color: GOLD }}>
          Scan to book
        </p>
      </div>
    </article>
  );
}
