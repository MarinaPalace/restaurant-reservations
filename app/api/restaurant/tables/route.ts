import { NextResponse } from "next/server";
import { getRestaurantDate } from "@/lib/services/restaurant";
import { getEveningFeatures, getFloorPlan } from "@/lib/services/settings";
import { listTableClaims } from "@/lib/services/table-claims";
import { offerTables } from "@/lib/floor-plan-availability";
import { isValidDateKey } from "@/lib/date";
import { MAX_GUESTS_PER_RESERVATION } from "@/lib/validation/booking";

/**
 * The room, as a guest booking a given evening for a given party may see it.
 *
 * ## Public, and carefully so
 *
 * No pass-key is asked for. The plan is the restaurant's own furniture, and a
 * guest has to be able to see it before they have committed to anything — the
 * date and guest steps come first and neither authenticates.
 *
 * What makes that safe is the **shape** of the answer rather than a filter over
 * it: `offerTables` builds objects that have no room number, no name, no
 * reservation number and no seat count taken. There is nothing here to leak,
 * which is a stronger guarantee than remembering not to send it.
 *
 * ## The mode is resolved per evening
 *
 * Off means off, and answers `{ mode: "off", zones: [] }` rather than a plan —
 * an evening not offering table selection must not hand out its furniture to a
 * screen that would then show a picker nobody switched on.
 */
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const date = url.searchParams.get("date") ?? "";
    const guests = Number(url.searchParams.get("guests") ?? "0");

    if (!isValidDateKey(date)) {
      return NextResponse.json({ error: "Invalid date." }, { status: 400 });
    }

    if (!Number.isInteger(guests) || guests < 1 || guests > MAX_GUESTS_PER_RESERVATION) {
      return NextResponse.json({ error: "Invalid party size." }, { status: 400 });
    }

    const evening = await getRestaurantDate(date);
    const features = await getEveningFeatures(evening);

    if (features.tableSelection === "off") {
      return NextResponse.json({ mode: "off", zones: [] });
    }

    /**
     * The plan and what is already claimed, read together. They are two reads
     * either way; taking them at once keeps the window in which a table can be
     * claimed between them as small as it can be — and the claim itself is
     * conditional, so a stale answer here costs a `409` rather than a
     * double-booked table.
     */
    const [plan, claims] = await Promise.all([getFloorPlan(), listTableClaims(date)]);

    return NextResponse.json({
      mode: features.tableSelection,
      zones: offerTables(plan, claims, guests),
    });
  } catch (error) {
    console.error("[restaurant] failed to load the room", error);
    return NextResponse.json({ error: "Unable to load the room." }, { status: 500 });
  }
}
