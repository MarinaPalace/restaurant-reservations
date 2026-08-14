import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/auth/guard";
import { getRestaurantDates } from "@/lib/services/restaurant";
import { updateRestaurantDate } from "@/lib/services/reservations";
import { restaurantDateSchema } from "@/lib/validation/booking";

export async function GET() {
  const unauthorized = await requireAdminApi();
  if (unauthorized) {
    return unauthorized;
  }

  try {
    return NextResponse.json(await getRestaurantDates());
  } catch (error) {
    console.error("[admin] failed to load dates", error);
    return NextResponse.json({ error: "Unable to load restaurant dates." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const unauthorized = await requireAdminApi();
  if (unauthorized) {
    return unauthorized;
  }

  try {
    const parsed = restaurantDateSchema.safeParse(await request.json());

    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid restaurant date settings." },
        { status: 400 },
      );
    }

    return NextResponse.json(await updateRestaurantDate(parsed.data));
  } catch (error) {
    console.error("[admin] failed to update date", error);
    return NextResponse.json({ error: "Unable to update date." }, { status: 500 });
  }
}
