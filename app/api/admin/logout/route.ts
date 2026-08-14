import { NextResponse } from "next/server";
import { endAdminSession } from "@/lib/auth/session";

export async function POST(request: Request) {
  await endAdminSession();

  /**
   * 303 turns the redirect into a GET. A 307 (the default) would replay the
   * POST against the login page, and the redirect target is derived from the
   * request so it works on any host, not just localhost.
   */
  return NextResponse.redirect(new URL("/admin/login", request.url), { status: 303 });
}
