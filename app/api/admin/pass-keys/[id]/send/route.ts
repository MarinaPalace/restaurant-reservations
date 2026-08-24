import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { isDenied, requireStaff } from "@/lib/auth/guard";
import { getPassKeyById } from "@/lib/services/pass-keys";
import { sendInvitationEmail } from "@/lib/services/invitations";
import { recordAuditEntry } from "@/lib/services/audit-log";
import { sendInvitationSchema } from "@/lib/validation/booking";
import { formatPassKey } from "@/lib/pass-key";

/**
 * Sends an invitation again — the same email, to the address on the key or to a
 * corrected one.
 *
 * This exists because email fails, and a guest waiting on an invitation is not
 * something reception can shrug at. A mistyped address, a mailbox that was full
 * an hour ago, a provider having a bad minute: all of them end with somebody at
 * the desk needing to press send once more.
 *
 * Deliberately not rate-limited or capped. Reception pressing it four times
 * means the address is wrong, and the attempt counter on the key says so where
 * they can see it; refusing the fifth press would only make them ring the guest
 * to read out a fifteen-character code instead.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireStaff("passkeys:issue");
  if (isDenied(auth)) {
    return auth;
  }

  try {
    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const parsed = sendInvitationSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Please check the email address." },
        { status: 400 },
      );
    }

    const passKey = await getPassKeyById(id);
    if (!passKey) {
      return NextResponse.json({ error: "Pass-key not found." }, { status: 404 });
    }

    const headerList = await headers();
    const host = headerList.get("x-forwarded-host") ?? headerList.get("host") ?? "";

    const outcome = await sendInvitationEmail({ passKey, to: parsed.data.email, host });

    /**
     * Logged either way, and named by address rather than by code: "we sent it
     * three times to the wrong address" is the story the log has to be able to
     * tell a week later.
     */
    await recordAuditEntry({
      action: "passkey:issue",
      actor: auth.actor,
      summary:
        `${outcome.ok ? "Sent" : "Failed to send"} the invitation for ` +
        `${formatPassKey(passKey.code)} to ${outcome.delivery?.to ?? parsed.data.email ?? "no address"}` +
        (outcome.ok ? "" : ` — ${outcome.message}`),
    });

    // 200 even when the provider refused: the request was handled, and the body
    // says what happened. A 502 here would have the UI show a network error
    // instead of the address that bounced.
    return NextResponse.json({
      ok: outcome.ok,
      message: outcome.message,
      invitationUrl: outcome.invitationUrl,
      passKey: { ...passKey, invitation: outcome.delivery ?? passKey.invitation },
    });
  } catch (error) {
    console.error("[admin] failed to send an invitation", error);
    return NextResponse.json({ error: "Unable to send this invitation." }, { status: 500 });
  }
}
