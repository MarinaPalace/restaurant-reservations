import { describe, expect, it } from "vitest";
import { issuePassKeySchema, sendInvitationSchema, updatePassKeySchema } from "@/lib/validation/booking";

/**
 * What may be asked of the issuing route when an invitation is to be emailed.
 *
 * The two refusals here are the ones worth catching before anything is written:
 * asking to send with no address, and asking to email an in-house key — which is
 * a misunderstanding of what the two kinds of key are for. An in-house guest is
 * handed a printed card at the desk; we may not even hold their address.
 */
describe("issuing an invitation to be emailed", () => {
  const invitation = {
    kind: "premium" as const,
    guestName: "Maria Petrova",
    guestEmail: "maria@example.com",
    sendInvitation: true,
    expiresOn: "2026-09-20",
  };

  it("accepts an invitation with an address", () => {
    const parsed = issuePassKeySchema.safeParse(invitation);
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.guestEmail).toBe("maria@example.com");
  });

  it("normalises the address, so a resend and a search agree", () => {
    const parsed = issuePassKeySchema.safeParse({ ...invitation, guestEmail: "  Maria@Example.COM " });
    expect(parsed.success && parsed.data.guestEmail).toBe("maria@example.com");
  });

  it("rejects something that is not an address", () => {
    for (const guestEmail of ["maria", "maria@", "@example.com", "maria@example"]) {
      const parsed = issuePassKeySchema.safeParse({ ...invitation, guestEmail });
      expect(parsed.success, guestEmail).toBe(false);
    }
  });

  it("refuses to send with no address to send to", () => {
    const parsed = issuePassKeySchema.safeParse({ ...invitation, guestEmail: undefined });

    expect(parsed.success).toBe(false);
    expect(parsed.success === false && parsed.error.issues[0].message).toContain("email address");
  });

  it("refuses to email an in-house key", () => {
    const parsed = issuePassKeySchema.safeParse({ ...invitation, kind: "standard" });

    expect(parsed.success).toBe(false);
    expect(parsed.success === false && parsed.error.issues[0].message).toContain("Only invitations");
  });

  /**
   * An invitation carries none of the stay: no hotel reference, no room, no
   * check-in and no check-out. The guest is not staying here.
   */
  it("accepts an invitation with nothing but a name, an address and an expiry", () => {
    const parsed = issuePassKeySchema.safeParse({
      kind: "premium",
      guestName: "Maria Petrova",
      guestEmail: "maria@example.com",
      expiresOn: "2026-09-20",
      sendInvitation: true,
    });

    expect(parsed.success).toBe(true);
  });

  it("still accepts an address on a key nobody asked to send yet", () => {
    const parsed = issuePassKeySchema.safeParse({
      kind: "premium",
      guestEmail: "maria@example.com",
    });

    expect(parsed.success).toBe(true);
  });
});

describe("sending an invitation again", () => {
  it("takes no address at all, meaning the one on the key", () => {
    expect(sendInvitationSchema.safeParse({}).success).toBe(true);
  });

  it("takes a corrected address", () => {
    const parsed = sendInvitationSchema.safeParse({ email: "Right@Example.com" });
    expect(parsed.success && parsed.data.email).toBe("right@example.com");
  });

  it("refuses a corrected address that is not one", () => {
    expect(sendInvitationSchema.safeParse({ email: "nope" }).success).toBe(false);
  });
});

describe("editing the address on an existing key", () => {
  it("accepts a correction", () => {
    const parsed = updatePassKeySchema.safeParse({ guestEmail: "corrected@example.com" });
    expect(parsed.success && parsed.data.guestEmail).toBe("corrected@example.com");
  });

  /** Null clears it — an invitation that will be delivered another way. */
  it("accepts clearing it", () => {
    const parsed = updatePassKeySchema.safeParse({ guestEmail: null });
    expect(parsed.success && parsed.data.guestEmail).toBeNull();
  });
});
