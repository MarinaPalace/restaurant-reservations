import { NextResponse } from "next/server";
import { isDenied, requireStaff } from "@/lib/auth/guard";
import { ShortStayError, issuePassKey, listPassKeys } from "@/lib/services/pass-keys";
import { recordAuditEntry } from "@/lib/services/audit-log";
import { issuePassKeySchema } from "@/lib/validation/booking";
import { formatPassKey } from "@/lib/pass-key";
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
    const parsed = issuePassKeySchema.safeParse(await request.json());

    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Please check the pass-key details." },
        { status: 400 },
      );
    }

    const passKey = await issuePassKey({ ...parsed.data, actor: auth.actor });

    const whom = passKey.roomNumber ? `room ${passKey.roomNumber}` : (passKey.guestName ?? "a guest");
    const exception = parsed.data.allowShortStay && (passKey.nights ?? 0) < MINIMUM_STAY_NIGHTS;

    await recordAuditEntry({
      action: "passkey:issue",
      actor: auth.actor,
      summary:
        `Issued pass-key ${formatPassKey(passKey.code)} to ${whom}` +
        (passKey.nights ? `, ${passKey.nights} night(s)` : "") +
        (exception ? " — short stay allowed as an exception" : "") +
        ".",
    });

    return NextResponse.json({ passKey }, { status: 201 });
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
