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
 * and the on-screen preview is the thing that is approximate, not the print.
 */
export function PassKeyCard({
  passKey,
  bookingUrl,
  restaurantName,
}: {
  passKey: PassKeyRecord;
  bookingUrl: string;
  restaurantName: string;
}) {
  const dinners = passKey.maxUses > 1 ? `${passKey.maxUses} dinners` : "one dinner";

  return (
    <article
      data-pass-key-card=""
      className="flex h-[53.98mm] w-[85.6mm] flex-col justify-between overflow-hidden rounded-[3mm] border border-line-strong bg-surface p-[5mm] text-ink"
    >
      <header className="flex items-baseline justify-between gap-2">
        <p className="display text-[3.6mm] leading-none text-ink">{restaurantName}</p>
        <p className="text-[2.2mm] uppercase tracking-[0.18em] text-ink-subtle">Invitation to dine</p>
      </header>

      <div className="text-center">
        <p className="text-[2.4mm] uppercase tracking-[0.16em] text-ink-subtle">Your pass-key</p>
        <p className="mt-[1mm] font-mono text-[6.4mm] font-bold leading-none tracking-[0.08em] text-ink">
          {formatPassKey(passKey.code)}
        </p>
      </div>

      <footer className="space-y-[0.8mm] text-[2.5mm] leading-tight text-ink-muted">
        <p className="text-center font-semibold text-ink">{bookingUrl}</p>
        <div className="flex items-center justify-between">
          <span>
            {passKey.roomNumber ? `Room ${passKey.roomNumber}` : (passKey.guestName ?? " ")}
          </span>
          <span>
            {dinners}
            {passKey.expiresOn ? ` · until ${formatShortDate(passKey.expiresOn)}` : ""}
          </span>
        </div>
      </footer>
    </article>
  );
}
