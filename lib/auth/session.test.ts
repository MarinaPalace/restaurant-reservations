import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHmac } from "crypto";
import {
  ENVIRONMENT_ADMIN_ID,
  createSessionValue,
  readSessionValue,
  verifySessionValue,
} from "@/lib/auth/session";

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
    const separator = token.lastIndexOf(".");
    const payload = token.slice(0, separator);
    const signature = token.slice(separator + 1);
    const [expiresAt, userId] = payload.split(":");

    expect(verifySessionValue(`${Number(expiresAt) + 3600}:${userId}.${signature}`)).toBe(false);
    expect(verifySessionValue(`${payload}.${signature.slice(0, -1)}x`)).toBe(false);
    expect(verifySessionValue(payload)).toBe(false);
  });

  it("rejects an expired token", () => {
    const eightHoursAndOneMinute = 8 * 60 * 60 * 1000 + 60_000;
    const issued = createSessionValue({ nowMs: Date.now() - eightHoursAndOneMinute });

    expect(verifySessionValue(issued)).toBe(false);
  });

  it("still accepts a token that has not quite expired", () => {
    const sevenHours = 7 * 60 * 60 * 1000;
    expect(verifySessionValue(createSessionValue({ nowMs: Date.now() - sevenHours }))).toBe(true);
  });
});

describe("session identity", () => {
  it("carries the account the token was issued for", () => {
    const token = createSessionValue({ userId: "652f1a9c4d3b2e1a0f9c8b7a" });
    expect(readSessionValue(token)?.userId).toBe("652f1a9c4d3b2e1a0f9c8b7a");
  });

  /**
   * The identity is inside the signature, so a staff member cannot promote
   * themselves by editing the cookie to another account's id.
   */
  it("rejects a token whose account id has been swapped", () => {
    const token = createSessionValue({ userId: "652f1a9c4d3b2e1a0f9c8b7a" });
    const signature = token.slice(token.lastIndexOf(".") + 1);
    const expiresAt = token.slice(0, token.indexOf(":"));

    expect(verifySessionValue(`${expiresAt}:${ENVIRONMENT_ADMIN_ID}.${signature}`)).toBe(false);
  });

  it("refuses to mint a token for an id that would corrupt the payload", () => {
    expect(() => createSessionValue({ userId: "has:colon" })).toThrow();
    expect(() => createSessionValue({ userId: "has.dot" })).toThrow();
  });
});

/**
 * Tokens issued before sessions carried an identity are an expiry and a
 * signature, with no account id. They must keep working, or a deploy signs
 * every member of staff out in the middle of service.
 *
 * The secret is pinned here so the old token shape can be signed the way the
 * previous release would have signed it.
 */
describe("tokens issued by the previous release", () => {
  const secret = "test-session-secret-value";

  beforeEach(() => {
    process.env.ADMIN_SESSION_SECRET = secret;
  });

  afterEach(() => {
    delete process.env.ADMIN_SESSION_SECRET;
  });

  function legacyToken(expiresAt: number) {
    const signature = createHmac("sha256", secret).update(String(expiresAt)).digest("base64url");
    return `${expiresAt}.${signature}`;
  }

  it("stays valid and reads as the environment administrator", () => {
    const token = legacyToken(Math.floor(Date.now() / 1000) + 3600);

    expect(verifySessionValue(token)).toBe(true);
    expect(readSessionValue(token)?.userId).toBe(ENVIRONMENT_ADMIN_ID);
  });

  it("still expires", () => {
    expect(verifySessionValue(legacyToken(Math.floor(Date.now() / 1000) - 60))).toBe(false);
  });

  it("is still rejected when unsigned", () => {
    const expiresAt = Math.floor(Date.now() / 1000) + 3600;
    expect(verifySessionValue(`${expiresAt}.forged`)).toBe(false);
  });
});
