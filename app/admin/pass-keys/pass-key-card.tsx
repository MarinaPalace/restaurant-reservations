"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";
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
 */

/**
 * The QR is drawn to an inline SVG data URL rather than fetched from a chart
 * service: the card has to print on a desk with no internet, and nothing in
 * this app may depend on an outside host.
 */
function useQrCode(value: string) {
  const [svg, setSvg] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    QRCode.toString(value, {
      type: "svg",
      margin: 0,
      // M survives a fold or a coffee ring across roughly 15% of the code,
      // which is the right trade for something carried in a pocket.
      errorCorrectionLevel: "M",
      color: { dark: "#1a1a1a", light: "#00000000" },
    })
      .then((result) => {
        if (!cancelled) {
          setSvg(result);
        }
      })
      .catch(() => {
        // A card without a QR is still perfectly usable — the code is printed
        // right next to it — so a failure here is not worth an error state.
        if (!cancelled) {
          setSvg(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [value]);

  return svg;
}

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
  const qr = useQrCode(bookingUrl.startsWith("http") ? bookingUrl : `https://${bookingUrl}`);
  const dinners = passKey.maxUses > 1 ? `${passKey.maxUses} dinners` : "One dinner";
  const isInvitation = passKey.kind === "premium";

  return (
    <article
      data-pass-key-card=""
      data-card-kind={isInvitation ? "invitation" : "in-house"}
      className="relative flex h-[53.98mm] w-[85.6mm] overflow-hidden rounded-[3mm] bg-[#0e2a33] text-[#f4ece0]"
    >
      {/* A wash of house colour, warmer for an invitation than for a room key. */}
      <div
        aria-hidden="true"
        data-card-wash=""
        className={
          isInvitation
            ? "pointer-events-none absolute inset-0 bg-gradient-to-br from-[#7a5a2e] via-[#0e2a33] to-[#0e2a33]"
            : "pointer-events-none absolute inset-0 bg-gradient-to-br from-[#14545f] via-[#0e2a33] to-[#0e2a33]"
        }
      />

      {/* A hairline rule inset from the edge, the way a menu card is ruled. */}
      <div
        aria-hidden="true"
        data-card-rule=""
        className="pointer-events-none absolute inset-[2mm] rounded-[2mm] border border-[#c8a86b]/50"
      />

      <div className="relative flex flex-1 flex-col justify-between p-[4.5mm]">
        <header>
          <p className="display text-[4mm] leading-none text-[#f4ece0]">{restaurantName}</p>
          <p className="mt-[0.8mm] text-[2.1mm] uppercase tracking-[0.22em] text-[#c8a86b]">
            {isInvitation ? "An invitation to dine" : "Dinner is part of your stay"}
          </p>
        </header>

        <div>
          <p className="text-[2.2mm] uppercase tracking-[0.16em] text-[#c8a86b]">Your pass-key</p>
          <p className="mt-[0.6mm] font-mono text-[5.6mm] font-bold leading-none tracking-[0.06em] text-[#ffffff]">
            {formatPassKey(passKey.code)}
          </p>
        </div>

        <footer className="text-[2.2mm] leading-tight text-[#f4ece0]/85">
          <p className="truncate font-semibold text-[#ffffff]">{bookingUrl}</p>
          <p className="mt-[0.5mm]">
            {dinners}
            {passKey.expiresOn ? ` · valid until ${formatShortDate(passKey.expiresOn)}` : ""}
          </p>
          {passKey.roomNumber || passKey.guestName ? (
            <p className="truncate text-[#c8a86b]">
              {passKey.roomNumber ? `Room ${passKey.roomNumber}` : passKey.guestName}
            </p>
          ) : null}
        </footer>
      </div>

      {/* The QR sits on white so a phone camera reads it off dark card stock. */}
      <div className="relative flex w-[26mm] shrink-0 items-center justify-center p-[3mm]">
        <div className="flex size-[20mm] items-center justify-center rounded-[1.2mm] bg-white p-[1.2mm]">
          {qr ? (
            <span
              aria-hidden="true"
              className="block size-full [&>svg]:block [&>svg]:size-full"
              dangerouslySetInnerHTML={{ __html: qr }}
            />
          ) : null}
        </div>
        <p className="absolute bottom-[1mm] left-0 right-0 text-center text-[1.7mm] uppercase tracking-[0.14em] text-[#c8a86b]">
          Scan to book
        </p>
      </div>
    </article>
  );
}
