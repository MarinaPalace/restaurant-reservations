import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { ADMIN_SESSION_COOKIE } from "@/lib/auth/session";

/**
 * Optimistic gate: bounces visitors with no session cookie away from the admin
 * area before a page is rendered. This is a redirect convenience only — every
 * admin page and API route still verifies the signed session itself, because
 * Proxy can be skipped by matcher changes and must never be the only check.
 */
export function proxy(request: NextRequest) {
  // The login page itself must stay reachable without a session.
  if (request.nextUrl.pathname === "/admin/login") {
    return NextResponse.next();
  }

  const hasSessionCookie = Boolean(request.cookies.get(ADMIN_SESSION_COOKIE)?.value);

  if (!hasSessionCookie) {
    const loginUrl = new URL("/admin/login", request.url);
    loginUrl.searchParams.set("next", request.nextUrl.pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/admin/:path*"],
};
