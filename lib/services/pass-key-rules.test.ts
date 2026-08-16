import { describe, expect, it } from "vitest";
import {
  describeGuestCountProblem,
  describePassKeyProblem,
  isDateWithinStay,
  isPassKeyUsable,
} from "@/lib/services/pass-keys";
import type { PassKeyRecord } from "@/types/booking";

/**
 * The rules that decide whether a key opens the door. They are pure, and the
 * routes delegate to them, so what is tested here is what runs.
 */

const NOW = new Date("2026-08-18T10:00:00");

function key(overrides: Partial<PassKeyRecord> = {}): PassKeyRecord {
  return {
    id: "key-1",
    code: "K7QP3M2XR4TN",
    maxUses: 1,
    usedCount: 0,
    status: "active",
    reservationNumbers: [],
    expiresOn: "2026-08-25",
    ...overrides,
  };
}

describe("describePassKeyProblem", () => {
  it("accepts a live key", () => {
    expect(describePassKeyProblem(key(), NOW)).toBeNull();
    expect(isPassKeyUsable(key(), NOW)).toBe(true);
  });

  it("rejects a key that does not exist, without hinting that it might", () => {
    expect(describePassKeyProblem(null, NOW)).toMatchObject({ code: "INVALID" });
  });

  it("rejects a key with no dinners left on it", () => {
    expect(describePassKeyProblem(key({ usedCount: 1, maxUses: 1 }), NOW)).toMatchObject({ code: "USED" });
  });

  /**
   * A long stay earns more than one dinner, so a key with a use still on it
   * must keep working after the first booking.
   */
  it("accepts a multi-use key that still has a dinner left", () => {
    expect(describePassKeyProblem(key({ maxUses: 3, usedCount: 1 }), NOW)).toBeNull();
    expect(describePassKeyProblem(key({ maxUses: 3, usedCount: 2 }), NOW)).toBeNull();
    expect(describePassKeyProblem(key({ maxUses: 3, usedCount: 3 }), NOW)).toMatchObject({ code: "USED" });
  });

  it("rejects a revoked key", () => {
    expect(describePassKeyProblem(key({ status: "revoked" }), NOW)).toMatchObject({ code: "REVOKED" });
  });

  /**
   * Expiry is computed from the date rather than stored as a status, so a key
   * goes stale on its own with no scheduled job to run.
   */
  it("rejects a key whose stay has ended", () => {
    expect(describePassKeyProblem(key({ expiresOn: "2026-08-17" }), NOW)).toMatchObject({ code: "EXPIRED" });
  });

  it("still accepts a key on its final day", () => {
    expect(describePassKeyProblem(key({ expiresOn: "2026-08-18" }), NOW)).toBeNull();
  });

  it("accepts a key with no expiry at all", () => {
    expect(describePassKeyProblem(key({ expiresOn: undefined }), NOW)).toBeNull();
  });

  /** Revoked beats used: the key is dead, not merely spent. */
  it("reports the strongest reason first", () => {
    expect(describePassKeyProblem(key({ status: "revoked", expiresOn: "2020-01-01" }), NOW)).toMatchObject({
      code: "REVOKED",
    });
  });
});

describe("isDateWithinStay", () => {
  it("allows an evening during the stay", () => {
    expect(isDateWithinStay({ expiresOn: "2026-08-25" }, "2026-08-20")).toBe(true);
  });

  it("allows the evening of check-out itself", () => {
    expect(isDateWithinStay({ expiresOn: "2026-08-25" }, "2026-08-25")).toBe(true);
  });

  /**
   * Otherwise a guest could hold a table weeks after they have gone home.
   */
  it("refuses an evening after check-out", () => {
    expect(isDateWithinStay({ expiresOn: "2026-08-25" }, "2026-08-26")).toBe(false);
  });

  it("allows anything when the key has no expiry", () => {
    expect(isDateWithinStay({ expiresOn: undefined }, "2099-01-01")).toBe(true);
  });
});

/**
 * Reception knows the party size from the hotel booking, so the key carries
 * it. Coming with fewer is ordinary; more was never held for them.
 */
describe("describeGuestCountProblem", () => {
  it("allows the exact party and anything smaller", () => {
    expect(describeGuestCountProblem({ maxGuests: 4 }, 4)).toBeNull();
    expect(describeGuestCountProblem({ maxGuests: 4 }, 3)).toBeNull();
    expect(describeGuestCountProblem({ maxGuests: 4 }, 1)).toBeNull();
  });

  it("refuses a larger party, and says the number they are entitled to", () => {
    const problem = describeGuestCountProblem({ maxGuests: 4 }, 5);

    expect(problem).toContain("4");
    expect(problem).toContain("reception");
  });

  it("gets the singular right for a booking of one", () => {
    expect(describeGuestCountProblem({ maxGuests: 1 }, 2)).toContain("1 guest,");
  });

  /**
   * Keys issued before the party size was recorded carry no limit, and must
   * keep working — the restaurant's own maximum still applies to them.
   */
  it("imposes nothing when the key records no party size", () => {
    expect(describeGuestCountProblem({ maxGuests: undefined }, 6)).toBeNull();
    expect(describeGuestCountProblem({}, 6)).toBeNull();
  });
});
