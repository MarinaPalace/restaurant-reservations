import { NextResponse } from "next/server";
import { getPassKeyByCode } from "@/lib/services/pass-keys";
import {
  getReservationsByPassKey,
  moveReservationTable,
} from "@/lib/services/reservations";
import { getFloorPlan, getEveningFeatures } from "@/lib/services/settings";
import { getRestaurantDate } from "@/lib/services/restaurant";
import { listTableClaims, TableClaimError } from "@/lib/services/table-claims";
import { findPlanTable, offerTables } from "@/lib/floor-plan-availability";
import { canGuestModify } from "@/lib/reservation-policy";
import { recordAuditEntry } from "@/lib/services/audit-log";
import { describeReservationChanges, summariseChanges } from "@/lib/reservation-changes";
import { toGuestReservation } from "@/lib/guest-reservation";
import { changeTableSchema } from "@/lib/validation/booking";
import { checkRateLimit, clientKeyFrom } from "@/lib/rate-limit";

const NOT_FOUND = { error: "We could not find a reservation for that pass-key." };

/**
 * A guest changing their own table.
 *
 * Until now a table could be chosen once, when the booking was made, and never
 * again — a guest who wanted a different one telephoned reception. Everything
 * needed to let them do it themselves was already here: the claim rules, the
 * plan, and the pass-key that authorises every other self-service change.
 *
 * ## What has to be true, and why each is checked here
 *
 * - **The pass-key authorises it, not the reservation number** (rule 2.5).
 *   Guests read their number out to other rooms to share a table; a route that
 *   took it as proof would let any of those rooms move the party.
 * - **The evening still allows changes.** The same 12-hour cutoff as every
 *   other guest edit, from `canGuestModify` — the kitchen and the floor plan
 *   are settled by then, and a table moving at 18:55 is a table nobody has
 *   told the waiter about.
 * - **The evening offers table selection at all.** An evening with it off is
 *   one where the restaurant seats people, and a booking made when it was on
 *   must not be re-picked after it was turned off.
 * - **The table is resolved from the plan, never from the request** (rule 2.6).
 *   The plan says how many it seats; a request that named its own seat count
 *   could claim a two-top for six.
 * - **A shared table is refused.** Bookings joined into one party hold one
 *   table between them, and moving one of them would split a party that asked
 *   to sit together — silently, and only visible at the door. That is a
 *   telephone call to reception, and the answer says so.
 *
 * ## The claim is the real work
 *
 * `moveReservationTable` claims the new table before releasing the old, so a
 * guest who cannot have the one they asked for still has the one they had.
 * `docs/floor-plan.md` §2: never a read-then-write.
 *
 * ## A cutoff of its own is coming
 *
 * Table selection is expected to close earlier than the booking itself — a day
 * or a few hours before service, so the floor can be laid out — while changing
 * a menu choice stays open until the 12-hour deadline. That is not built: today
 * both close together. The check lives here, in one place, which is where that
 * change will go.
 */
