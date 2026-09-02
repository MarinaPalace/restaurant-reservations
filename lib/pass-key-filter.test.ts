import { describe, expect, it } from "vitest";
import {
  countByKind,
  filterPassKeys,
  isInvitationKey,
  type PassKeyKindFilter,
  type PassKeyStatusFilter,
} from "@/lib/pass-key-filter";
import type { PassKeyRecord } from "@/types/booking";

function key(overrides: Partial<PassKeyRecord> = {}): PassKeyRecord {
  return {
    id: overrides.code ?? "k1",
    code: "VDMK7QP3M2XR4",
    maxUses: 1,
    usedCount: 0,
    status: "active",
    reservationNumbers: [],
    ...overrides,
  };
}

const inHouse = key({ id: "a", code: "VDMAAA111BBB22", roomNumber: "402", guestName: "Petrova", reservationRef: "40218" });
/** Issued before invitations existed: no `kind` at all. */
const legacy = key({ id: "b", code: "VDMBBB222CCC33", roomNumber: "118", kind: undefined });
const invitation = key({ id: "c", code: "VDMCCC333DDD44", kind: "premium", guestName: "Ivanov", guestEmail: "ivanov@example.com" });
const spentInvitation = key({ id: "d", code: "VDMDDD444EEE55", kind: "premium", status: "used", usedCount: 1 });
const revoked = key({ id: "e", code: "VDMEEE555FFF66", status: "revoked" });

const all = [inHouse, legacy, invitation, spentInvitation, revoked];

const pick = (status: PassKeyStatusFilter, kind: PassKeyKindFilter, query = "") =>
  filterPassKeys(all, { status, kind, query }).map((entry) => entry.id);

describe("telling an invitation from a room key", () => {
  it("reads a key with no kind as in-house", () => {
    expect(isInvitationKey(legacy)).toBe(false);
    expect(isInvitationKey(inHouse)).toBe(false);
    expect(isInvitationKey(invitation)).toBe(true);
  });

  /**
   * The point of `kind !== "premium"` rather than `kind === "standard"`: every
   * key issued before invitations existed has no kind, and there are a hundred
   * of them. They must answer the in-house filter, not neither.
   */
  it("keeps older keys in the in-house list", () => {
    expect(pick("all", "standard")).toContain("b");
  });
});

describe("filtering the issued keys", () => {
  it("shows everything by default", () => {
    expect(pick("all", "all")).toEqual(["a", "b", "c", "d", "e"]);
  });

  it("shows only invitations", () => {
    expect(pick("all", "premium")).toEqual(["c", "d"]);
  });

  it("shows only in-house keys", () => {
    expect(pick("all", "standard")).toEqual(["a", "b", "e"]);
  });

  /** The question the two separate controls exist to answer. */
  it("combines status and kind: the active invitations", () => {
    expect(pick("active", "premium")).toEqual(["c"]);
  });

  it("still filters by status alone", () => {
    expect(pick("revoked", "all")).toEqual(["e"]);
    expect(pick("used", "all")).toEqual(["d"]);
  });
});

describe("searching", () => {
  it("finds a key by room, reference or name", () => {
    expect(pick("all", "all", "402")).toEqual(["a"]);
    expect(pick("all", "all", "40218")).toEqual(["a"]);
    expect(pick("all", "all", "petrova")).toEqual(["a"]);
  });

  /** An invitation is found by where it was sent — there is no room to ask for. */
  it("finds an invitation by the address it went to", () => {
    expect(pick("all", "all", "ivanov@example.com")).toEqual(["c"]);
  });

  it("finds the code whether it is typed with dashes or without", () => {
    expect(pick("all", "all", "VDM-CCC33-3DDD44")).toEqual(["c"]);
    expect(pick("all", "all", "vdmccc333ddd44")).toEqual(["c"]);
  });

  it("searches within the chosen filters rather than across everything", () => {
    expect(pick("all", "standard", "ivanov")).toEqual([]);
  });

  it("ignores surrounding spaces", () => {
    expect(pick("all", "all", "  petrova  ")).toEqual(["a"]);
  });
});

describe("counting for the buttons", () => {
  it("counts what is in front of it, not the whole list", () => {
    expect(countByKind(all)).toEqual({ all: 5, standard: 3, premium: 2 });
    expect(countByKind(filterPassKeys(all, { status: "active", kind: "all", query: "" }))).toEqual({
      all: 3,
      standard: 2,
      premium: 1,
    });
  });
});
