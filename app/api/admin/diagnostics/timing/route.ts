import { NextResponse } from "next/server";
import mongoose from "mongoose";
import { isDenied, requireStaff } from "@/lib/auth/guard";
import { connectToDatabase, isMongoConfigured } from "@/lib/db/connect";
import { getStaffUserById } from "@/lib/services/staff-users";
import { getReservationsByDate } from "@/lib/services/reservations";
import { todayKey } from "@/lib/date";

/**
 * Where the time actually goes, measured from inside the deployment.
 *
 * `docs/performance.md` §1.2 asks which half of a slow admin request is at
 * fault, and the Vercel log only gives a total. The distinction that decides
 * the fix is **latency versus work**: a single round trip to the database
 * costs the same whether it reads one document or none, so if `pingMs` is
 * large then no query rewrite will help and the answer is where the function
 * runs relative to the cluster. If `pingMs` is small but a query is slow, the
 * query is the problem.
 *
 * Requires `users:manage` — it reports the deployment's region, its database
 * host and its collection sizes, which is not something every account on the
 * floor should be able to read.
 *
 * This is a diagnostic, not a health check: nothing polls it, and it is safe
 * to delete once the question it answers has been answered.
 */

export const dynamic = "force-dynamic";

/** Runs `work`, returning what it produced alongside how long it took. */
async function measure<T>(work: () => Promise<T>): Promise<{ ms: number; value: T }> {
  const started = performance.now();
  const value = await work();
  return { ms: Math.round(performance.now() - started), value };
}

export async function GET() {
  const auth = await requireStaff("users:manage");
  if (isDenied(auth)) {
    return auth;
  }

  /**
   * Reported before anything else is attempted. If this is false the
   * deployment is running on the local JSON store — see performance.md §3.5,
   * which would explain a great deal on its own.
   */
  if (!isMongoConfigured()) {
    return NextResponse.json({
      mongoConfigured: false,
      note: "MONGODB_URI is not set. The deployment is using the local JSON store.",
      region: process.env.VERCEL_REGION ?? null,
    });
  }

  try {
    // Whether this instance already had a live connection tells us if the
    // numbers below are a warm request or include the handshake.
    const wasWarm = mongoose.connection.readyState === 1;
    const connect = await measure(() => connectToDatabase());

    /**
     * The pure network round trip: a ping does no work at the server, so this
     * is the floor under *every* database call the app makes. Multiply it by
     * the number of queries a page runs to see the cost that cannot be
     * optimised away in application code.
     */
    const ping = await measure(async () => {
      await mongoose.connection.db?.admin().ping();
      return null;
    });

    // The lookup every admin page and route pays, via the auth guard.
    const sessionUser = await measure(() => getStaffUserById(auth.user.id));

    // §1.3 — how much data is actually there.
    const count = await measure(async () => {
      const collection = mongoose.connection.db?.collection("reservations");
      return (await collection?.estimatedDocumentCount()) ?? 0;
    });

    // The narrowed read the service board now does, for one evening.
    const boardQuery = await measure(() => getReservationsByDate(todayKey()));

    return NextResponse.json({
      mongoConfigured: true,
      region: process.env.VERCEL_REGION ?? null,
      environment: process.env.VERCEL_ENV ?? null,
      databaseHost: mongoose.connection.host ?? null,
      connectionWasWarm: wasWarm,
      reservationCount: count.value,
      boardRows: boardQuery.value.length,
      timings: {
        connectMs: connect.ms,
        pingMs: ping.ms,
        sessionUserLookupMs: sessionUser.ms,
        countMs: count.ms,
        boardQueryMs: boardQuery.ms,
      },
    });
  } catch (error) {
    console.error("[admin] timing diagnostics failed", error);
    return NextResponse.json({ error: "Unable to measure the database." }, { status: 500 });
  }
}
