import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildInvitationEmail } from "@/lib/email/invitation";
import { absoluteUrl } from "@/lib/pass-key-links";

const KEY = {
  code: "K7QP3M2XR4",
  guestName: "Maria Petrova",
  expiresOn: "2026-09-20",
  maxUses: 1,
  maxGuests: 2,
};

describe("the invitation email", () => {
  const message = buildInvitationEmail({
    to: "maria@example.com",
    passKey: KEY,
    invitationUrl: "https://vistadelmar.example/premium/VDM-K7QP3-M2XR4",
    restaurantName: "Vista Del Mar",
  });

  it("is addressed and titled without leaking the code", () => {
    expect(message.to).toBe("maria@example.com");
    expect(message.subject).toBe("Your invitation to dine at Vista Del Mar");
    // Subjects appear on lock screens and get quoted into replies.
    expect(message.subject).not.toContain("K7QP3");
  });

  it("carries the link in both parts, because mail clients differ", () => {
    expect(message.html).toContain("https://vistadelmar.example/premium/VDM-K7QP3-M2XR4");
    expect(message.text).toContain("https://vistadelmar.example/premium/VDM-K7QP3-M2XR4");
  });

  it("writes the code out as well, for a client that eats links", () => {
    expect(message.html).toContain("VDM-K7QP3-M2XR4");
    expect(message.text).toContain("VDM-K7QP3-M2XR4");
  });

  it("greets the guest by first name and says what they are offered", () => {
    expect(message.text).toContain("Dear Maria,");
    expect(message.text).toContain("up to 2 guests");
    expect(message.text).toContain("20 September 2026");
  });

  it("greets a nameless invitation without leaving a gap", () => {
    const anonymous = buildInvitationEmail({
      to: "someone@example.com",
      passKey: { ...KEY, guestName: undefined },
      invitationUrl: "https://example.test/premium/VDM-K7QP3-M2XR4",
      restaurantName: "Vista Del Mar",
    });

    expect(anonymous.text).toContain("Dear guest,");
  });

  it("names the number of dinners when a key carries several", () => {
    const twoDinners = buildInvitationEmail({
      to: "someone@example.com",
      passKey: { ...KEY, maxUses: 2 },
      invitationUrl: "https://example.test/premium/VDM-K7QP3-M2XR4",
      restaurantName: "Vista Del Mar",
    });

    expect(twoDinners.text).toContain("2 dinners");
  });

  /** A name with a quote or a tag in it must not escape its attribute. */
  it("escapes what it puts into HTML", () => {
    const hostile = buildInvitationEmail({
      to: "someone@example.com",
      passKey: { ...KEY, guestName: "\"><script>alert(1)</script>" },
      invitationUrl: "https://example.test/premium/VDM-K7QP3-M2XR4",
      restaurantName: "Vista Del Mar",
    });

    expect(hostile.html).not.toContain("<script>");
    expect(hostile.html).toContain("&lt;script&gt;");
  });
});

describe("absolute links", () => {
  it("leaves a real host on https", () => {
    expect(absoluteUrl("vistadelmar.example/premium/X")).toBe("https://vistadelmar.example/premium/X");
  });

  /** Development is exactly where an emailed link is tested first. */
  it("keeps a local host on http, where https is a dead link", () => {
    expect(absoluteUrl("localhost:3000/premium/X")).toBe("http://localhost:3000/premium/X");
    expect(absoluteUrl("127.0.0.1:3000/premium/X")).toBe("http://127.0.0.1:3000/premium/X");
  });

  it("does not touch an address that already has a scheme", () => {
    expect(absoluteUrl("http://example.test/x")).toBe("http://example.test/x");
    expect(absoluteUrl("https://example.test/x")).toBe("https://example.test/x");
  });
});

describe("sending through Resend", () => {
  const message = { to: "guest@example.com", subject: "Subject", html: "<p>Hi</p>", text: "Hi" };

  beforeEach(() => {
    vi.resetModules();
    process.env.RESEND_API_KEY = "re_test_key";
    process.env.INVITATION_FROM_EMAIL = "Vista Del Mar <invitations@example.test>";
    process.env.RESEND_API_URL = "https://api.example.test/emails";
    delete process.env.INVITATION_REPLY_TO;
  });

  afterEach(() => {
    delete process.env.RESEND_API_KEY;
    delete process.env.INVITATION_FROM_EMAIL;
    delete process.env.RESEND_API_URL;
    vi.unstubAllGlobals();
  });

  async function load() {
    return import("@/lib/email/resend");
  }

  it("posts the message to the provider, with the key in the header", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: "msg_1" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const { sendEmail } = await load();
    const result = await sendEmail(message);

    expect(result).toEqual({ ok: true, messageId: "msg_1" });

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.example.test/emails");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer re_test_key");

    const sent = JSON.parse(String(init.body));
    expect(sent.from).toBe("Vista Del Mar <invitations@example.test>");
    expect(sent.to).toEqual(["guest@example.com"]);
    // Both parts, always: some guests read mail as text, and it helps with
    // spam filters.
    expect(sent.html).toBe("<p>Hi</p>");
    expect(sent.text).toBe("Hi");
    expect(sent.reply_to).toBeUndefined();
  });

  it("passes a reply-to address when one is configured", async () => {
    process.env.INVITATION_REPLY_TO = "reservations@example.test";
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: "msg_2" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const { sendEmail } = await load();
    await sendEmail(message);

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body)).reply_to).toBe("reservations@example.test");
  });

  /**
   * The whole point of the result type: nothing in here throws into the caller,
   * which has already issued a key that works.
   */
  it("reports a refusal in the provider's own words", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ message: "Invalid recipient." }), { status: 422 })),
    );

    const { sendEmail } = await load();
    expect(await sendEmail(message)).toEqual({
      ok: false,
      reason: "REJECTED",
      message: "Invalid recipient.",
    });
  });

  it("falls back to a plain sentence when a refusal says nothing useful", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 500 })));

    const { sendEmail } = await load();
    const result = await sendEmail(message);

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toBe("REJECTED");
    expect(result.ok === false && result.message).toContain("HTTP 500");
  });

  it("reports an unreachable provider separately, since that one is worth retrying", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      }),
    );

    const { sendEmail } = await load();
    expect(await sendEmail(message)).toEqual({
      ok: false,
      reason: "UNREACHABLE",
      message: "network down",
    });
  });

  it("attempts nothing at all when the server has no mail configuration", async () => {
    delete process.env.RESEND_API_KEY;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const { sendEmail, isMailConfigured } = await load();
    const result = await sendEmail(message);

    expect(isMailConfigured()).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toBe("NOT_CONFIGURED");
    expect(result.ok === false && result.message).toContain("RESEND_API_KEY");
  });

  it("says which piece is missing when only the from address is unset", async () => {
    delete process.env.INVITATION_FROM_EMAIL;

    const { sendEmail } = await load();
    const result = await sendEmail(message);

    expect(result.ok === false && result.message).toContain("INVITATION_FROM_EMAIL");
  });
});
