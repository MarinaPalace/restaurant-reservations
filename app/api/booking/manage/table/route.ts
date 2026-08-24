import { NextResponse } from "next/server";
import { getPassKeyByCode } from "@/lib/services/pass-keys";
import {
  getReservationsByPassKey,
  moveReservationTable,
} from "@/lib/services/reservations";
import { getFloorPlan, getEveningFeatures } from "@/lib/services/settings";
import { getRestaurantDate } from "@/lib/services/restaurant";
import { listTableClaims, TableClaimError } from "@/lib/services/table-claims";
import { findPlanCombination, offerTables } from "@/lib/floor-plan-availability";
import { canGuestChooseTable, canGuestModify } from "@/lib/reservation-policy";
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
 * ## Two deadlines, not one
 *
 * `canGuestModify` closes the booking twelve hours out, because by then the
 * kitchen has counted. `canGuestChooseTable` closes the **tables** at whatever
 * the evening says — usually earlier, because the floor gets laid out before
 * the kitchen stops counting, and off entirely on an evening that does not
 * care. Both have to pass, so the table deadline can only ever shut the door
 * sooner.
 *
 * ## Several tables at once
 *
 * A party of five in a room of four-tops books two tables pushed together, and
 * `tableId` then carries `t7+t8`. Every table in it is claimed **whole** —
 * nobody can be seated at a table pushed against a stranger's dinner — and a
 * failure part way through gives back what was already taken.
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

    const restaurantDate = await getRestaurantDate(reservation.date);
    const evening = await getEveningFeatures(restaurantDate);
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

    /**
     * The evening's own table deadline, which closes **earlier** than the
     * booking's and is off unless somebody set it. Past it the room is laid
     * out: the plan on the wall is printed, the waiter has walked it, and a
     * table moving now is a table nobody has been told about.
     */
    if (!canGuestChooseTable(restaurantDate, new Date()).allowed) {
      return NextResponse.json(
        {
          error:
            "The tables for that evening are already laid out, so they can no longer be changed here. Please ask reception.",
          code: "TABLE_CUTOFF",
        },
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
        from: await heldTables(reservation),
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
    /**
     * One table, or several pushed together — `t7+t8`. Resolved from the plan,
     * which is also what says those two may be joined at all: a request cannot
     * push together tables at opposite ends of the room (rule 2.6).
     */
    const combination = findPlanCombination(plan, parsed.data.tableId);

    if (!combination) {
      return NextResponse.json({ error: "That table is not available. Please choose another." }, { status: 409 });
    }

    if (combination.seats < reservation.guestCount) {
      return NextResponse.json(
        { error: "That table is not big enough for your party. Please choose another.", code: "TABLE_TAKEN" },
        { status: 409 },
      );
    }

    /**
     * Judged the same way the picker judged it, so a guest is never refused a
     * table the screen offered them for a reason the screen could not know —
     * and never *given* one the picker would have greyed out. The claim below
     * is still what decides the race; this is the readable answer.
     */
    const claims = await listTableClaims(reservation.date);
    const held = new Set(heldIds(reservation));
    const offers = offerTables(plan, claims, reservation.guestCount).flatMap((zone) => zone.tables);

    /**
     * Judged the same way the picker judged it, so a guest is never refused a
     * table the screen offered for a reason the screen could not know. The
     * claim below is still what decides the race; this is the readable answer.
     *
     * A table this booking already holds counts as free to itself — its own
     * claim is what makes it look taken. And "too small" is not a refusal
     * inside a combination: being too small on its own is the entire reason
     * two tables are being pushed together.
     */
    const blocked = combination.tables.find((entry) => {
      if (held.has(entry.id)) {
        return false;
      }

      const offer = offers.find((candidate) => candidate.id === entry.id);
      return offer?.unavailable === "taken" || offer?.unavailable === "out-of-service";
    });

    if (blocked) {
      return NextResponse.json(
        { error: "Somebody has just taken that table. Please choose another.", code: "TABLE_TAKEN" },
        { status: 409 },
      );
    }

    const wantedIds = combination.tables.map((entry) => entry.id);

    if (wantedIds.length === held.size && wantedIds.every((id) => held.has(id))) {
      // Already there. Not an error, and not a write either — a no-op write
      // would bump the version and put a line in the log saying nothing.
      return NextResponse.json({ reservation: toGuestReservation(reservation) });
    }

    try {
      const moved = await moveReservationTable({
        reservationNumber: reservation.reservationNumber,
        date: reservation.date,
        guests: reservation.guestCount,
        from: await heldTables(reservation),
        to: combination.tables.map((entry) => ({
          id: entry.id,
          label: entry.label.trim(),
          seats: entry.seats,
        })),
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

/** Every plan table this booking holds. One, several, or none. */
function heldIds(reservation: { tableId?: string; tableIds?: string[] }): string[] {
  return reservation.tableIds?.length
    ? reservation.tableIds
    : reservation.tableId
      ? [reservation.tableId]
      : [];
}

/**
 * The same tables, with their seats, which is what releasing them needs.
 *
 * Read from the plan because a booking stores ids and a label, not seat counts
 * — and the seat count is how much of a table was claimed when several were
 * pushed together. A table since deleted from the plan is dropped: the claim is
 * released by id either way, and inventing a seat count for a table that no
 * longer exists would be a guess in the one place a guess is not free.
 */
async function heldTables(reservation: {
  tableId?: string;
  tableIds?: string[];
}): Promise<{ id: string; label: string; seats: number }[]> {
  const ids = heldIds(reservation);

  if (ids.length === 0) {
    return [];
  }

  const plan = await getFloorPlan();

  return ids
    .map((id) => findPlanCombination(plan, id)?.tables[0])
    .filter((table): table is NonNullable<typeof table> => Boolean(table))
    .map((table) => ({ id: table.id, label: table.label.trim(), seats: table.seats }));
}
