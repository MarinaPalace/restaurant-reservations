import { NextResponse } from "next/server";
import { getPassKeyByCode } from "@/lib/services/pass-keys";
import { getReservationsByPassKey } from "@/lib/services/reservations";
import { manageReservationSchema } from "@/lib/validation/booking";
import { checkRateLimit, clientKeyFrom } from "@/lib/rate-limit";
import { qrDataUri } from "@/lib/qr";
import { reportError } from "@/lib/observability";

/**
 * The code on a guest's confirmation card.
 *
 * ## Why this is a request at all
 *
 * `lib/qr.ts` records three earlier attempts at drawing codes in the browser
 * and why each failed — the worst of them printing a blank square and saying
 * nothing. So codes are drawn on the server, always. The confirmation screen
 * cannot be rendered on the server (the booking lives in `sessionStorage` and
 * is read in the browser), so it asks for the code instead.
 *
 * ## What it encodes, and what that means for access
 *
 * The reservation number, and nothing else. On its own that number authorises
 * nothing: guest self-service deliberately refuses to identify a booking by it,
 * because guests read it aloud to other rooms so they can be seated together.
 * Staff resolve it behind a login. That is what makes it safe to print large on
 * a card left face-up on a table.
 *
 * ## But the request is still authorised
 *
 * Not because the code is a secret — it is a picture of a number the caller
 * supplied — but because answering at all confirms the booking exists and
 * belongs to that key. An unauthenticated version would be a way to test
 * whether a reservation number is real, which is the first half of every
 * attempt on this system. So the pass-key comes with it, in the body rather
 * than the URL, and the answer for a key that does not hold that booking is the
 * same 404 as for no booking at all.
 */
const NOT_FOUND = { error: "We could not find that reservation." };

export async function POST(request: Request) {
  const limit = checkRateLimit(clientKeyFrom(request, "card"), { limit: 20, windowMs: 60_000 });

  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many attempts. Please wait a moment and try again.", code: "RATE_LIMITED" },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }

  try {
    const parsed = manageReservationSchema.safeParse(await request.json());

    if (!parsed.success) {
      return NextResponse.json({ error: "Please enter your pass-key." }, { status: 400 });
    }

    const passKey = await getPassKeyByCode(parsed.data.passKey);

    // A revoked key loses access to its bookings, the same rule self-service
    // applies. An expired or spent one keeps it: the guest still has to get
    // into the restaurant on the night.
    if (!passKey || passKey.status === "revoked") {
      return NextResponse.json(NOT_FOUND, { status: 404 });
    }

    const reservations = await getReservationsByPassKey(passKey.id);
    const wanted = parsed.data.reservationNumber?.trim().toUpperCase();

    /**
     * With one booking the number may be left out, which is the common case on
     * the confirmation screen. With several it has to be named, and it has to
     * be one of *this key's* — a number belonging to somebody else finds
     * nothing here.
     */
    const reservation = wanted
      ? reservations.find((entry) => entry.reservationNumber === wanted)
      : reservations.length === 1
        ? reservations[0]
        : null;

    if (!reservation) {
      return NextResponse.json(NOT_FOUND, { status: 404 });
    }

    const qr = await qrDataUri(reservation.reservationNumber);

    if (!qr) {
      // The card is still worth having without it: the number is printed on
      // the card in a size anybody can read out. Said plainly so the screen can
      // draw the card without waiting for a code that is not coming.
      return NextResponse.json({ qr: null }, { status: 200 });
    }

    return NextResponse.json({ qr });
  } catch (error) {
    reportError({ scope: "booking", event: "card:qr", error });
    return NextResponse.json({ error: "Unable to prepare your card." }, { status: 500 });
  }
}
