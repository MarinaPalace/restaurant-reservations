import { NextResponse } from "next/server";
import { isDenied, requireStaff } from "@/lib/auth/guard";
import { EVENING_FEATURE_PERMISSIONS, hasPermission } from "@/lib/auth/permissions";
import { recordAuditEntry } from "@/lib/services/audit-log";
import { getEveningDefaults, setEveningToggles, setFloorPlanMode } from "@/lib/services/settings";
import { getFloorPlan } from "@/lib/services/settings";
import { updateEveningDefaultsSchema } from "@/lib/validation/booking";
import {
  EVENING_FEATURE_LABELS,
  type EveningFeature,
  type EveningToggles,
} from "@/lib/evening-features";
import { FLOOR_PLAN_MODE_LABELS, bookableTables } from "@/lib/floor-plan";

/**
 * What the restaurant does on an evening that does not say otherwise —
 * `lib/evening-features.ts`.
 *
 * The other half of the date editor's "this evening only" switches. Both grains
 * are written through routes that ask for **a permission per switch moved**
 * rather than one blanket permission for the screen, because deciding that
 * guests pick their own tables and deciding that they telephone reception are
 * different decisions by different people.
 *
 * Table selection is stored under its own key and set through
 * `setFloorPlanMode`, unchanged from `docs/floor-plan.md` §15 — rule 2.2 says
 * schema changes are additive, and moving a live setting into a new document to
 * make one type tidier is a migration bought with nothing.
 */
export async function GET() {
  // Reading what the restaurant normally does is what the calendar screen
  // does; any signed-in member of staff may. Changing it is the guarded act.
  const auth = await requireStaff();
  if (isDenied(auth)) {
    return auth;
  }

  try {
    return NextResponse.json(await getEveningDefaults());
  } catch (error) {
    console.error("[admin] failed to read the evening defaults", error);
    return NextResponse.json({ error: "Unable to load the settings." }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  const auth = await requireStaff();
  if (isDenied(auth)) {
    return auth;
  }

  try {
    const parsed = updateEveningDefaultsSchema.safeParse(await request.json());

    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Unrecognised setting." },
        { status: 400 },
      );
    }

    const before = await getEveningDefaults();

    /**
     * Only what was sent, and only what it actually moves. Saving one switch
     * must not rewrite another — the same rule the settings route follows — and
     * a payload that repeats a switch at its current value asks for no
     * permission, because it is not a change.
     */
    const moved = (Object.keys(parsed.data) as EveningFeature[]).filter(
      (feature) => parsed.data[feature] !== undefined && parsed.data[feature] !== before[feature],
    );

    if (moved.length === 0) {
      return NextResponse.json(before);
    }

    const missing = moved.filter((feature) => !hasPermission(auth.user, EVENING_FEATURE_PERMISSIONS[feature]));

    if (missing.length > 0) {
      return NextResponse.json(
        {
          error:
            `Your account cannot change ${missing.map((feature) => `“${EVENING_FEATURE_LABELS[feature]}”`).join(", ")}. ` +
            "Ask an administrator if you need it.",
          code: "FORBIDDEN",
        },
        { status: 403 },
      );
    }

    /**
     * Turning table selection on against an empty room is refused rather than
     * stored, exactly as the floor-plan route refuses it: `required` would ask
     * every guest to pick a table and then have none to offer, and the reader
     * degrades it to off anyway — so storing it would be a setting that
     * silently does not apply, which is worse than being told why.
     */
    if (parsed.data.tableSelection !== undefined && parsed.data.tableSelection !== "off") {
      if (bookableTables(await getFloorPlan()).length === 0) {
        return NextResponse.json(
          {
            error:
              "There is no table a guest could be given yet. Draw the room and give each table a " +
              "label — the label is what appears on the service sheet — then turn this on.",
          },
          { status: 409 },
        );
      }
    }

    const said: string[] = [];

    if (moved.includes("tableSelection") && parsed.data.tableSelection !== undefined) {
      const saved = await setFloorPlanMode(parsed.data.tableSelection);
      said.push(`table selection to “${FLOOR_PLAN_MODE_LABELS[saved]}”`);
    }

    const toggles = (["promotions", "selfService"] as const).filter((feature) => moved.includes(feature));

    if (toggles.length > 0) {
      const next: EveningToggles = {
        promotions: parsed.data.promotions ?? before.promotions,
        selfService: parsed.data.selfService ?? before.selfService,
      };

      await setEveningToggles(next);

      for (const feature of toggles) {
        said.push(`${EVENING_FEATURE_LABELS[feature].toLowerCase()} ${next[feature] ? "on" : "off"}`);
      }
    }

    await recordAuditEntry({
      action: "settings:save",
      actor: auth.actor,
      summary: `Set the restaurant default for ${said.join(" and ")}. Evenings that say otherwise are unaffected.`,
    });

    return NextResponse.json(await getEveningDefaults());
  } catch (error) {
    console.error("[admin] failed to save the evening defaults", error);
    return NextResponse.json({ error: "Unable to save the settings." }, { status: 500 });
  }
}
