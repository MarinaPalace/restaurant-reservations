import { NextResponse } from "next/server";
import { isDenied, requireStaff } from "@/lib/auth/guard";
import { hasGuestLookupCandidates, parseGuestLookup } from "@/lib/guest-lookup";
import { findGuestBy } from "@/lib/services/guest-lookup";
import { checkRateLimit, clientKeyFrom } from "@/lib/rate-limit";

/**
 * Finding a guest from their card, at the desk.
 *
 * ## Why staff may look up by a reservation number and guests may not
 *
 * Guest self-service refuses to identify a booking by its number, deliberately:
 * guests read that number aloud to other rooms so they can be seated together,
 * so anyone who overheard it could cancel somebody's dinner. Staff are behind a
 * login, and the number is exactly what a guest hands them. The two lookups
 * therefore have to stay separate paths — this one must never become something
 * the guest flow calls.
 *
 * ## POST, for a thing that only reads
 *
 * The string being searched for can be a pass-key, and a pass-key must not
 * appear in a URL, browser history, a proxy log or a Referer header. That rule
 * decides the method here, not the semantics.
 */
export async function POST(request: Request) {
  const auth = await requireStaff();
  if (isDenied(auth)) {
    return auth;
  }

  /**
   * Limited even behind the login. A signed-in tablet left on the floor is the
   * account this protects against, and the limit is generous enough that a
   * receptionist scanning a queue of guests never meets it.
   */
  const limit = checkRateLimit(clientKeyFrom(request, "guest-lookup"), {
    limit: 60,
    windowMs: 60_000,
  });

  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many lookups. Please wait a moment.", code: "RATE_LIMITED" },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Scan a card or type a code." }, { status: 400 });
  }

  const raw = typeof (body as { query?: unknown })?.query === "string"
    ? (body as { query: string }).query
    : "";

  if (raw.trim().length === 0 || raw.length > 500) {
    return NextResponse.json({ error: "Scan a card or type a code." }, { status: 400 });
  }

  /**
   * Nothing recognisable is answered before any query runs, and it is not an
   * error: a card held at the wrong angle scans as a URL to somewhere else, and
   * the desk needs to be told to try again rather than shown a failure.
   */
  if (!hasGuestLookupCandidates(parseGuestLookup(raw))) {
    return NextResponse.json({
      candidates: {},
      matches: [],
      orphanReservations: [],
      unreadable: true,
    });
  }

  try {
    return NextResponse.json({ ...(await findGuestBy(raw)), unreadable: false });
  } catch (error) {
    console.error("[admin] guest lookup failed", error);
    return NextResponse.json({ error: "Unable to search just now." }, { status: 500 });
  }
}
