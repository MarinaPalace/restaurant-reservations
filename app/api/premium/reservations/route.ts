import { NextResponse } from "next/server";
import { BookingError, createReservationEntry } from "@/lib/services/reservations";
import { getMenuCatalog, getRestaurantDate } from "@/lib/services/restaurant";
import { BOOKING_MESSAGES, validateReservationRequest } from "@/lib/services/booking-rules";
import { premiumReservationSchema } from "@/lib/validation/booking";
import { describeContactProblem, normalizeContact } from "@/lib/contact";
import { canonicalizeSelections } from "@/lib/menu-selection";

const GENERIC_ERROR = "Something went wrong while creating your reservation. Please try again.";

/**
 * Bookings from the invitation flow.
 *
 * These guests are not staying yet, so they give a name rather than a room,
 * they order from the premium menu, and they may only choose an evening that
 * has been opened for them.
 */
export async function POST(request: Request) {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Please check the reservation details." }, { status: 400 });
  }

  const parsed = premiumReservationSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Please check the reservation details." },
      { status: 400 },
    );
  }

  const contactProblem = describeContactProblem(parsed.data.contact);
  if (contactProblem) {
    return NextResponse.json({ error: contactProblem, code: "INVALID_REQUEST" }, { status: 400 });
  }

  try {
    const [menu, restaurantDate] = await Promise.all([
      getMenuCatalog("en", "premium"),
      getRestaurantDate(parsed.data.date),
    ]);

    // An evening that is not marked premium is not on offer here, however
    // valid it may be for hotel guests.
    if (!restaurantDate?.premium) {
      return NextResponse.json(
        { error: "That evening is not part of this invitation. Please choose one of the dates offered." },
        { status: 409 },
      );
    }

    const validation = validateReservationRequest({
      // Invited guests have no room; the rules only need a usable label.
      roomNumber: "INVITED",
      guestCount: parsed.data.guestCount,
      date: parsed.data.date,
      selections: parsed.data.selections,
      restaurantDate,
      menu,
    });

    if (!validation.ok) {
      const unavailable =
        validation.error === BOOKING_MESSAGES.unavailable ||
        validation.error === BOOKING_MESSAGES.fullyBooked ||
        validation.error === BOOKING_MESSAGES.pastDate;

      return NextResponse.json(
        { error: validation.error, code: unavailable ? "DATE_UNAVAILABLE" : "INVALID_REQUEST" },
        { status: unavailable ? 409 : 400 },
      );
    }

    const reservation = await createReservationEntry({
      kind: "premium",
      roomNumber: "",
      guestName: parsed.data.guestName,
      guestCount: parsed.data.guestCount,
      date: parsed.data.date,
      selections: canonicalizeSelections(validation.selections, menu),
      contact: normalizeContact(parsed.data.contact),
      notes: parsed.data.notes,
    });

    return NextResponse.json({ reservation }, { status: 201 });
  } catch (error) {
    if (error instanceof BookingError) {
      return NextResponse.json(
        {
          error: error.code === "DATE_CLOSED" ? BOOKING_MESSAGES.unavailable : BOOKING_MESSAGES.fullyBooked,
          code: "DATE_UNAVAILABLE",
        },
        { status: 409 },
      );
    }

    console.error("[premium] failed to create reservation", error);
    return NextResponse.json({ error: GENERIC_ERROR }, { status: 500 });
  }
}
