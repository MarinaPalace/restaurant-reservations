import { NextResponse } from "next/server";
import { cookies } from "next/headers";

export async function POST() {
  const cookieStore = await cookies();
  cookieStore.set("admin-auth", "", {
    httpOnly: true,
    path: "/",
    expires: new Date(0),
  });

  return NextResponse.redirect(new URL("/admin/login", process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"));
}
