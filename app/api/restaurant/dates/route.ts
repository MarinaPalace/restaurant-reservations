import { NextResponse } from "next/server";
import { getRestaurantDates } from "@/lib/services/restaurant";
import { getEveningDefaults } from "@/lib/services/settings";
import { getFloorPlan } from "@/lib/services/settings";
import { resolveEveningFeatures } from "@/lib/evening-features";
import { todayKey } from "@/lib/date";

/**
 * The evenings a guest may book.
 *
 * Each one carries its switches **resolved** — what is actually true for that
 * night, inheritance and the floor plan already accounted for — rather than the
 * raw overrides it happens to store. A screen handed "this evening says
 * nothing" would have to know the restaurant defaults to make sense of it, and
 * a second reader of the same two halves is a second chance for them to
 * disagree (`lib/evening-features.ts`).
 */
export async function GET() {
  try {
    const [dates, defaults, plan] = await Promise.all([
      getRestaurantDates(),
      getEveningDefaults(),
      getFloorPlan(),
    ]);
    // Past evenings are never bookable, so they are not offered to guests.
    const today = todayKey();

    // Premium evenings belong to the invitation flow at /premium.
    return NextResponse.json(
      dates
        .filter((entry) => entry.date >= today && !entry.premium)
        .map(({ features, ...entry }) => ({
          ...entry,
          features: resolveEveningFeatures(defaults, features, plan),
        })),
    );
  } catch (error) {
    console.error("[restaurant] failed to load dates", error);
    return NextResponse.json({ error: "Unable to load restaurant dates." }, { status: 500 });
  }
}
