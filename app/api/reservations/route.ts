import { NextResponse } from "next/server";
import {
  BookingError,
  TableJoinError,
  createReservationEntry,
  reserveReservationNumber,
} from "@/lib/services/reservations";
import { getMenuCatalog, getRestaurantDate } from "@/lib/services/restaurant";
import { getEveningFeatures, getFloorPlan } from "@/lib/services/settings";
import { findPlanCombination } from "@/lib/floor-plan-availability";
import { TableClaimError } from "@/lib/services/table-claims";
import { canGuestBookDate, canGuestChooseTable } from "@/lib/reservation-policy";
import { BOOKING_MESSAGES, validateReservationRequest } from "@/lib/services/booking-rules";
import {
  PASS_KEY_MESSAGES,
  consumePassKey,
  describeGuestCountProblem,
  describePassKeyProblem,
  getPassKeyByCode,
  isDateWithinStay,
  releasePassKey,
} from "@/lib/services/pass-keys";
import { recordAuditEntry } from "@/lib/services/audit-log";
import { describeNewReservation } from "@/lib/reservation-changes";
import { toGuestReservation } from "@/lib/guest-reservation";
import { createReservationSchema } from "@/lib/validation/booking";
import { describeContactProblem, normalizeContact } from "@/lib/contact";
import { canonicalizeSelections } from "@/lib/menu-selection";
import { checkRateLimit, clientKeyFrom } from "@/lib/rate-limit";

const GENERIC_ERROR = "Something went wrong while creating your reservation. Please try again.";

/**
 * A guest booking.
 *
 * Two things have to be true and neither is checked in the browser:
 *
 * 1. **They are staying here, long enough to be entitled to dinner.** That is
 *    what the pass-key proves — reception issues one at check-in and only for
 *    a qualifying stay. A room number on its own proves nothing; anyone can
 *    read one off a door.
 * 2. **The evening is one they may book.** Premium evenings are held for
 *    invited guests, and a dinner after check-out is not part of the stay.
 *
 * The key is spent *before* the reservation is written and handed back if the
 * write fails — the same claim-then-release shape the seat accounting uses,
 * and the reason two requests with one key cannot both produce a booking.
 */
