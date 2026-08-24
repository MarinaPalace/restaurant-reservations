import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { reportError } from "@/lib/observability";

/**
 * The reporter is called from `catch` blocks and from the error hook itself, so
 * two things matter more than what it writes: it must never throw, and it must
 * never write a pass-key.
 *
 * A key in a log line is a key in every system those logs reach, held by
 * anyone who can read them — and unlike a password nobody rotates it, because
 * nobody knows it leaked.
 */

let written: string[];
let spy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  written = [];
  spy = vi.spyOn(console, "error").mockImplementation((line: unknown) => {
    written.push(String(line));
  });
});

afterEach(() => {
  spy.mockRestore();
});

function lastLine() {
  return JSON.parse(written[written.length - 1]);
}

describe("what gets written", () => {
  it("writes one JSON line that can be filtered by scope and counted by event", () => {
    reportError({ scope: "booking", event: "reservation:cancel", error: new Error("nope") });

    expect(written).toHaveLength(1);

    const line = lastLine();
    expect(line.level).toBe("error");
    expect(line.scope).toBe("booking");
    expect(line.event).toBe("reservation:cancel");
    expect(line.message).toBe("nope");
    expect(typeof line.at).toBe("string");
  });

  it("keeps the stack, which is the half that says where", () => {
    reportError({ scope: "admin", event: "x", error: new Error("boom") });
    expect(lastLine().stack).toContain("boom");
  });

  it("reports something thrown that was not an Error", () => {
    reportError({ scope: "admin", event: "x", error: "just a string" });

    const line = lastLine();
    expect(line.name).toBe("NonError");
    expect(line.message).toBe("just a string");
  });

  it("carries the digest, the only link to the reference shown on screen", () => {
    const error = Object.assign(new Error("render failed"), { digest: "1234567890" });
    reportError({ scope: "server", event: "unhandled:render", error });

    expect(lastLine().digest).toBe("1234567890");
  });
});

describe("secrets", () => {
  it("never writes a pass-key", () => {
    reportError({
      scope: "booking",
      event: "promotions:save",
      error: new Error("failed"),
      context: { passKey: "VDM-SECRET-KEY", reservationNumber: "VDM-AAA111" },
    });

    const raw = written[written.length - 1];
    expect(raw).not.toContain("VDM-SECRET-KEY");
    expect(lastLine().context.passKey).toBe("[redacted]");

    // The identifier beside it is the whole point of having context at all.
    expect(lastLine().context.reservationNumber).toBe("VDM-AAA111");
  });

  it("redacts however the field is spelled", () => {
    reportError({
      scope: "auth",
      event: "login:failed",
      error: new Error("failed"),
      context: {
        pass_key: "a",
        passkey: "b",
        password: "c",
        SESSION_SECRET: "d",
        authorization: "e",
      },
    });

    const raw = written[written.length - 1];
    for (const secret of ["a", "b", "c", "d", "e"]) {
      expect(raw).not.toContain(`:"${secret}"`);
    }
  });

  it("redacts one nested inside the context", () => {
    reportError({
      scope: "booking",
      event: "x",
      error: new Error("failed"),
      context: { request: { body: { passKey: "VDM-NESTED" } } },
    });

    expect(written[written.length - 1]).not.toContain("VDM-NESTED");
  });
});

describe("it cannot make things worse", () => {
  it("does not throw on a circular context", () => {
    const circular: Record<string, unknown> = { name: "loop" };
    circular.self = circular;

    expect(() =>
      reportError({ scope: "admin", event: "x", error: new Error("failed"), context: circular }),
    ).not.toThrow();

    // Something is still said, so the failure is not lost with the context.
    expect(written[written.length - 1]).toContain("x");
  });

  it("does not throw when handed null", () => {
    expect(() => reportError({ scope: "admin", event: "x", error: null })).not.toThrow();
  });
});
