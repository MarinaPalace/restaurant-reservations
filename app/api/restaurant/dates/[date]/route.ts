import { NextResponse } from "next/server";
import { getRestaurantDate } from "@/lib/services/restaurant";
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

    return NextResponse.json(record);
  } catch (error) {
    console.error("[restaurant] failed to load availability", error);
    return NextResponse.json({ error: "Unable to load availability." }, { status: 500 });
  }
}
