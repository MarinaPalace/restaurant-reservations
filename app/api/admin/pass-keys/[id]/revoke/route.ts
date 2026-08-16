import { NextResponse } from "next/server";
import { isDenied, requireStaff } from "@/lib/auth/guard";
import { revokePassKey } from "@/lib/services/pass-keys";
import { recordAuditEntry } from "@/lib/services/audit-log";
import { formatPassKey } from "@/lib/pass-key";

/**
 * Withdraws a key — a slip left on a desk, a guest who checked out early.
 *
 * Revoking does not touch any reservation already made with it. Cancelling the
 * dinner is a separate decision, and doing it silently here would take a table
 * away from a guest who is still expecting one.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireStaff("passkeys:issue");
  if (isDenied(auth)) {
    return auth;
  }

  try {
    const { id } = await params;
    const revoked = await revokePassKey(id);

    if (!revoked) {
      return NextResponse.json({ error: "Pass-key not found." }, { status: 404 });
    }

    await recordAuditEntry({
      action: "passkey:revoke",
      actor: auth.actor,
      // The first booking it paid for, so the key's withdrawal shows up on
      // that reservation's own history.
      reservationNumber: revoked.reservationNumbers[0],
      summary:
        `Revoked pass-key ${formatPassKey(revoked.code)}` +
        (revoked.reservationNumbers.length ? ` (had booked ${revoked.reservationNumbers.join(", ")})` : "") +
        ".",
    });

    return NextResponse.json({ passKey: revoked });
  } catch (error) {
    console.error("[admin] failed to revoke a pass-key", error);
    return NextResponse.json({ error: "Unable to revoke this pass-key." }, { status: 500 });
  }
}
