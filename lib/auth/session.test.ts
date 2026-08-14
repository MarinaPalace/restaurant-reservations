import { describe, expect, it } from "vitest";
import { createSessionValue, verifySessionValue } from "@/lib/auth/session";

describe("admin session tokens", () => {
  it("accepts a token it just issued", () => {
    expect(verifySessionValue(createSessionValue())).toBe(true);
  });

  /**
   * Regression test for the auth bypass: the admin cookie used to be the
   * literal string "true", so anyone could type
   * `document.cookie = "admin-auth=true"` and get full staff access.
   */
  it("rejects hand-written cookie values", () => {
    expect(verifySessionValue("true")).toBe(false);
    expect(verifySessionValue("admin")).toBe(false);
    expect(verifySessionValue("")).toBe(false);
    expect(verifySessionValue(undefined)).toBe(false);
  });

  it("rejects a token whose signature does not match its payload", () => {
    const token = createSessionValue();
    const [payload, signature] = token.split(".");

    expect(verifySessionValue(`${Number(payload) + 3600}.${signature}`)).toBe(false);
    expect(verifySessionValue(`${payload}.${signature.slice(0, -1)}x`)).toBe(false);
    expect(verifySessionValue(payload)).toBe(false);
  });

  it("rejects an expired token", () => {
    const eightHoursAndOneMinute = 8 * 60 * 60 * 1000 + 60_000;
    const issued = createSessionValue(Date.now() - eightHoursAndOneMinute);

    expect(verifySessionValue(issued)).toBe(false);
  });

  it("still accepts a token that has not quite expired", () => {
    const sevenHours = 7 * 60 * 60 * 1000;
    expect(verifySessionValue(createSessionValue(Date.now() - sevenHours))).toBe(true);
  });
});