export async function POST(request: Request) {
  const limit = checkRateLimit(clientKeyFrom(request, "manage-table"), { limit: 12, windowMs: 60_000 });

  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many attempts. Please wait a moment and try again." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }

  try {
    const parsed = changeTableSchema.safeParse(await request.json());

    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Please choose a table." },
        { status: 400 },
      );
    }

    const passKey = await getPassKeyByCode(parsed.data.passKey);
    if (!passKey || passKey.status === "revoked") {
      return NextResponse.json(NOT_FOUND, { status: 404 });
    }

    const reservations = await getReservationsByPassKey(passKey.id);
    const wanted = parsed.data.reservationNumber?.trim().toUpperCase();
    const reservation = wanted
      ? reservations.find((entry) => entry.reservationNumber === wanted)
      : reservations.length === 1
        ? reservations[0]
        : null;

    if (!reservation) {
      return NextResponse.json(
        reservations.length > 1
          ? { error: "Please say which reservation you mean." }
          : NOT_FOUND,
        { status: reservations.length > 1 ? 400 : 404 },
      );
    }

    const evening = await getEveningFeatures(await getRestaurantDate(reservation.date));
    const check = canGuestModify(reservation, new Date(), evening.selfService);

    if (!check.allowed) {
      return NextResponse.json({ error: check.reason ?? "This reservation can no longer be changed." }, { status: 409 });
    }

    if (evening.tableSelection === "off") {
      return NextResponse.json(
        { error: "Tables are not being chosen by guests for that evening. We will seat you." },
        { status: 409 },
      );
    }

    if (reservation.tableGroupId) {
      return NextResponse.json(
        {
          error:
            "This booking is sharing a table with another room, so the table cannot be changed here. Please ask reception.",
          code: "SHARED_TABLE",
        },
        { status: 409 },
      );
    }

    /**
     * Nothing chosen means "hand it back and seat us" — the same answer as the
     * "any table" button when the booking was made. An evening that *requires*
     * a choice cannot be left without one, though: it is required precisely
     * because the restaurant is not doing the seating that night.
     */
    if (!parsed.data.tableId) {
      if (evening.tableSelection === "required") {
        return NextResponse.json(
          { error: "A table has to be chosen for that evening. Please pick another one instead." },
          { status: 409 },
        );
      }

      const cleared = await moveReservationTable({
        reservationNumber: reservation.reservationNumber,
        date: reservation.date,
        guests: reservation.guestCount,
        fromTableId: reservation.tableId,
        to: null,
        source: "guest",
      });

      if (!cleared) {
        return NextResponse.json(NOT_FOUND, { status: 404 });
      }

      await logChange(reservation, cleared, passKey.id);
      return NextResponse.json({ reservation: toGuestReservation(cleared) });
    }

    const plan = await getFloorPlan();
    const table = findPlanTable(plan, parsed.data.tableId);

    if (!table || !table.active || !table.label.trim()) {
      return NextResponse.json({ error: "That table is not available. Please choose another." }, { status: 409 });
    }

    /**
     * Judged the same way the picker judged it, so a guest is never refused a
     * table the screen offered them for a reason the screen could not know —
     * and never *given* one the picker would have greyed out. The claim below
     * is still what decides the race; this is the readable answer.
     */
    const claims = await listTableClaims(reservation.date);
    const offered = offerTables(plan, claims, reservation.guestCount)
      .flatMap((zone) => zone.tables)
      .find((entry) => entry.id === table.id);

    // The table it is already on always counts as available to itself: its own
    // claim is what makes it look taken.
    if (offered?.unavailable && table.id !== reservation.tableId) {
      return NextResponse.json(
        {
          error:
            offered.unavailable === "too-small"
              ? "That table is not big enough for your party. Please choose another."
              : "Somebody has just taken that table. Please choose another.",
          code: "TABLE_TAKEN",
        },
        { status: 409 },
      );
    }

    if (table.id === reservation.tableId) {
      // Already there. Not an error, and not a write either — a no-op write
      // would bump the version and put a line in the log saying nothing.
      return NextResponse.json({ reservation: toGuestReservation(reservation) });
    }

    try {
      const moved = await moveReservationTable({
        reservationNumber: reservation.reservationNumber,
        date: reservation.date,
        guests: reservation.guestCount,
        fromTableId: reservation.tableId,
        to: { id: table.id, label: table.label, seats: table.seats },
        source: "guest",
      });

      if (!moved) {
        return NextResponse.json(NOT_FOUND, { status: 404 });
      }

      await logChange(reservation, moved, passKey.id);
      return NextResponse.json({ reservation: toGuestReservation(moved) });
    } catch (error) {
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

      throw error;
    }
  } catch (error) {
    console.error("[booking] failed to change the table", error);
    return NextResponse.json({ error: "Unable to change your table." }, { status: 500 });
  }
}

/**
 * The entry for a guest moving themselves.
 *
 * After the write and never awaited into it: a failed log write must not fail
 * the thing being logged.
 */
async function logChange(
  before: Parameters<typeof describeReservationChanges>[0] & { roomNumber: string; reservationNumber: string },
  after: Parameters<typeof describeReservationChanges>[1] & { version?: number },
  passKeyId: string,
) {
  const changes = describeReservationChanges(before, after);

  if (changes.length === 0) {
    return;
  }

  await recordAuditEntry({
    action: "reservation:table",
    actor: { kind: "guest", id: passKeyId, name: `Guest in room ${before.roomNumber}` },
    reservationNumber: before.reservationNumber,
    summary: summariseChanges(changes),
    changes,
    version: after.version,
  });
}
