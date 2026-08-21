import { NextResponse } from "next/server";
import { isDenied, requireStaff } from "@/lib/auth/guard";
import {
  BookingError,
  TableJoinError,
  createReservationEntry,
  getReservationsByDate,
} from "@/lib/services/reservations";
import { isValidDateKey } from "@/lib/date";
import { getMenuCatalog, getRestaurantDate } from "@/lib/services/restaurant";
import { BOOKING_MESSAGES, validateReservationRequest } from "@/lib/services/booking-rules";
import { staffReservationSchema } from "@/lib/validation/booking";
import { normalizeContact } from "@/lib/contact";
import { formatRoomList } from "@/lib/room";
import { canonicalizeSelections } from "@/lib/menu-selection";
import { recordAuditEntry } from "@/lib/services/audit-log";

/**
 * One evening's reservations.
 *
 * The dashboard used to be handed every reservation ever taken so its calendar
 * could show any of them without asking again. That made opening `/admin` cost
 * a full-collection read — the slowest thing in the admin area by a wide
 * margin — to display a single day. The calendar now asks for the day it is
 * showing, which is what this answers.
 *
 * Readable by any signed-in member of staff, like the dashboard it serves.
 */
export async function GET(request: Request) {
  const auth = await requireStaff();
  if (isDenied(auth)) {
    return auth;
  }

  const date = new URL(request.url).searchParams.get("date");

  if (!date || !isValidDateKey(date)) {
    return NextResponse.json({ error: "A date is required, as YYYY-MM-DD." }, { status: 400 });
  }

  try {
    return NextResponse.json({ reservations: await getReservationsByDate(date) });
  } catch (error) {
    console.error("[admin] failed to load an evening's reservations", error);
    return NextResponse.json({ error: "Unable to load this evening." }, { status: 500 });
  }
}

/** Takes a booking on a guest's behalf — at the desk or over the phone. */
export async function POST(request: Request) {
  const auth = await requireStaff("reservations:create");
  if (isDenied(auth)) {
    return auth;
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
      additionalRooms: parsed.data.additionalRooms,
      guestCount: parsed.data.guestCount,
      date: parsed.data.date,
      selections: parsed.data.selections,
      restaurantDate,
      menu,
    });

    if (!validation.ok) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }

    /**
     * No pass-key is required here. Staff taking a booking at the desk *are*
     * the check the key exists to perform, and the action is signed and
     * logged against their account — which a key would not be.
     *
     * The consequence is that such a booking has no key attached, so the
     * guest cannot self-serve it at /booking/manage. Reception changes it for
     * them, which is what happens today anyway.
     */
    const reservation = await createReservationEntry({
      roomNumber: parsed.data.roomNumber,
      additionalRooms: parsed.data.additionalRooms,
      guestCount: parsed.data.guestCount,
      date: parsed.data.date,
      selections: canonicalizeSelections(validation.selections, menu),
      contact: parsed.data.contact ? normalizeContact(parsed.data.contact) : undefined,
      notes: parsed.data.notes,
      tableNumber: parsed.data.tableNumber,
    });

    await recordAuditEntry({
      action: "reservation:create",
      actor: auth.actor,
      reservationNumber: reservation.reservationNumber,
      summary:
        `Took a reservation for room ${formatRoomList(reservation.roomNumber, reservation.additionalRooms)}, ` +
        `${reservation.guestCount} guest(s) on ${reservation.date}.`,
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
