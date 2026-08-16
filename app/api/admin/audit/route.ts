import { NextResponse } from "next/server";
import { isDenied, requireStaff } from "@/lib/auth/guard";
import { getAuditEntries } from "@/lib/services/audit-log";

/**
 * The log, newest first. Any signed-in member of staff may read it — the point
 * of a log everybody can see is that everybody knows it is there.
 */
export async function GET(request: Request) {
  const auth = await requireStaff();
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
