import { describe, expect, it } from "vitest";
import {
  PASS_KEY_ALPHABET,
  PASS_KEY_LENGTH,
  formatPassKey,
  generatePassKeyCode,
  isValidPassKeyFormat,
  normalizePassKey,
} from "@/lib/pass-key";

describe("generatePassKeyCode", () => {
  it("produces codes of the right length from the alphabet only", () => {
    for (let attempt = 0; attempt < 200; attempt += 1) {
      const code = generatePassKeyCode();
      expect(code).toHaveLength(PASS_KEY_LENGTH);
      expect([...code].every((character) => PASS_KEY_ALPHABET.includes(character))).toBe(true);
    }
  });

  it("never emits a character a guest could misread", () => {
    const ambiguous = ["I", "L", "O", "U"];
    for (let attempt = 0; attempt < 200; attempt += 1) {
      const code = generatePassKeyCode();
      expect(ambiguous.some((character) => code.includes(character))).toBe(false);
    }
  });

  it("does not repeat itself", () => {
    const codes = new Set(Array.from({ length: 500 }, generatePassKeyCode));
    expect(codes.size).toBe(500);
  });
});

describe("normalizePassKey", () => {
  const canonical = "K7QP3M2XR4TN";

  it("accepts every reasonable way of typing the same key", () => {
    const variants = [
      "K7QP3M2XR4TN",
      "k7qp3m2xr4tn",
      "K7QP-3M2X-R4TN",
      "VDM-K7QP-3M2X-R4TN",
      "vdm-k7qp-3m2x-r4tn",
      "  K7QP 3M2X R4TN  ",
      "K7QP–3M2X–R4TN",
    ];

    for (const variant of variants) {
      expect(normalizePassKey(variant)).toBe(canonical);
    }
  });

  it("folds the characters people type when they misread a slip", () => {
    // O for zero, I and lowercase l for one, U for V.
    expect(normalizePassKey("OIL")).toBe("011");
    expect(normalizePassKey("oil")).toBe("011");
    expect(normalizePassKey("U")).toBe("V");
  });

  it("returns an empty string for junk", () => {
    expect(normalizePassKey("")).toBe("");
    expect(normalizePassKey(null)).toBe("");
    expect(normalizePassKey(undefined)).toBe("");
    expect(normalizePassKey("---")).toBe("");
  });
});

describe("isValidPassKeyFormat", () => {
  it("accepts a current ten-character key", () => {
    expect(isValidPassKeyFormat("K7QP3M2XR4")).toBe(true);
    expect(isValidPassKeyFormat("VDM-K7QP3-M2XR4")).toBe(true);
  });

  /**
   * Keys issued under the previous twelve-character format are still in
   * guests' hands, so they have to keep working.
   */
  it("still accepts a key issued before the length changed", () => {
    expect(isValidPassKeyFormat("K7QP3M2XR4TN")).toBe(true);
    expect(isValidPassKeyFormat("VDM-K7QP-3M2X-R4TN")).toBe(true);
  });

  it("rejects anything outside the accepted range", () => {
    expect(isValidPassKeyFormat("K7QP3M2")).toBe(false);
    expect(isValidPassKeyFormat("K7QP3M2XR4TNNN")).toBe(false);
    expect(isValidPassKeyFormat("")).toBe(false);
  });

  it("accepts everything the generator produces", () => {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      expect(isValidPassKeyFormat(generatePassKeyCode())).toBe(true);
    }
  });
});

describe("formatPassKey", () => {
  it("groups the code into two blocks of five for printing", () => {
    expect(formatPassKey("K7QP3M2XR4")).toBe("VDM-K7QP3-M2XR4");
  });

  it("is stable however the key was typed", () => {
    expect(formatPassKey("vdm-k7qp3-m2xr4")).toBe("VDM-K7QP3-M2XR4");
    expect(formatPassKey("  k7qp3 m2xr4 ")).toBe("VDM-K7QP3-M2XR4");
  });

  /** A legacy twelve-character key still groups, just into three blocks. */
  it("still renders a key issued before the length changed", () => {
    expect(formatPassKey("K7QP3M2XR4TN")).toBe("VDM-K7QP3-M2XR4-TN");
  });

  it("renders nothing for an empty key rather than a bare prefix", () => {
    expect(formatPassKey("")).toBe("");
  });
});
