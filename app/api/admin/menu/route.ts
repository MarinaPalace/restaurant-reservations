import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/auth/guard";
import { getFullMenuCatalog, saveMenuCatalog } from "@/lib/services/restaurant";
import { menuCatalogSchema, menuKindSchema } from "@/lib/validation/booking";
import type { MenuCourse } from "@/types/booking";

export async function GET(request: Request) {
  const unauthorized = await requireAdminApi();
  if (unauthorized) {
    return unauthorized;
  }

  try {
    const requested = new URL(request.url).searchParams.get("menu");
    const menu = menuKindSchema.safeParse(requested).data ?? "standard";

    return NextResponse.json(await getFullMenuCatalog(menu));
  } catch (error) {
    console.error("[admin] failed to load menu", error);
    return NextResponse.json({ error: "Unable to load menu." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const unauthorized = await requireAdminApi();
  if (unauthorized) {
    return unauthorized;
  }

  try {
    const parsed = menuCatalogSchema.safeParse(await request.json());

    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid menu structure." },
        { status: 400 },
      );
    }

    const courses = parsed.data.courses.map((course, index) => ({
      ...course,
      id: course.id ?? "",
      options: course.options.map((option) => ({ ...option, id: option.id ?? "", courseId: course.id ?? "" })),
      order: course.order ?? index + 1,
    })) as MenuCourse[];

    const menu = await saveMenuCatalog(courses, parsed.data.menu ?? "standard");
    return NextResponse.json({ ok: true, menu });
  } catch (error) {
    console.error("[admin] failed to save menu", error);
    return NextResponse.json({ error: "Unable to update menu." }, { status: 500 });
  }
}
