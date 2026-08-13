import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { z } from "zod";
import { getRestaurantDates } from "@/lib/services/restaurant";
import { updateRestaurantDate } from "@/lib/services/reservations";

const dateSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  isOpen: z.boolean(),
  capacity: z.number().int().positive(),
});

export async function GET() {
  const cookieStore = await cookies();
  const isAuthenticated = cookieStore.get("admin-auth")?.value === "true";
  if (!isAuthenticated) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const dates = await getRestaurantDates();
  return NextResponse.json(dates);
}

export async function POST(request: Request) {
  const cookieStore = await cookies();
  const isAuthenticated = cookieStore.get("admin-auth")?.value === "true";
  if (!isAuthenticated) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const parsed = dateSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid restaurant date settings." }, { status: 400 });
    }

    const result = await updateRestaurantDate(parsed.data);
    return NextResponse.json(result, { status: 201 });
  } catch {
    return NextResponse.json({ error: "Unable to update date." }, { status: 500 });
  }
}
