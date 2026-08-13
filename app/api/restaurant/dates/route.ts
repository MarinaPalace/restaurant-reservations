import { NextResponse } from "next/server";
import { getRestaurantDates } from "@/lib/services/restaurant";

export async function GET() {
  try {
    const dates = await getRestaurantDates();
    return NextResponse.json(dates);
  } catch {
    return NextResponse.json({ error: "Unable to load restaurant dates." }, { status: 500 });
  }
}
