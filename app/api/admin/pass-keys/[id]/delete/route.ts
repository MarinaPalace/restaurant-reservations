import { NextResponse } from "next/server";
import { isDenied, requireStaff } from "@/lib/auth/guard";
import { deletePassKey } from "@/lib/services/pass-keys";
import { recordAuditEntry } from "@/lib/services/audit-log";
import { formatPassKey } from "@/lib/pass-key";

/**
 * Erases a pass-key.
 *
 * Reserved for administrators, like deleting a reservation, because it cannot
 * be undone. Revoking is the everyday action and keeps the record; this is for
 * keys that should never have existed — a misprint, a test row.
 *
 * A booking already made with it keeps its own record. It loses the key it
 * pointed at, so that guest can no longer change it themselves and reception
 * handles them — exactly as for a booking taken at the desk.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireStaff("reservations:delete");
  if (isDenied(auth)) {
    return auth;
  }

  try {
    const { id } = await params;
    const removed = await deletePassKey(id);

    if (!removed) {
      return NextResponse.json({ error: "Pass-key not found." }, { status: 404 });
    }

    // The log outlives the record, so "where did that key go?" is answerable.
    await recordAuditEntry({
      action: "passkey:revoke",
      actor: auth.actor,
      reservationNumber: removed.reservationNumbers[0],
      summary:
        `Permanently deleted pass-key ${formatPassKey(removed.code)}` +
        (removed.reservationNumbers.length
          ? ` (had booked ${removed.reservationNumbers.join(", ")})`
          : "") +
        ".",
    });

    return NextResponse.json({ passKey: removed });
  } catch (error) {
    console.error("[admin] failed to delete a pass-key", error);
    return NextResponse.json({ error: "Unable to delete this pass-key." }, { status: 500 });
  }
}
