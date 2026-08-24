import { NextResponse } from "next/server";
import { isDenied, requireStaff } from "@/lib/auth/guard";
import { getAuditEntries } from "@/lib/services/audit-log";

/**
 * The log, newest first.
 *
 * It used to be open to anybody signed in, on the reasoning that a log
 * everybody can see is a log everybody knows is there. That reasoning was
 * right about logs and wrong about this one: every entry names a guest, a room
 * and what they changed, so the whole of it read end to end is a guest list —
 * and the account left signed in on a tablet on the floor holds
 * `service:record` and should hold nothing else.
 *
 * So it needs `audit:read`, checked here in the route. The owner keeps it
 * implicitly; a staff account is granted it deliberately.
 */
export async function GET(request: Request) {
  const auth = await requireStaff("audit:read");
  if (isDenied(auth)) {
    return auth;
  }

  try {
    const url = new URL(request.url);
    const reservationNumber = url.searchParams.get("reservationNumber") ?? undefined;
    const limit = Number(url.searchParams.get("limit"));

    return NextResponse.json({
      entries: await getAuditEntries({
        reservationNumber,
        limit: Number.isInteger(limit) && limit > 0 ? limit : undefined,
      }),
    });
  } catch (error) {
    console.error("[admin] failed to load the audit log", error);
    return NextResponse.json({ error: "Unable to load the log." }, { status: 500 });
  }
}
