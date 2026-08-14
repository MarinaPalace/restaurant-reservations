import { NextResponse } from "next/server";
import { getRestaurantDates } from "@/lib/services/restaurant";
import { todayKey } from "@/lib/date";

export async function GET() {
  try {
    const dates = await getRestaurantDates();
    // Past evenings are never bookable, so they are not offered to guests.
    const today = todayKey();

    return NextResponse.json(dates.filter((entry) => entry.date >= today));
  } catch (error) {
    console.error("[restaurant] failed to load dates", error);
    return NextResponse.json({ error: "Unable to load restaurant dates." }, { status: 500 });
  }
}
