import { NextResponse } from "next/server";
import { AdminConfigError, isAdminAuthenticated } from "@/lib/auth/session";

/**
 * Returns a response to send back when the caller is not an authenticated
 * admin, or `null` when the request may proceed.
 */
export async function requireAdminApi(): Promise<NextResponse | null> {
  try {
    if (await isAdminAuthenticated()) {
      return null;
    }
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  } catch (error) {
    if (error instanceof AdminConfigError) {
      console.error("[admin] misconfigured deployment", error);
      return NextResponse.json({ error: "Admin access is not configured on this server." }, { status: 503 });
    }
    throw error;
  }
}
