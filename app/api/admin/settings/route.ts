import { NextResponse } from "next/server";
import { isDenied, requireStaff } from "@/lib/auth/guard";
import { recordAuditEntry } from "@/lib/services/audit-log";
import { getCurrency, getTimeZone, setCurrency, setTimeZone } from "@/lib/services/settings";
import { updateSettingsSchema } from "@/lib/validation/booking";

/**
 * Settings the restaurant can change without a deploy. One so far: the
 * currency promotion prices are quoted in.
 *
 * Guarded by `menu:edit` rather than a permission of its own. The currency is
 * chosen in the promotions editor, beside the prices it applies to, by the
 * same person typing them — a separate permission would only be a way for the
 * two to be granted apart, which helps nobody.
 */
export async function GET() {
  const auth = await requireStaff("menu:edit");
  if (isDenied(auth)) {
    return auth;
  }

  try {
    const [currency, timeZone] = await Promise.all([getCurrency(), getTimeZone()]);
    return NextResponse.json({ currency, timeZone });
  } catch (error) {
    console.error("[admin] failed to read settings", error);
    return NextResponse.json({ error: "Unable to load settings." }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  const auth = await requireStaff("menu:edit");
  if (isDenied(auth)) {
    return auth;
  }

  try {
    const parsed = updateSettingsSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Unrecognised setting." },
        { status: 400 },
      );
    }

    // Only what was sent is written, so saving one setting cannot reset another.
    const changes: string[] = [];

    if (parsed.data.currency !== undefined) {
      changes.push(`promotions currency to ${await setCurrency(parsed.data.currency)}`);
    }

    if (parsed.data.timeZone !== undefined) {
      changes.push(`time zone to ${await setTimeZone(parsed.data.timeZone)}`);
    }

    await recordAuditEntry({
      action: "settings:save",
      actor: auth.actor,
      summary: `Set the ${changes.join(" and the ")}.`,
    });

    const [currency, timeZone] = await Promise.all([getCurrency(), getTimeZone()]);
    return NextResponse.json({ ok: true, currency, timeZone });
  } catch (error) {
    console.error("[admin] failed to save settings", error);
    return NextResponse.json({ error: "Unable to save settings." }, { status: 500 });
  }
}
