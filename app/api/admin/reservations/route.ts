import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/auth/guard";
import { BookingError, TableJoinError, createReservationEntry } from "@/lib/services/reservations";
import { getMenuCatalog, getRestaurantDate } from "@/lib/services/restaurant";
import { BOOKING_MESSAGES, validateReservationRequest } from "@/lib/services/booking-rules";
import { staffReservationSchema } from "@/lib/validation/booking";
import { normalizeContact } from "@/lib/contact";

/** Takes a booking on a guest's behalf — at the desk or over the phone. */
export async function POST(request: Request) {
  const unauthorized = await requireAdminApi();
  if (unauthorized) {
    return unauthorized;
  }

  try {
    const parsed = staffReservationSchema.safeParse(await request.json());

    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Please check the reservation details." },
        { status: 400 },
      );
    }

    const [menu, restaurantDate] = await Promise.all([
      getMenuCatalog(),
      getRestaurantDate(parsed.data.date),
    ]);

    const validation = validateReservationRequest({
      roomNumber: parsed.data.roomNumber,
      guestCount: parsed.data.guestCount,
      date: parsed.data.date,
      selections: parsed.data.selections,
      restaurantDate,
      menu,
    });

    if (!validation.ok) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }

    const reservation = await createReservationEntry({
      roomNumber: parsed.data.roomNumber,
      guestCount: parsed.data.guestCount,
      date: parsed.data.date,
      selections: validation.selections,
      contact: parsed.data.contact ? normalizeContact(parsed.data.contact) : undefined,
      notes: parsed.data.notes,
      tableNumber: parsed.data.tableNumber,
    });

    return NextResponse.json({ reservation }, { status: 201 });
  } catch (error) {
    if (error instanceof BookingError) {
      return NextResponse.json(
        { error: error.code === "DATE_CLOSED" ? BOOKING_MESSAGES.unavailable : BOOKING_MESSAGES.fullyBooked },
        { status: 409 },
      );
    }
    if (error instanceof TableJoinError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }

    console.error("[admin] failed to create reservation", error);
    return NextResponse.json({ error: "Unable to create this reservation." }, { status: 500 });
  }
}