export async function POST(request: Request) {
  // A booking presents a pass-key, so this endpoint is guessable in the same
  // way the check endpoint is, and gets the same limit.
  const limit = checkRateLimit(clientKeyFrom(request, "booking"), { limit: 12, windowMs: 60_000 });

  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many attempts. Please wait a moment and try again.", code: "RATE_LIMITED" },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }

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

  let claimedKeyId: string | null = null;
  let claimedReservationNumber: string | null = null;

  try {
    const [menu, restaurantDate, passKey] = await Promise.all([
      getMenuCatalog(),
      getRestaurantDate(parsed.data.date),
      getPassKeyByCode(parsed.data.passKey),
    ]);

    /**
     * The key is judged before anything else is revealed, so a wrong key
     * cannot be used to probe which evenings have seats left.
     */
    const keyProblem = describePassKeyProblem(passKey);

    /**
     * An invitation key is refused here, and an in-house key is refused on the
     * invitation flow. The two have separate menus and separate evenings, so a
     * key belongs to exactly one of them — without this check a premium key
     * booked an everyday evening from the everyday menu, and spent itself
     * doing it.
     */
    if (keyProblem || !passKey || passKey.kind === "premium") {
      return NextResponse.json(
        { error: keyProblem?.message ?? PASS_KEY_MESSAGES.invalid, code: `PASS_KEY_${keyProblem?.code ?? "INVALID"}` },
        { status: 403 },
      );
    }

    /**
     * The party may shrink but never grow: the seats were held for the number
     * on the hotel booking, and no more.
     */
    const guestProblem = describeGuestCountProblem(passKey, parsed.data.guestCount);
    if (guestProblem) {
      return NextResponse.json({ error: guestProblem, code: "PASS_KEY_TOO_MANY_GUESTS" }, { status: 409 });
    }

    if (!isDateWithinStay(passKey, parsed.data.date)) {
      return NextResponse.json(
        { error: PASS_KEY_MESSAGES.afterStay, code: "PASS_KEY_AFTER_STAY" },
        { status: 409 },
      );
    }

    /**
     * A premium evening is held for invited guests. Hiding it from the date
     * list is not enough — the seats have to be defended here too, or a
     * hand-made request could take one.
     */
    if (restaurantDate?.premium) {
      return NextResponse.json(
        { error: BOOKING_MESSAGES.unavailable, code: "DATE_UNAVAILABLE" },
        { status: 409 },
      );
    }

    /**
     * Guest bookings close a set number of hours before the sitting, per date.
     * Greying the evening out in the calendar is presentation; this is the
     * rule (2.5). Staff are not bound by it and their routes do not check it.
     */
    if (restaurantDate && !canGuestBookDate(restaurantDate).allowed) {
      return NextResponse.json(
        { error: BOOKING_MESSAGES.bookingClosed, code: "BOOKING_CLOSED" },
        { status: 409 },
      );
    }

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

    /**
     * Spend the key now. `consumePassKey` only matches a key that is still
     * active, so if two requests arrive together exactly one gets a record
     * back and the other is told the key is used.
     *
     * The reservation number is generated here rather than by the service, so
     * the key and the booking it paid for carry the same number even though
     * the key is written first.
     */
    claimedReservationNumber = await reserveReservationNumber();
    const spent = await consumePassKey(parsed.data.passKey, claimedReservationNumber);

    if (!spent) {
      return NextResponse.json({ error: PASS_KEY_MESSAGES.used, code: "PASS_KEY_USED" }, { status: 409 });
    }

    claimedKeyId = spent.id;

    /**
     * The table, resolved from the plan rather than trusted from the request.
     *
     * Three things have to be true before a table is claimed, and each is
     * checked here rather than anywhere the guest can reach:
     *
     * - **This evening actually offers the choice.** A request naming a table
     *   for an evening with selection off is ignored rather than refused: the
     *   guest gets the booking they asked for, and the field they should never
     *   have been able to send simply does nothing.
     * - **The table exists on the plan**, and it is the plan that says how many
     *   it seats. Rule 2.6: resolve from what is stored, never from what was
     *   posted.
     * - **It is in service and labelled**, since the label becomes the
     *   booking's `tableNumber` and an unlabelled table could not be named on
     *   the service sheet afterwards.
     */
    const table = await resolveTable(parsed.data.date, parsed.data.tableId, parsed.data.guestCount);

    const reservation = await createReservationEntry({
      tables: table,
      // The guest picked it themselves on /booking/table. That is the mark
      // staff should think twice about before moving anybody.
      tableSource: "guest",
      reservationNumber: claimedReservationNumber,
      roomNumber: parsed.data.roomNumber,
      guestCount: parsed.data.guestCount,
      date: parsed.data.date,
      // Stored in the master English wording, whatever language the guest
      // booked in, so the kitchen always reads one language.
      selections: canonicalizeSelections(validation.selections, menu),
      contact: normalizeContact(parsed.data.contact!),
      notes: parsed.data.notes,
      joinReservationNumber: parsed.data.joinReservationNumber,
      passKeyId: spent.id,
    });

    await recordAuditEntry({
      action: "reservation:create",
      actor: { kind: "guest", id: spent.id, name: `Room ${parsed.data.roomNumber}` },
      reservationNumber: reservation.reservationNumber,
      summary: `Booked ${reservation.guestCount} guest(s) for ${reservation.date} with a pass-key.`,
      // What they actually booked — the dishes and the table included. Without
      // it the log knew a booking had happened and nothing about what it was.
      changes: describeNewReservation(reservation),
      version: reservation.version,
    });

    return NextResponse.json({ reservation: toGuestReservation(reservation) }, { status: 201 });
  } catch (error) {
    // The booking failed after the key was spent, so give it back — otherwise
    // the guest is locked out by a failure that was not theirs.
    if (claimedKeyId && claimedReservationNumber) {
      await releasePassKey(claimedKeyId, claimedReservationNumber).catch((releaseError) => {
        console.error("[reservations] failed to release pass-key after a failed booking", releaseError);
      });
    }

    /**
     * Somebody else took the table between the plan being drawn and this
     * request arriving. A `409` with the same shape as a full evening — the
     * screen reloads the room and the table is now visibly taken.
     */
    if (error instanceof TableClaimError) {
      return NextResponse.json(
        {
          error:
            error.code === "TABLE_TOO_SMALL"
              ? "That table is not big enough for your party. Please choose another."
              : "Somebody has just taken that table. Please choose another.",
          code: "TABLE_TAKEN",
        },
        { status: 409 },
      );
    }

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

/**
 * The plan table a request named, or nothing.
 *
 * Nothing is the right answer far more often than an error is: an evening with
 * selection off, a request from an older screen, a table since taken out of
 * service. In every one of those the guest asked for a dinner and should get
 * one — the seat claim is what actually holds their place, and the table is an
 * additional nicety that either works or does not.
 *
 * The one case that *is* an error is a table that exists, is offerable, and
 * cannot be claimed — and that is raised by `claimTable`, not here.
 */
async function resolveTable(
  date: string,
  tableId: string | undefined,
  guestCount: number,
): Promise<{ id: string; label: string; seats: number }[] | undefined> {
  if (!tableId) {
    return undefined;
  }

  const evening = await getRestaurantDate(date);
  const features = await getEveningFeatures(evening);

  if (features.tableSelection === "off") {
    return undefined;
  }

  /**
   * Past the evening's table cutoff the room is already laid out, so a request
   * arriving from a screen opened before it gets the dinner and not the table.
   * Silently, and deliberately: the guest asked to eat, the seats are theirs,
   * and "your table went while you were choosing" is not a booking failure.
   */
  if (!canGuestChooseTable(evening, new Date()).allowed) {
    return undefined;
  }

  /**
   * One id or several joined with `+` — a party of five on two four-tops.
   * Resolved from the plan, which is what says those tables may be pushed
   * together at all (rule 2.6).
   */
  const combination = findPlanCombination(await getFloorPlan(), tableId);

  if (!combination) {
    return undefined;
  }

  /**
   * And it has to be big enough, which for tables pushed together is not the
   * sum of them: two four-tops seat six, because the chairs where they meet are
   * standing where the other table now is. Nothing below would catch it — a
   * merged holding claims each table whole, so `claimTable` only ever compares
   * a table's seats with its own, and a party of eight would be seated at six
   * chairs without a single check failing.
   *
   * Dropped rather than refused, like every other thing this function cannot
   * resolve: the picker never offers a combination too small, so getting here
   * means a stale screen or a made-up request, and the guest asked to eat.
   */
  if (combination.seats < guestCount) {
    return undefined;
  }

  return combination.tables.map((table) => ({
    id: table.id,
    label: table.label.trim(),
    seats: table.seats,
  }));
}
