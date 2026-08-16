import { NextResponse } from "next/server";
import { isDenied, requireStaff } from "@/lib/auth/guard";
import { recordAuditEntry } from "@/lib/services/audit-log";
import { getRestaurantDates } from "@/lib/services/restaurant";
import { updateRestaurantDate } from "@/lib/services/reservations";
import { restaurantDateSchema } from "@/lib/validation/booking";

export async function GET() {
  // Reading availability is what the dashboard does; any signed-in member of
  // staff may. Changing it is the guarded action.
  const auth = await requireStaff();
  if (isDenied(auth)) {
    return auth;
  }

  try {
    return NextResponse.json(await getRestaurantDates());
  } catch (error) {
    console.error("[admin] failed to load dates", error);
    return NextResponse.json({ error: "Unable to load restaurant dates." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const auth = await requireStaff("dates:manage");
  if (isDenied(auth)) {
    return auth;
  }

  try {
    const parsed = restaurantDateSchema.safeParse(await request.json());

    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid restaurant date settings." },
        { status: 400 },
      );
    }

    const date = await updateRestaurantDate(parsed.data);

    await recordAuditEntry({
      action: "date:update",
      actor: auth.actor,
      summary:
        `Set ${date.date} to ${date.isOpen ? "open" : "closed"}, ` +
        `capacity ${date.capacity}${date.premium ? ", invited guests only" : ""}.`,
    });

    return NextResponse.json(date);
  } catch (error) {
    console.error("[admin] failed to update date", error);
    return NextResponse.json({ error: "Unable to update date." }, { status: 500 });
  }
}
