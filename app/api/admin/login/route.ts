import { NextResponse } from "next/server";
import { verifyAdminCredentials } from "@/lib/auth/admin";
import { AdminConfigError, startAdminSession } from "@/lib/auth/session";
import { adminLoginSchema } from "@/lib/validation/booking";

export async function POST(request: Request) {
  try {
    const parsed = adminLoginSchema.safeParse(await request.json());

    if (!parsed.success) {
      return NextResponse.json({ error: "Please enter a username and password." }, { status: 400 });
    }

    if (!(await verifyAdminCredentials(parsed.data.username, parsed.data.password))) {
      return NextResponse.json({ error: "Invalid credentials." }, { status: 401 });
    }

    await startAdminSession();
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof AdminConfigError) {
      console.error("[admin] misconfigured deployment", error);
      return NextResponse.json({ error: "Admin access is not configured on this server." }, { status: 503 });
    }

    console.error("[admin] login failed", error);
    return NextResponse.json({ error: "Unable to sign in." }, { status: 500 });
  }
}
