import { NextResponse } from "next/server";
import { getMenuCatalog } from "@/lib/services/restaurant";
import { menuCatalogSchema } from "@/lib/validation/booking";

export async function GET(request: Request) {
  try {
    const language = new URL(request.url).searchParams.get("language") ?? "en";
    // Keeps an oversized query string out of the translation lookup.
    const safeLanguage = /^[a-z]{2,8}(-[a-z0-9]{2,8})?$/i.test(language) ? language : "en";

    /**
     * Which catalogue. Promotions are one of the three, so the confirmation
     * screen asks for them by name rather than through a flag — and the
     * booking flow, which asks for `standard`, cannot be handed one by
     * accident.
     */
    const requested = new URL(request.url).searchParams.get("menu");
    const menu = menuCatalogSchema.safeParse(requested).data ?? "standard";

    return NextResponse.json(await getMenuCatalog(safeLanguage, menu));
  } catch (error) {
    console.error("[menu] failed to load menu", error);
    return NextResponse.json({ error: "Unable to load menu." }, { status: 500 });
  }
}
