import { NextResponse } from "next/server";
import { isDenied, requireStaff } from "@/lib/auth/guard";
import { isValidDateKey } from "@/lib/date";
import { listSeatHolds, sweepExpiredHolds } from "@/lib/services/seat-holds";

/**
 * Bookings started on an evening — the ones still going, and the ones nobody
 * finished.
 *
 * This is the dashboard's answer to a conversation that happens at the desk
 * constantly and could not be settled: a guest says they booked, there is no
 * booking, and until now there was nothing to look at. Both sides of it were
 * invisible. Seats could be held out of the room with nothing on any screen
 * saying so, and an attempt that came to nothing left no trace at all.
 *
 * Behind `requireStaff` with no further permission, the same as the day's
 * reservations it sits beside: it names rooms and party sizes, which is what
 * the screen next to it already shows.
 */
export async function GET(request: Request) {
  const auth = await requireStaff();
  if (isDenied(auth)) {
    return auth;
  }

  const date = new URL(request.url).searchParams.get("date");

  if (!date || !isValidDateKey(date)) {
    return NextResponse.json({ error: "Please give a valid date." }, { status: 400 });
  }

  try {
    /**
     * Swept for real rather than throttled. Staff open this panel precisely
     * when they are asking whether an evening's held seats are genuine, and a
     * hold that ran out thirty seconds ago must read as abandoned by the time
     * they look — that is the question being asked.
     */
    await sweepExpiredHolds(date);

    return NextResponse.json({ holds: await listSeatHolds(date) });
  } catch (error) {
    console.error("[admin] failed to load seat holds", error);
    return NextResponse.json({ error: "Unable to load unfinished bookings." }, { status: 500 });
  }
}
