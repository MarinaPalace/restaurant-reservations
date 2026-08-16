import { NextResponse } from "next/server";
import { AdminConfigError, getSessionUserId } from "@/lib/auth/session";
import { hasPermission } from "@/lib/auth/permissions";
import { getStaffUserById } from "@/lib/services/staff-users";
import type { Actor, StaffPermission, StaffUserRecord } from "@/types/booking";

/**
 * Authorisation for the admin API.
 *
 * Two things are checked, in this order and always in the route:
 *
 * 1. **Who is this?** A signed session naming an account that still exists and
 *    is still enabled. Disabling an account therefore takes effect on its next
 *    request, not when its cookie eventually expires.
 * 2. **May they do this?** The specific permission for the action. Hiding a
 *    button in the UI is not access control, so every route names the
 *    permission it needs.
 */

export type AuthorizedStaff = {
  user: StaffUserRecord;
  actor: Actor;
};

function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

function misconfigured(error: AdminConfigError) {
  console.error("[admin] misconfigured deployment", error);
  return NextResponse.json({ error: "Admin access is not configured on this server." }, { status: 503 });
}

/** The signed-in account, or `null`. Used by pages as well as routes. */
export async function getCurrentStaffUser(): Promise<StaffUserRecord | null> {
  const userId = await getSessionUserId();
  if (!userId) {
    return null;
  }

  const user = await getStaffUserById(userId);

  // The account may have been deleted or disabled since the cookie was issued.
  if (!user || !user.active) {
    return null;
  }

  return user;
}

export function toActor(user: StaffUserRecord): Actor {
  return { kind: "staff", id: user.id, name: user.name || user.username };
}

/**
 * Returns a response to send back when the caller may not proceed, or the
 * authorised account when they may.
 *
 * `permission` is optional only for routes that any signed-in member of staff
 * may call, such as reading the dashboard.
 */
export async function requireStaff(permission?: StaffPermission): Promise<NextResponse | AuthorizedStaff> {
  try {
    const user = await getCurrentStaffUser();

    if (!user) {
      return unauthorized();
    }

    if (permission && !hasPermission(user, permission)) {
      return NextResponse.json(
        {
          error: "Your account does not have permission to do that. Ask an administrator if you need it.",
          code: "FORBIDDEN",
        },
        { status: 403 },
      );
    }

    return { user, actor: toActor(user) };
  } catch (error) {
    if (error instanceof AdminConfigError) {
      return misconfigured(error);
    }
    throw error;
  }
}

/** Narrows the union `requireStaff` returns. */
export function isDenied(result: NextResponse | AuthorizedStaff): result is NextResponse {
  return result instanceof NextResponse;
}
