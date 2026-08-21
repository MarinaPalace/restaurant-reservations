import { NextResponse } from "next/server";
import { isDenied, requireStaff } from "@/lib/auth/guard";
import { recordAuditEntry } from "@/lib/services/audit-log";
import { getCurrency, setCurrency } from "@/lib/services/settings";
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
    return NextResponse.json({ currency: await getCurrency() });
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
        { error: parsed.error.issues[0]?.message ?? "Unrecognised currency." },
        { status: 400 },
      );
    }

    const currency = await setCurrency(parsed.data.currency);

    await recordAuditEntry({
      action: "settings:save",
      actor: auth.actor,
      summary: `Set the promotions currency to ${currency}.`,
    });

    return NextResponse.json({ ok: true, currency });
  } catch (error) {
    console.error("[admin] failed to save settings", error);
    return NextResponse.json({ error: "Unable to save settings." }, { status: 500 });
  }
}
