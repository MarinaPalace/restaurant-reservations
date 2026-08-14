import { NextResponse } from "next/server";
import { BookingError, TableJoinError, createReservationEntry } from "@/lib/services/reservations";
import { getMenuCatalog, getRestaurantDate } from "@/lib/services/restaurant";
import { BOOKING_MESSAGES, validateReservationRequest } from "@/lib/services/booking-rules";
import { createReservationSchema } from "@/lib/validation/booking";
import { describeContactProblem, normalizeContact } from "@/lib/contact";

const GENERIC_ERROR = "Something went wrong while creating your reservation. Please try again.";

export async function POST(request: Request) {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Please enter valid reservation details." }, { status: 400 });
  }

  const parsed = createReservationSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Please enter valid reservation details." },
      { status: 400 },
    );
  }

  try {
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

    const contactProblem = describeContactProblem(parsed.data.contact);
    if (contactProblem) {
      return NextResponse.json({ error: contactProblem, code: "INVALID_REQUEST" }, { status: 400 });
    }

    if (!validation.ok) {
      const isAvailabilityProblem =
        validation.error === BOOKING_MESSAGES.unavailable ||
        validation.error === BOOKING_MESSAGES.fullyBooked ||
        validation.error === BOOKING_MESSAGES.pastDate;

      return NextResponse.json(
        { error: validation.error, code: isAvailabilityProblem ? "DATE_UNAVAILABLE" : "INVALID_REQUEST" },
        { status: isAvailabilityProblem ? 409 : 400 },
      );
    }

    const reservation = await createReservationEntry({
      roomNumber: parsed.data.roomNumber,
      guestCount: parsed.data.guestCount,
      date: parsed.data.date,
      selections: validation.selections,
      contact: normalizeContact(parsed.data.contact!),
      notes: parsed.data.notes,
      joinReservationNumber: parsed.data.joinReservationNumber,
    });

    return NextResponse.json({ reservation }, { status: 201 });
  } catch (error) {
    // The party being joined may have gone away between choosing it and here.
    if (error instanceof TableJoinError) {
      return NextResponse.json({ error: error.message, code: "TABLE_JOIN_FAILED" }, { status: 409 });
    }

    // The date may have filled up between the check above and the write.
    if (error instanceof BookingError) {
      return NextResponse.json(
        {
          error: error.code === "DATE_CLOSED" ? BOOKING_MESSAGES.unavailable : BOOKING_MESSAGES.fullyBooked,
          code: "DATE_UNAVAILABLE",
        },
        { status: 409 },
      );
    }

    console.error("[reservations] failed to create reservation", error);
    return NextResponse.json({ error: GENERIC_ERROR }, { status: 500 });
  }
}
