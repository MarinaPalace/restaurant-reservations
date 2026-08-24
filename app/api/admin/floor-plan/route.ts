import { NextResponse } from "next/server";
import { isDenied, requireStaff } from "@/lib/auth/guard";
import { getFloorPlan, getFloorPlanMode, setFloorPlan, setFloorPlanMode } from "@/lib/services/settings";
import { recordAuditEntry } from "@/lib/services/audit-log";
import { floorPlanSchema, updateFloorPlanModeSchema } from "@/lib/validation/booking";
import {
  FLOOR_PLAN_MODE_LABELS,
  bookableTables,
  countPlan,
  duplicateLabels,
  resolveFloorPlanMode,
  toFloorPlan,
} from "@/lib/floor-plan";

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
    const [plan, mode] = await Promise.all([getFloorPlan(), getFloorPlanMode()]);

    /**
     * Both the stored policy and the one that actually applies. They differ
     * when the plan holds nothing a guest could be given, and a screen that
     * showed only the stored value would claim guests are choosing tables
     * when nobody is.
     */
    return NextResponse.json({ plan, mode, effectiveMode: resolveFloorPlanMode(mode, plan) });
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
        `Saved the floor plan: ${counted.zones} zone(s), ${counted.tables} table(s), ` +
        `${counted.seats} seat(s) in service.`,
    });

    return NextResponse.json({ plan: saved });
  } catch (error) {
    console.error("[admin] failed to save the floor plan", error);
    return NextResponse.json({ error: "Unable to save the floor plan." }, { status: 500 });
  }
}

/**
 * The switch: whether guests choose their own table — §4, §9 step 2.
 *
 * `floorplan:edit`, checked here rather than only by hiding the control
 * (rule 2.5). It is the same permission as drawing the room because it is the
 * same decision by the same person: what the floor is, and who gets to say
 * where a party sits.
 *
 * Kept off the general settings endpoint, which is guarded by `menu:edit` —
 * whoever prices the wine list has no business turning table selection on.
 */
export async function PATCH(request: Request) {
  const auth = await requireStaff("floorplan:edit");
  if (isDenied(auth)) {
    return auth;
  }

  try {
    const parsed = updateFloorPlanModeSchema.safeParse(await request.json());

    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Unrecognised setting." },
        { status: 400 },
      );
    }

    const { mode } = parsed.data;
    const plan = await getFloorPlan();

    /**
     * Turning it on against an empty room is refused rather than stored.
     *
     * `required` would ask every guest to pick a table and then have none to
     * offer; `optional` would show them an empty room. The reader degrades to
     * off in that case anyway (`resolveFloorPlanMode`), so storing it would be
     * a setting that silently does not apply — worse than being told why.
     */
    if (mode !== "off" && bookableTables(plan).length === 0) {
      return NextResponse.json(
        {
          error:
            "There is no table a guest could be given yet. Draw the room and give each table a " +
            "label — the label is what appears on the service sheet — then turn this on.",
        },
        { status: 409 },
      );
    }

    const saved = await setFloorPlanMode(mode);

    await recordAuditEntry({
      action: "settings:save",
      actor: auth.actor,
      summary: `Set table selection to “${FLOOR_PLAN_MODE_LABELS[saved]}”.`,
    });

    return NextResponse.json({ mode: saved, effectiveMode: resolveFloorPlanMode(saved, plan) });
  } catch (error) {
    console.error("[admin] failed to save the floor plan mode", error);
    return NextResponse.json({ error: "Unable to save the setting." }, { status: 500 });
  }
}
