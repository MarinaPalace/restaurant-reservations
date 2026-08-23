import { NextResponse } from "next/server";
import { isDenied, requireStaff } from "@/lib/auth/guard";
import { EVENING_FEATURE_PERMISSIONS, hasPermission } from "@/lib/auth/permissions";
import { recordAuditEntry } from "@/lib/services/audit-log";
import { getRestaurantDate, getRestaurantDates } from "@/lib/services/restaurant";
import { updateRestaurantDate } from "@/lib/services/reservations";
import { restaurantDateSchema } from "@/lib/validation/booking";
import { EVENING_FEATURE_LABELS, changedFeatures, describeOverrides, toEveningOverrides } from "@/lib/evening-features";

export async function GET() {
  // Reading availability is what the dashboard does; any signed-in member of
  // staff may. Changing it is the guarded action.
  const auth = await requireStaff();
  if (isDenied(auth)) {
    return auth;
  }

  try {
    return NextResponse.json(await getRestaurantDates());
  } catch (error) {
    console.error("[admin] failed to load dates", error);
    return NextResponse.json({ error: "Unable to load restaurant dates." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const auth = await requireStaff("dates:manage");
  if (isDenied(auth)) {
    return auth;
  }

  try {
    const parsed = restaurantDateSchema.safeParse(await request.json());

    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid restaurant date settings." },
        { status: 400 },
      );
    }

    /**
     * Three-way, and the reason the payload allows null.
     *
     * Absent means the sender is not talking about the evening's switches and
     * whatever it already said must survive — an editor built before overrides
     * existed must not wipe them by omission, which is exactly the bug
     * `toRestaurantDatePayload` carries a comment about. Null, or an object
     * with nothing recognisable in it, means "follow the restaurant again".
     */
    const { features, ...rest } = parsed.data;
    const wanted = features === undefined ? undefined : (toEveningOverrides(features) ?? null);

    /**
     * A permission per switch actually moved, asked for before anything is
     * written. Reading the evening back first costs one query on a save that
     * almost never touches these, and buys the difference between "this account
     * may edit the calendar" and "this account may decide the room policy".
     */
    if (wanted !== undefined) {
      const before = await getRestaurantDate(parsed.data.date);
      const moved = changedFeatures(before?.features, wanted ?? undefined);
      const missing = moved.filter((feature) => !hasPermission(auth.user, EVENING_FEATURE_PERMISSIONS[feature]));

      if (missing.length > 0) {
        return NextResponse.json(
          {
            error:
              `Your account cannot change ${missing.map((feature) => `“${EVENING_FEATURE_LABELS[feature]}”`).join(", ")} ` +
              "for one evening. Ask an administrator if you need it.",
            code: "FORBIDDEN",
          },
          { status: 403 },
        );
      }
    }

    const date = await updateRestaurantDate({ ...rest, features: wanted });

    const said = describeOverrides(date.features);

    await recordAuditEntry({
      action: "date:update",
      actor: auth.actor,
      summary:
        `Set ${date.date} to ${date.isOpen ? "open" : "closed"}, ` +
        `capacity ${date.capacity}${date.premium ? ", invited guests only" : ""}` +
        // Only mentioned when the evening disagrees with the restaurant, so an
        // ordinary save reads exactly as it always did in the log.
        `${said.length > 0 ? `. This evening only: ${said.join(", ")}` : ""}.`,
    });

    return NextResponse.json(date);
  } catch (error) {
    console.error("[admin] failed to update date", error);
    return NextResponse.json({ error: "Unable to update date." }, { status: 500 });
  }
}
