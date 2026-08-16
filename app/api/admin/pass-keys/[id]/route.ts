import { NextResponse } from "next/server";
import { isDenied, requireStaff } from "@/lib/auth/guard";
import { UpdatePassKeyError, updatePassKey } from "@/lib/services/pass-keys";
import { recordAuditEntry } from "@/lib/services/audit-log";
import { updatePassKeySchema } from "@/lib/validation/booking";
import { formatPassKey } from "@/lib/pass-key";

/**
 * Changes a key that is already in a guest's hand.
 *
 * The case this exists for is a stay being extended: the guest keeps the card
 * they were given, and reception moves the expiry rather than issuing a second
 * key and leaving two live codes for one room.
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireStaff("passkeys:issue");
  if (isDenied(auth)) {
    return auth;
  }

  try {
    const { id } = await params;
    const parsed = updatePassKeySchema.safeParse(await request.json());

    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Please check the pass-key details." },
        { status: 400 },
      );
    }

    const { before, after } = await updatePassKey(id, parsed.data);

    const changes: string[] = [];
    if (parsed.data.expiresOn !== undefined && before.expiresOn !== after.expiresOn) {
      changes.push(`valid until ${before.expiresOn ?? "no expiry"} → ${after.expiresOn ?? "no expiry"}`);
    }
    if (parsed.data.maxUses !== undefined && before.maxUses !== after.maxUses) {
      changes.push(`dinners ${before.maxUses} → ${after.maxUses}`);
    }
    if (parsed.data.note !== undefined) {
      changes.push("note");
    }

    await recordAuditEntry({
      action: "passkey:issue",
      actor: auth.actor,
      summary: `Updated pass-key ${formatPassKey(after.code)}: ${changes.join(", ") || "no visible change"}.`,
    });

    return NextResponse.json({ passKey: after });
  } catch (error) {
    if (error instanceof UpdatePassKeyError) {
      const messages = {
        NOT_FOUND: "That pass-key no longer exists.",
        BELOW_USED: "That key has already booked more dinners than you are allowing. Raise the number, or cancel a booking first.",
      } as const;

      return NextResponse.json(
        { error: messages[error.code], code: error.code },
        { status: error.code === "NOT_FOUND" ? 404 : 409 },
      );
    }

    console.error("[admin] failed to update a pass-key", error);
    return NextResponse.json({ error: "Unable to update this pass-key." }, { status: 500 });
  }
}
