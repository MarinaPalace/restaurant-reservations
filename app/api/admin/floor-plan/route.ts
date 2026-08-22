import { NextResponse } from "next/server";
import { isDenied, requireStaff } from "@/lib/auth/guard";
import { getFloorPlan, setFloorPlan } from "@/lib/services/settings";
import { recordAuditEntry } from "@/lib/services/audit-log";
import { floorPlanSchema } from "@/lib/validation/booking";
import { countPlan, duplicateLabels, toFloorPlan } from "@/lib/floor-plan";

/**
 * The room staff drew.
 *
 * Reading needs only a signed-in account — the board and the sheet will want
 * it, and it says nothing about any guest. Writing needs `floorplan:edit`, and
 * that is checked here rather than only by hiding the page (rule 2.5).
 */
export async function GET() {
  const auth = await requireStaff();
  if (isDenied(auth)) {
    return auth;
  }

  try {
    return NextResponse.json({ plan: await getFloorPlan() });
  } catch (error) {
    console.error("[admin] failed to read the floor plan", error);
    return NextResponse.json({ error: "Unable to load the floor plan." }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  const auth = await requireStaff("floorplan:edit");
  if (isDenied(auth)) {
    return auth;
  }

  try {
    const parsed = floorPlanSchema.safeParse(await request.json());

    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Please check the floor plan." },
        { status: 400 },
      );
    }

    const plan = toFloorPlan(parsed.data);

    /**
     * The one thing a half-finished plan may not do.
     *
     * A table with no label yet is fine — it is a room somebody is still
     * drawing, and refusing to save that would lose their work. Two tables
     * answering to the same label is different: the label is what gets written
     * onto a booking as `tableNumber`, so the sheet would stop being able to
     * say where a party is sitting.
     */
    const duplicates = duplicateLabels(plan);

    if (duplicates.length > 0) {
      return NextResponse.json(
        {
          error:
            `More than one table is labelled ${duplicates.map((label) => `“${label}”`).join(", ")}. ` +
            "Labels are what appear on the service sheet, so they have to be unique across the whole plan.",
        },
        { status: 409 },
      );
    }

    const saved = await setFloorPlan(plan);
    const counted = countPlan(saved);

    await recordAuditEntry({
      action: "settings:save",
      actor: auth.actor,
      summary:
        `Saved the floor plan: ${counted.rooms} room(s), ${counted.tables} table(s), ` +
        `${counted.seats} seat(s) in service.`,
    });

    return NextResponse.json({ plan: saved });
  } catch (error) {
    console.error("[admin] failed to save the floor plan", error);
    return NextResponse.json({ error: "Unable to save the floor plan." }, { status: 500 });
  }
}
