import { NextResponse } from "next/server";
import { getMenuCatalog } from "@/lib/services/restaurant";

export async function GET(request: Request) {
  try {
    const language = new URL(request.url).searchParams.get("language") ?? "en";
    // Keeps an oversized query string out of the translation lookup.
    const safeLanguage = /^[a-z]{2,8}(-[a-z0-9]{2,8})?$/i.test(language) ? language : "en";

    return NextResponse.json(await getMenuCatalog(safeLanguage));
  } catch (error) {
    console.error("[menu] failed to load menu", error);
    return NextResponse.json({ error: "Unable to load menu." }, { status: 500 });
  }
}
