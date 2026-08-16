import { NextResponse } from "next/server";
import { verifyAdminCredentials } from "@/lib/auth/admin";
import { AdminConfigError, ENVIRONMENT_ADMIN_ID, startAdminSession } from "@/lib/auth/session";
import { verifyStaffCredentials } from "@/lib/services/staff-users";
import { adminLoginSchema } from "@/lib/validation/booking";
import { checkRateLimit, clientKeyFrom } from "@/lib/rate-limit";

export async function POST(request: Request) {
  // Slower than the guest limits: a member of staff mistyping a password a
  // few times is normal, a script trying hundreds is not.
  const limit = checkRateLimit(clientKeyFrom(request, "admin-login"), { limit: 10, windowMs: 5 * 60_000 });

  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many sign-in attempts. Please wait a few minutes and try again." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }

  try {
    const parsed = adminLoginSchema.safeParse(await request.json());

    if (!parsed.success) {
      return NextResponse.json({ error: "Please enter a username and password." }, { status: 400 });
    }

    const { username, password } = parsed.data;

    /**
     * Staff accounts first, the environment owner account second.
     *
     * The order matters: it means the owner credentials keep working even
     * after accounts exist, so a deployment can always be recovered, while a
     * named account is preferred whenever there is one — the audit log is only
     * useful if it names a person rather than "admin".
     */
    const staffUser = await verifyStaffCredentials(username, password);

    if (staffUser) {
      await startAdminSession(staffUser.id);
      return NextResponse.json({ ok: true });
    }

    if (await verifyAdminCredentials(username, password)) {
      await startAdminSession(ENVIRONMENT_ADMIN_ID);
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: "Invalid credentials." }, { status: 401 });
  } catch (error) {
    if (error instanceof AdminConfigError) {
      console.error("[admin] misconfigured deployment:", error.message);
      // The specific variable is named so staff can fix the deployment. No
      // secret material is exposed, and a 503 already reveals that the admin
      // area is unconfigured.
      return NextResponse.json(
        { error: `Admin access is not configured on this server. ${error.message}` },
        { status: 503 },
      );
    }

    console.error("[admin] login failed", error);
    return NextResponse.json({ error: "Unable to sign in." }, { status: 500 });
  }
}
