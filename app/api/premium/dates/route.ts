import { NextResponse } from "next/server";
import { getRestaurantDates } from "@/lib/services/restaurant";
import { todayKey } from "@/lib/date";

/** Only the evenings opened for invited guests. */
export async function GET() {
  try {
    const dates = await getRestaurantDates();
    const today = todayKey();

    return NextResponse.json(dates.filter((entry) => entry.premium && entry.date >= today));
  } catch (error) {
    console.error("[premium] failed to load dates", error);
    return NextResponse.json({ error: "Unable to load the available evenings." }, { status: 500 });
  }
}
