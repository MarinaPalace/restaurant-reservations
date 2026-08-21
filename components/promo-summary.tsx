"use client";

import { useI18n } from "@/components/i18n-provider";
import { cx } from "@/components/ui/utils";
import { format, localeOf } from "@/lib/i18n";
import { formatPrice, sumFinalPrices, sumListPrices, type Currency } from "@/lib/money";
import type { ReservationAddOn } from "@/types/booking";

/**
 * What a booking already holds in promotions, read back to the guest.
 *
 * This is a **record, not a picker**. Promotions are offered once, on the
 * confirmation screen, and nothing here changes them — the point is that a
 * guest looking at their booking afterwards can see what they agreed to. Left
 * off the manage screen, the only party who could say what had been ordered
 * was the restaurant, and "I never ordered a bottle of wine" would have been
 * a conversation with no evidence on the guest's side of it.
 *
 * Prices are the ones stored on the booking, not today's catalogue: the guest
 * agreed to a number, and re-pricing the wine next week must not change what
 * this says they owe.
 */
export function PromoSummary({
  addOns,
  currency,
  className,
  /** Set on the confirmation screen, where the offer above it says all this already. */
  compact = false,
}: {
  addOns: ReservationAddOn[] | undefined;
  currency: Currency;
  className?: string;
  compact?: boolean;
}) {
  const { t, language } = useI18n();
  const locale = localeOf(language);

  // Nothing taken is not worth a heading. A guest who declined everything does
  // not need to be told so on every screen for the rest of their stay.
  if (!addOns?.length) {
    return null;
  }

  const total = sumFinalPrices(addOns);
  const saved = sumListPrices(addOns) - total;

  return (
    <section className={cx("rounded-control border border-gold/40 bg-accent-soft p-4", className)}>
      <h2 className="eyebrow">{t.promo.takenTitle}</h2>

      <ul className="mt-2 space-y-2">
        {addOns.map((addOn) => (
          <li key={addOn.optionId} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <span className="min-w-0">
              <span className="font-semibold text-ink">{addOn.optionName}</span>
              <span className="ml-2 text-xs text-ink-muted">{addOn.courseName}</span>
            </span>

            <span className="flex items-baseline gap-2 whitespace-nowrap">
              {addOn.price === 0 ? (
                <span className="text-xs font-semibold uppercase tracking-wide text-success">{t.promo.free}</span>
              ) : (
                <>
                  {addOn.discountPercent > 0 ? (
                    <>
                      <s className="text-xs text-ink-subtle">{formatPrice(addOn.price, currency, locale)}</s>
                      <span className="rounded-full bg-success-soft px-2 py-0.5 text-xs font-bold text-success">
                        {format(t.promo.discount, { percent: addOn.discountPercent })}
                      </span>
                    </>
                  ) : null}
                  <span className="font-semibold text-ink">{formatPrice(addOn.finalPrice, currency, locale)}</span>
                </>
              )}
            </span>
          </li>
        ))}
      </ul>

      {total > 0 ? (
        <div className="mt-3 flex flex-wrap items-baseline justify-between gap-x-4 border-t border-gold/30 pt-3">
          <span className="text-sm text-ink-subtle">{t.promo.total}</span>
          <span className="text-lg font-semibold text-ink">{formatPrice(total, currency, locale)}</span>
        </div>
      ) : null}

      {saved > 0 ? (
        <p className="mt-1 text-right text-sm font-semibold text-success">
          {format(t.promo.youSave, { amount: formatPrice(saved, currency, locale) })}
        </p>
      ) : null}

      {compact ? null : <p className="mt-3 text-xs text-ink-muted">{t.promo.takenNote}</p>}
    </section>
  );
}
