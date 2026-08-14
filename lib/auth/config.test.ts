import { describe, expect, it } from "vitest";
import { describePasswordHashProblem, describeSessionSecretProblem } from "@/lib/auth/config";

const VALID_HASH = "$2b$10$OJkvMQv7fDN5TT/LMOdiUeTLuIEHCkDEIbBVOhVC0h5klJ4F6lGue";

describe("admin password hash validation", () => {
  it("accepts a well-formed bcrypt hash", () => {
    expect(describePasswordHashProblem(VALID_HASH)).toBeNull();
    expect(describePasswordHashProblem(VALID_HASH.replace("$2b$", "$2a$"))).toBeNull();
    expect(describePasswordHashProblem(VALID_HASH.replace("$2b$", "$2y$"))).toBeNull();
  });

  it("reports a missing value", () => {
    expect(describePasswordHashProblem(undefined)).toBe("not set");
    expect(describePasswordHashProblem("")).toBe("not set");
  });

  /**
   * The most common deployment mistake: setting the hash through a shell that
   * expands the `$2b`, `$10` and `$…` segments, leaving a fragment behind.
   */
  it("explains a hash mangled by shell expansion", () => {
    expect(describePasswordHashProblem("b10OJkvMQv7fDN5TT")).toContain("expanded by a shell");
  });

  it("spots a truncated hash", () => {
    expect(describePasswordHashProblem(VALID_HASH.slice(0, 40))).toContain("truncated");
  });

  it("rejects something that is not a hash at all", () => {
    expect(describePasswordHashProblem("$hunter2")).toContain("not a bcrypt hash");
  });
});

describe("admin session secret validation", () => {
  it("accepts a long enough secret", () => {
    expect(describeSessionSecretProblem("a".repeat(16))).toBeNull();
    expect(describeSessionSecretProblem("a".repeat(64))).toBeNull();
  });

  it("reports a missing or short secret", () => {
    expect(describeSessionSecretProblem(undefined)).toBe("not set");
    expect(describeSessionSecretProblem("short")).toContain("at least 16");
  });
});
