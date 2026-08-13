import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifyAdminCredentials } from "@/lib/auth/admin";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const username = String(body?.username ?? "");
    const password = String(body?.password ?? "");

    if (!verifyAdminCredentials(username, password)) {
      return NextResponse.json({ error: "Invalid credentials." }, { status: 401 });
    }

    const cookieStore = await cookies();
    cookieStore.set("admin-auth", "true", {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 8,
    });

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Unable to sign in." }, { status: 500 });
  }
}
