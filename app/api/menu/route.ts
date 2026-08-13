import { NextResponse } from "next/server";
import { getMenuCatalog } from "@/lib/services/restaurant";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const language = searchParams.get("language") ?? "en";
    const menu = await getMenuCatalog(language);
    return NextResponse.json(menu);
  } catch {
    return NextResponse.json({ error: "Unable to load menu." }, { status: 500 });
  }
}
