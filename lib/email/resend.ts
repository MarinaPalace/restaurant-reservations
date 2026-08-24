import { readEnv } from "@/lib/auth/config";

/**
 * Sending email, through Resend's HTTP API.
 *
 * Deliberately `fetch` rather than the `resend` package: the whole contract is
 * one POST with a JSON body, the SDK would be a dependency in the server bundle
 * for that, and a thin function is far easier to stub in a test than a class
 * that opens its own connections.
 *
 * **Sending never throws.** Every failure — no API key, a rejected address, a
 * provider outage, a network that is not there — comes back as a result the
 * caller can record and show. An invitation email that fails must not fail the
 * thing it accompanies: the key has already been issued, it works, and the link
 * can be copied and pasted by hand. Losing the key because a mail provider had
 * a bad minute would be much worse than an email nobody received.
 */

export type EmailResult =
  | { ok: true; messageId?: string }
  /** Nothing was attempted: the deployment has no mail configuration. */
  | { ok: false; reason: "NOT_CONFIGURED"; message: string }
  /** The provider answered, and said no. `message` is their wording. */
  | { ok: false; reason: "REJECTED"; message: string }
  /** We never got an answer. Worth retrying; the address may be perfectly good. */
  | { ok: false; reason: "UNREACHABLE"; message: string };

export type EmailMessage = {
  to: string;
  subject: string;
  html: string;
  /** Always sent alongside the HTML: some guests read mail as text, and a
   *  text part measurably improves the odds of not being filed as spam. */
  text: string;
  replyTo?: string;
};

/**
 * The endpoint is configurable so the send path can be driven end to end
 * against a local stub. Defaults to Resend, and nothing in production sets it.
 */
const DEFAULT_API_URL = "https://api.resend.com/emails";

export type MailConfig = {
  apiKey: string;
  /** `Vista Del Mar <invitations@example.com>` — Resend requires a verified domain. */
  from: string;
  replyTo?: string;
  apiUrl: string;
};

/** What is missing, in a sentence a member of staff can act on. */
export function describeMailProblem(): string | null {
  if (!readEnv("RESEND_API_KEY")) {
    return "Email is not configured on this server: RESEND_API_KEY is not set.";
  }
  if (!readEnv("INVITATION_FROM_EMAIL")) {
    return "Email is not configured on this server: INVITATION_FROM_EMAIL is not set.";
  }
  return null;
}

export function getMailConfig(): MailConfig | null {
  const apiKey = readEnv("RESEND_API_KEY");
  const from = readEnv("INVITATION_FROM_EMAIL");

  if (!apiKey || !from) {
    return null;
  }

  return {
    apiKey,
    from,
    replyTo: readEnv("INVITATION_REPLY_TO") || undefined,
    apiUrl: readEnv("RESEND_API_URL") || DEFAULT_API_URL,
  };
}

export function isMailConfigured() {
  return getMailConfig() !== null;
}

/** Pulls a usable sentence out of whatever shape the provider answered with. */
function describeRejection(status: number, body: unknown): string {
  if (body && typeof body === "object") {
    const record = body as Record<string, unknown>;
    const message = record.message ?? record.error ?? (record.name as string | undefined);
    if (typeof message === "string" && message.length > 0) {
      return message;
    }
  }
  return `The mail provider refused the message (HTTP ${status}).`;
}

export async function sendEmail(message: EmailMessage): Promise<EmailResult> {
  const config = getMailConfig();

  if (!config) {
    return { ok: false, reason: "NOT_CONFIGURED", message: describeMailProblem() ?? "Email is not configured." };
  }

  try {
    const response = await fetch(config.apiUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: config.from,
        to: [message.to],
        subject: message.subject,
        html: message.html,
        text: message.text,
        ...(message.replyTo ?? config.replyTo ? { reply_to: message.replyTo ?? config.replyTo } : {}),
      }),
      /**
       * A guest is standing at the desk while this runs. Ten seconds is long
       * enough for a slow provider and short enough that reception is not left
       * looking at a spinner wondering whether to press it again.
       */
      signal: AbortSignal.timeout(10_000),
    });

    const body = await response.json().catch(() => null);

    if (!response.ok) {
      return { ok: false, reason: "REJECTED", message: describeRejection(response.status, body) };
    }

    const messageId =
      body && typeof body === "object" && typeof (body as { id?: unknown }).id === "string"
        ? (body as { id: string }).id
        : undefined;

    return { ok: true, messageId };
  } catch (error) {
    // Timeouts and DNS failures land here. The address is not the problem, so
    // the wording says so: this one is worth pressing again.
    return {
      ok: false,
      reason: "UNREACHABLE",
      message: error instanceof Error ? error.message : "The mail provider could not be reached.",
    };
  }
}
