import { NextResponse } from "next/server";
import { getReservationByNumber } from "@/lib/services/reservations";
import { getFloorPlan } from "@/lib/services/settings";
import { listTableClaims } from "@/lib/services/table-claims";
import { findPlanCombination } from "@/lib/floor-plan-availability";
import { isValidDateKey } from "@/lib/date";
import { checkRateLimit, clientKeyFrom } from "@/lib/rate-limit";
import { MAX_GUESTS_PER_RESERVATION } from "@/lib/validation/booking";

/**
 * Where a party a guest is joining is already sitting.
 *
 * ## Why it exists
 *
 * "Sit us with room 402" used to be asked on the summary, after the table had
 * been chosen — which on an evening where guests pick their own table asks the
 * same question twice and takes both answers. The booking was then marked as
 * sharing a table while holding a different one. The question is asked before
 * the table now, and answering it means being told which table that is.
 *
 * ## What it will say, and what it will not
 *
 * The table's **label**, and whether the party asking fits at it. Nothing else:
 * no name, no room, no reservation details, and not how many are already
 * seated. `docs/floor-plan.md` §6 — "taken" is all a guest may be told about a
 * table, and who is at it is never anybody's business but the restaurant's.
 *
 * The reservation number is the credential, exactly as it is for the sharing
 * that already existed: a guest who knows it was told it by the party they are
 * joining. It is guessable in principle, which is why this is rate-limited and
 * says so little — the worst a successful guess yields is a table label for an
 * evening, which is drawn on the plan the same screen is already showing.
 */
export async function GET(request: Request) {
  const limit = checkRateLimit(clientKeyFrom(request, "share"), { limit: 20, windowMs: 60_000 });

  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many attempts. Please wait a moment and try again.", code: "RATE_LIMITED" },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }

  const url = new URL(request.url);
  const number = (url.searchParams.get("number") ?? "").trim().toUpperCase();
  const date = url.searchParams.get("date") ?? "";
  const guests = Number(url.searchParams.get("guests") ?? "0");

  if (!number || !isValidDateKey(date)) {
    return NextResponse.json({ error: "Please check the reservation number." }, { status: 400 });
  }

  if (!Number.isInteger(guests) || guests < 1 || guests > MAX_GUESTS_PER_RESERVATION) {
    return NextResponse.json({ error: "Invalid party size." }, { status: 400 });
  }

  try {
    const target = await getReservationByNumber(number);

    /**
     * The same three refusals the booking route makes when it resolves the
     * group, worded for somebody who is still filling the form in. Kept in step
     * with `resolveTableGroup` deliberately: a number accepted here and refused
     * at the end would be the worst of both.
     */
    if (!target) {
      return NextResponse.json(
        { error: "We could not find that reservation number. Please check it and try again." },
        { status: 404 },
      );
    }

    if (target.date !== date) {
      return NextResponse.json(
        { error: "That reservation is for a different evening, so you cannot share a table." },
        { status: 409 },
      );
    }

    if (target.status !== "confirmed") {
      return NextResponse.json(
        { error: "That reservation has been cancelled, so you cannot share a table with it." },
        { status: 409 },
      );
    }

    const held = target.tableIds?.length ? target.tableIds : target.tableId ? [target.tableId] : [];

    /**
     * They may have no table at all — an evening where the restaurant seats
     * everybody, or a guest who chose not to pick. Sharing still works; there
     * is simply nothing to show and nothing to be seated at yet.
     */
    if (held.length === 0) {
      return NextResponse.json({ number, tables: [], tableNumber: null, fits: true });
    }

    const [plan, claims] = await Promise.all([getFloorPlan(), listTableClaims(date)]);
    const combination = findPlanCombination(plan, held.join("+"));

    if (!combination) {
      // Their table is no longer on the plan. Sharing is still allowed — staff
      // will seat the pair — but there is nothing to point at.
      return NextResponse.json({ number, tables: [], tableNumber: target.tableNumber ?? null, fits: true });
    }

    /**
     * Whether this party fits beside them, answered here rather than by handing
     * over the seats already taken. The number of strangers at a table is the
     * one thing §6 is most careful about.
     */
    const seated = new Map(claims.map((claim) => [claim.tableId, claim.guests]));
    const taken = combination.tables.reduce(
      (total, table) => total + (seated.get(table.id) ?? 0),
      0,
    );

    return NextResponse.json({
      number,
      tables: combination.tables.map((table) => table.id),
      tableNumber: combination.label,
      seats: combination.seats,
      fits: taken + guests <= combination.seats,
    });
  } catch (error) {
    console.error("[booking] failed to look up a shared table", error);
    return NextResponse.json({ error: "Unable to check that reservation." }, { status: 500 });
  }
}
