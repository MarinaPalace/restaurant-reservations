import { NextResponse } from "next/server";
import { getRestaurantDate } from "@/lib/services/restaurant";
import { getEveningFeatures } from "@/lib/services/settings";
import { isValidDateKey } from "@/lib/date";

export async function GET(_request: Request, { params }: { params: Promise<{ date: string }> }) {
  try {
    const { date } = await params;

    if (!isValidDateKey(date)) {
      return NextResponse.json({ error: "Invalid date." }, { status: 400 });
    }

    const record = await getRestaurantDate(date);
    if (!record) {
      return NextResponse.json({ error: "Date not found." }, { status: 404 });
    }

    // Spread, then overwrite: the resolved switches replace the raw overrides
    // the record carries. Resolved and never raw — see the sibling route.
    return NextResponse.json({ ...record, features: await getEveningFeatures(record) });
  } catch (error) {
    console.error("[restaurant] failed to load availability", error);
    return NextResponse.json({ error: "Unable to load availability." }, { status: 500 });
  }
}
