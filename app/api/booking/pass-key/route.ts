import { NextResponse } from "next/server";
import { getRestaurantDates } from "@/lib/services/restaurant";
import { getReservationsByPassKey } from "@/lib/services/reservations";
import {
  PASS_KEY_MESSAGES,
  describePassKeyProblem,
  getPassKeyByCode,
  isDateWithinStay,
} from "@/lib/services/pass-keys";
import { manageReservationSchema } from "@/lib/validation/booking";
import { checkRateLimit, clientKeyFrom } from "@/lib/rate-limit";
import { todayKey } from "@/lib/date";

/**
 * Checks a pass-key before the guest starts choosing.
 *
 * This exists so a spent, expired or withdrawn key is refused on the *first*
 * screen. It used to be caught only when the booking was submitted, after the
 * guest had picked a date and a full menu for every person at the table —
 * which is a lot of wasted effort to be told the key was never going to work.
 *
 * It also tells the guest what they are working with: when the key expires,
 * how many dinners are left on it, and which evenings they may actually
 * choose, so the calendar can grey out everything past the end of their stay.
 *
 * Nothing here is a substitute for the check at booking time — that one is
 * authoritative and still runs. This is only about failing early and honestly.
 */
export async function POST(request: Request) {
  // The one endpoint where guessing would be attempted, so it is the one that
  // most needs a limit.
  const limit = checkRateLimit(clientKeyFrom(request, "pass-key"), { limit: 12, windowMs: 60_000 });

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
    return NextResponse.json({ error: PASS_KEY_MESSAGES.invalid, code: "INVALID" }, { status: 400 });
  }

  const parsed = manageReservationSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? PASS_KEY_MESSAGES.invalid, code: "INVALID" },
      { status: 400 },
    );
  }

  try {
    const passKey = await getPassKeyByCode(parsed.data.passKey);
    const problem = describePassKeyProblem(passKey);

    if (problem || !passKey) {
      // 200 with ok:false, not an error status: "this key will not work" is a
      // normal answer to this question, and the screen wants to show why.
      return NextResponse.json({ ok: false, error: problem?.message ?? PASS_KEY_MESSAGES.invalid, code: problem?.code ?? "INVALID" });
    }

    const today = todayKey();
    const [dates, booked] = await Promise.all([
      getRestaurantDates(),
      getReservationsByPassKey(passKey.id),
    ]);

    /**
     * An invitation key and an in-house key see different evenings entirely,
     * so the kind decides which set is offered — and it is returned, so the
     * entry screen can send the guest to the right flow instead of letting
     * them fill in a whole booking the key was never valid for.
     */
    const isInvitation = passKey.kind === "premium";

    const bookableDates = dates
      .filter(
        (entry) =>
          entry.isOpen &&
          Boolean(entry.premium) === isInvitation &&
          entry.date >= today &&
          entry.remainingSeats > 0 &&
          isDateWithinStay(passKey, entry.date),
      )
      .map((entry) => entry.date);

    return NextResponse.json({
      ok: true,
      kind: isInvitation ? "premium" : "standard",
      expiresOn: passKey.expiresOn ?? null,
      usesRemaining: Math.max(passKey.maxUses - passKey.usedCount, 0),
      maxUses: passKey.maxUses,
      /** The party size on the hotel booking; the guest step will not exceed it. */
      maxGuests: passKey.maxGuests ?? null,
      bookableDates,
      /**
       * Evenings this key already has a live booking on. Booking a second
       * table on the same night is allowed — a guest with dinners to spare
       * often books for another room — but the guest is warned first, because
       * far more often they meant to change the booking they already have.
       */
      bookedDates: booked
        .filter((reservation) => reservation.status === "confirmed")
        .map((reservation) => reservation.date),
      // Named so the guest can see the key is theirs before going further.
      roomNumber: passKey.roomNumber ?? null,
    });
  } catch (error) {
    console.error("[booking] failed to check a pass-key", error);
    return NextResponse.json({ error: "Unable to check that pass-key right now." }, { status: 500 });
  }
}
