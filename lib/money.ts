/**
 * Prices, and the currency they are quoted in.
 *
 * Only promotions carry a price — dinner is part of the stay — so this module
 * is small on purpose. It exists at all because the first version printed bare
 * numbers next to a bottle of wine, which tells a guest arriving from anywhere
 * nothing about what they are agreeing to pay.
 *
 * Nothing here touches the database. `lib/services/settings.ts` reads which
 * currency the restaurant quotes in; this turns an amount into words.
 */

/**
 * The currencies the hotel may quote in.
 *
 * A short list rather than every ISO code: the choice is made once, in a
 * select, by somebody at reception, and a free-text field there is a typo
 * waiting to print "EURR" on a guest's confirmation.
 */
export const CURRENCIES = ["EUR", "BGN", "USD", "GBP", "RON", "PLN"] as const;

export type Currency = (typeof CURRENCIES)[number];

/**
 * Bulgaria is on the euro, and the guests are not all Bulgarian. A restaurant
 * that quotes in something else says so in the settings; one that never opens
 * them gets the answer that is right here.
 */
export const DEFAULT_CURRENCY: Currency = "EUR";

export function isCurrency(value: unknown): value is Currency {
  return typeof value === "string" && (CURRENCIES as readonly string[]).includes(value);
}

/** Anything unrecognised reads as the default, so a bad stored value cannot break a price. */
export function toCurrency(value: unknown): Currency {
  return isCurrency(value) ? value : DEFAULT_CURRENCY;
}

/**
 * Rounds to the cent.
 *
 * `40 * (1 - 0.15)` is `33.999999999999996` in binary floating point, and a
 * price is not allowed to render as that. Every amount that reaches a guest or
 * the database goes through here.
 */
export function toCents(amount: number): number {
  return Math.round((Number(amount) || 0) * 100) / 100;
}

/** What is left to pay after the discount, to the cent. Never below zero. */
export function discountedPrice(price: number, discountPercent: number): number {
  const base = Math.max(0, Number(price) || 0);
  const off = Math.min(100, Math.max(0, Number(discountPercent) || 0));
  return toCents(base * (1 - off / 100));
}

/**
 * A price in the guest's language: `€30.00`, `30,00 лв.`, `30,00 €`.
 *
 * `Intl` places the symbol where the language puts it, which is the whole
 * reason for not concatenating a symbol ourselves — French and Bulgarian put
 * it after the number, English before, and getting that wrong is the kind of
 * detail that makes a screen feel translated by a machine.
 */
export function formatPrice(amount: number, currency: Currency, locale: string): string {
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(toCents(amount));
  } catch {
    // An unknown locale must not take a price down with it.
    return `${toCents(amount).toFixed(2)} ${currency}`;
  }
}

/** What a set of chosen promotions comes to. */
export function sumFinalPrices(items: readonly { finalPrice: number }[]): number {
  return toCents(items.reduce((total, item) => total + (Number(item.finalPrice) || 0), 0));
}

/** What the same set would have cost without the discounts. */
export function sumListPrices(items: readonly { price: number }[]): number {
  return toCents(items.reduce((total, item) => total + (Number(item.price) || 0), 0));
}
