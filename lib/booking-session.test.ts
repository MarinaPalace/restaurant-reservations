import { describe, expect, it } from "vitest";
import { readStoredGuestCount } from "@/lib/booking-session";

describe("booking session helpers", () => {
  it("reads the saved guest count from session storage", () => {
    const storage = {
      getItem: (key: string) => (key === "booking-guest-count" ? "2" : null),
    } as Storage;

    expect(readStoredGuestCount(storage)).toBe(2);
  });

  it("falls back to one guest when the saved value is missing or invalid", () => {
    expect(readStoredGuestCount({ getItem: () => null } as Storage)).toBe(1);
    expect(readStoredGuestCount({ getItem: () => "0" } as Storage)).toBe(1);
  });
});
