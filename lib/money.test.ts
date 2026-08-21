import { describe, expect, it } from "vitest";
import {
  CURRENCIES,
  DEFAULT_CURRENCY,
  discountedPrice,
  formatPrice,
  isCurrency,
  sumFinalPrices,
  sumListPrices,
  toCents,
  toCurrency,
} from "@/lib/money";

/**
 * Money, and the two ways it goes wrong.
 *
 * Binary floating point cannot hold most decimal prices, so `40 * 0.85` is
 * `33.999999999999996` — a figure that must never reach a guest or a bill.
 * And a currency is not a symbol glued to a number: languages disagree about
 * which side it goes on, which is why `Intl` places it.
 */

describe("rounding", () => {
  it("rounds a price to the cent", () => {
    expect(toCents(33.999999999999996)).toBe(34);
    expect(toCents(12.345)).toBe(12.35);
    expect(toCents(12.344)).toBe(12.34);
  });

  it("reads anything unusable as zero", () => {
    expect(toCents(Number.NaN)).toBe(0);
    expect(toCents(undefined as unknown as number)).toBe(0);
  });
});

describe("discounts", () => {
  it("takes the percentage off, to the cent", () => {
    expect(discountedPrice(40, 25)).toBe(30);
    // The case that produced 33.999999999999996.
    expect(discountedPrice(40, 15)).toBe(34);
    expect(discountedPrice(19.99, 33)).toBe(13.39);
  });

  it("leaves the price alone at nought percent", () => {
    expect(discountedPrice(28, 0)).toBe(28);
  });

  it("gives it away at a hundred percent", () => {
    expect(discountedPrice(40, 100)).toBe(0);
  });

  /** A discount outside 0–100 is a typo, not an instruction. */
  it("clamps a discount outside the range rather than inverting the price", () => {
    expect(discountedPrice(40, 400)).toBe(0);
    expect(discountedPrice(40, -50)).toBe(40);
  });

  it("never returns a negative price", () => {
    expect(discountedPrice(-40, 0)).toBe(0);
  });
});

describe("currencies", () => {
  it("recognises the ones on the list", () => {
    for (const currency of CURRENCIES) {
      expect(isCurrency(currency)).toBe(true);
    }
  });

  /**
   * A stored value nobody recognises must not take a price down with it —
   * `Intl.NumberFormat` throws on an unknown ISO code.
   */
  it("reads anything unrecognised as the default", () => {
    expect(toCurrency("XYZ")).toBe(DEFAULT_CURRENCY);
    expect(toCurrency(undefined)).toBe(DEFAULT_CURRENCY);
    expect(toCurrency(42)).toBe(DEFAULT_CURRENCY);
  });
});

describe("formatting", () => {
  it("always shows two decimal places", () => {
    expect(formatPrice(30, "EUR", "en")).toMatch(/30\.00/);
    expect(formatPrice(0, "EUR", "en")).toMatch(/0\.00/);
  });

  /**
   * The reason the symbol is not concatenated by hand: English puts it before
   * the number, French and Bulgarian after.
   */
  it("puts the symbol where the language puts it", () => {
    const english = formatPrice(30, "EUR", "en");
    const french = formatPrice(30, "EUR", "fr");

    expect(english.indexOf("€")).toBeLessThan(english.indexOf("3"));
    expect(french.indexOf("€")).toBeGreaterThan(french.indexOf("3"));
  });

  /**
   * `Intl` is forgiving about a tag it merely does not recognise — a
   * well-formed one falls back to the runtime's own locale — and throws only
   * on one that is not a valid tag at all. That second case is the one the
   * fallback exists for, so that is the one worth asserting.
   */
  it("falls back rather than throwing on a malformed locale", () => {
    expect(formatPrice(30, "EUR", "!!")).toBe("30.00 EUR");
  });

  it("still formats a locale it does not recognise", () => {
    expect(formatPrice(30, "EUR", "zz-ZZ")).toMatch(/30/);
  });
});

describe("totals", () => {
  const taken = [
    { price: 40, finalPrice: 30 },
    { price: 12, finalPrice: 12 },
  ];

  it("adds up what is owed", () => {
    expect(sumFinalPrices(taken)).toBe(42);
  });

  it("adds up what it would have cost", () => {
    expect(sumListPrices(taken)).toBe(52);
  });

  it("comes to nothing when nothing was taken", () => {
    expect(sumFinalPrices([])).toBe(0);
    expect(sumListPrices([])).toBe(0);
  });

  /** Three prices that each round cleanly can still sum to a long tail. */
  it("rounds the total, not just the lines", () => {
    expect(sumFinalPrices([{ finalPrice: 0.1 }, { finalPrice: 0.2 }])).toBe(0.3);
  });
});
