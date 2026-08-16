import { describe, expect, it } from "vitest";
import { describePassKeyProblem, isDateWithinStay, isPassKeyUsable } from "@/lib/services/pass-keys";
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
    status: "active",
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

  it("rejects a key that has already been spent", () => {
    expect(describePassKeyProblem(key({ status: "used" }), NOW)).toMatchObject({ code: "USED" });
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
