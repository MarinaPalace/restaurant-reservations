import { NextResponse } from "next/server";
import { isDenied, requireStaff } from "@/lib/auth/guard";
import { ShortStayError, issuePassKey, listPassKeys } from "@/lib/services/pass-keys";
import { recordAuditEntry } from "@/lib/services/audit-log";
import { issuePassKeyBatchSchema, issuePassKeySchema } from "@/lib/validation/booking";
import { headers } from "next/headers";
import { formatPassKey } from "@/lib/pass-key";
import { absoluteUrl, passKeyTargetUrl } from "@/lib/pass-key-links";
import { qrDataUris } from "@/lib/qr";
import { sendInvitationEmail } from "@/lib/services/invitations";
import { MINIMUM_STAY_NIGHTS } from "@/types/booking";

export async function GET() {
  const auth = await requireStaff("passkeys:issue");
  if (isDenied(auth)) {
    return auth;
  }

  try {
    return NextResponse.json({ passKeys: await listPassKeys() });
  } catch (error) {
    console.error("[admin] failed to list pass-keys", error);
    return NextResponse.json({ error: "Unable to load pass-keys." }, { status: 500 });
  }
}

/** Issues a key at check-in. */
export async function POST(request: Request) {
  const auth = await requireStaff("passkeys:issue");
  if (isDenied(auth)) {
    return auth;
  }

  try {
    const body = await request.json();

    /**
     * Either a whole morning's arrivals or a single walk-in. The batch shape
     * is tried first; a lone key is the same thing with one row.
     */
    const batch = issuePassKeyBatchSchema.safeParse(body);
    const single = batch.success ? null : issuePassKeySchema.safeParse(body);

    if (!batch.success && !single?.success) {
      const issues = (single ?? batch).error?.issues;
      return NextResponse.json(
        { error: issues?.[0]?.message ?? "Please check the pass-key details." },
        { status: 400 },
      );
    }

    const rows = batch.success ? batch.data.rows : [single!.data!];

    /**
     * Issued one at a time rather than in a bulk write: each key needs its own
     * unique code with its own retry, and each gets its own line in the log so
     * a batch is not one anonymous entry.
     */
    const passKeys = [];
    for (const row of rows) {
      passKeys.push(await issuePassKey({ ...row, actor: auth.actor }));
    }

    for (const [index, passKey] of passKeys.entries()) {
      const exception =
        rows[index].allowShortStay &&
        (passKey.nights ?? 0) < MINIMUM_STAY_NIGHTS &&
        passKey.kind !== "premium";

      // Named by the hotel's booking reference where there is one: it is what
      // survives a guest being moved to another room.
      const whom =
        passKey.reservationRef
          ? `booking ${passKey.reservationRef}`
          : passKey.roomNumber
            ? `room ${passKey.roomNumber}`
            : (passKey.guestName ?? "a guest");

      await recordAuditEntry({
        action: "passkey:issue",
        actor: auth.actor,
        summary:
          `Issued pass-key ${formatPassKey(passKey.code)} to ${whom}` +
          (passKey.nights ? `, ${passKey.nights} night(s)` : "") +
          `, ${passKey.maxUses} dinner(s)` +
          (passKey.expiresOn ? `, valid to ${passKey.expiresOn}` : "") +
          (exception ? " — short stay allowed as an exception" : "") +
          ".",
      });
    }

    /**
     * The QR codes come back with the keys, drawn here rather than in the
     * browser. The card is printed seconds after this response arrives, and an
     * image that still has to be generated or fetched at that moment is an
     * image that prints as an empty square.
     */
    const headerList = await headers();
    const host = headerList.get("x-forwarded-host") ?? headerList.get("host") ?? "";

    /**
     * Invitations are emailed here, after the keys exist and after they have
     * been logged.
     *
     * Order matters: the key is the thing that must survive. A mail provider
     * that is slow, refusing, or simply unconfigured must not cost reception the
     * key they just issued — so sending happens last, cannot throw, and its
     * outcome rides back in the response beside the keys rather than replacing
     * them. Where it failed, the panel offers the link to copy.
     *
     * Sent one at a time on purpose: a batch of invitations is a handful, and
     * each one gets its own line in the log and its own result on screen.
     */
    const invitations: Record<string, { ok: boolean; message: string; invitationUrl: string }> = {};

    for (const [index, passKey] of passKeys.entries()) {
      if (!rows[index].sendInvitation) {
        continue;
      }

      const outcome = await sendInvitationEmail({ passKey, host });
      invitations[passKey.id] = {
        ok: outcome.ok,
        message: outcome.message,
        invitationUrl: outcome.invitationUrl,
      };

      if (outcome.delivery) {
        passKey.invitation = outcome.delivery;
      }

      await recordAuditEntry({
        action: "passkey:issue",
        actor: auth.actor,
        summary:
          `${outcome.ok ? "Emailed" : "Failed to email"} the invitation for ` +
          `${formatPassKey(passKey.code)} to ${outcome.delivery?.to ?? passKey.guestEmail ?? "no address"}` +
          (outcome.ok ? "." : ` — ${outcome.message}`),
      });
    }

    const qrCodes = await qrDataUris(
      passKeys.map((passKey) => ({
        id: passKey.id,
        value: absoluteUrl(
          passKeyTargetUrl(passKey, { bookingUrl: `${host}/booking`, invitationUrl: `${host}/premium` }),
        ),
      })),
    );

    // `passKey` is kept alongside the list so a caller expecting one still
    // works; the UI reads `passKeys`.
    return NextResponse.json({ passKeys, passKey: passKeys[0], qrCodes, invitations }, { status: 201 });
  } catch (error) {
    if (error instanceof ShortStayError) {
      return NextResponse.json(
        {
          error: `Dinner is for guests staying ${MINIMUM_STAY_NIGHTS} nights or more. Tick the exception box to issue one anyway.`,
          code: "SHORT_STAY",
        },
        { status: 409 },
      );
    }

    console.error("[admin] failed to issue a pass-key", error);
    return NextResponse.json({ error: "Unable to issue a pass-key." }, { status: 500 });
  }
}
