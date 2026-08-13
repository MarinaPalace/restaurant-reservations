import { NextResponse } from "next/server";
import { getRestaurantDate } from "@/lib/services/restaurant";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ date: string }> },
) {
  try {
    const { date } = await params;
    const record = await getRestaurantDate(date);
    if (!record) {
      return NextResponse.json({ error: "Date not found." }, { status: 404 });
    }
    return NextResponse.json(record);
  } catch {
    return NextResponse.json({ error: "Unable to load availability." }, { status: 500 });
  }
}
