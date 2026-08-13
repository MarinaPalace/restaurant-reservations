import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { z } from "zod";
import { MenuCourseModel } from "@/lib/models/menu-course";
import { MenuOptionModel } from "@/lib/models/menu-option";
import { connectToDatabase, isMongoConfigured } from "@/lib/db/connect";
import { getMockMenuCatalog } from "@/lib/db/mock-store";
import { readMenuCatalogFile, saveMenuCatalogFile } from "@/lib/db/menu-storage";

const menuSchema = z.object({
  courses: z.array(
    z.object({
      id: z.string().optional(),
      order: z.number().int().min(1),
      name: z.string().min(1),
      description: z.string().default(""),
      required: z.boolean().default(true),
      active: z.boolean().default(true),
      imageUrl: z.string().default(""),
      translations: z.record(z.string(), z.object({ name: z.string().optional(), description: z.string().optional() })).optional(),
      options: z.array(
        z.object({
          id: z.string().optional(),
          name: z.string().min(1),
          description: z.string().default(""),
          allergens: z.array(z.string()).default([]),
          active: z.boolean().default(true),
          imageUrl: z.string().default(""),
          translations: z.record(z.string(), z.object({ name: z.string().optional(), description: z.string().optional() })).optional(),
        }),
      ),
    }),
  ),
});

export async function GET() {
  const cookieStore = await cookies();
  if (cookieStore.get("admin-auth")?.value !== "true") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!isMongoConfigured()) {
    const menu = await readMenuCatalogFile();
    return NextResponse.json(menu.length ? menu : getMockMenuCatalog());
  }

  await connectToDatabase();
  const courses = await MenuCourseModel.find({}).sort({ order: 1 }).lean();
  const options = await MenuOptionModel.find({}).lean();

  const menu = courses.map((course) => ({
    id: String(course._id),
    order: Number(course.order),
    name: String(course.name),
    description: String(course.description ?? ""),
    required: Boolean(course.required),
    active: Boolean(course.active),
    imageUrl: typeof course.imageUrl === "string" ? course.imageUrl : "",
    translations: course.translations ?? {},
    options: options
      .filter((option) => String(option.courseId) === String(course._id))
      .map((option) => ({
        id: String(option._id),
        courseId: String(option.courseId),
        name: String(option.name),
        description: String(option.description ?? ""),
        allergens: Array.isArray(option.allergens) ? option.allergens.map(String) : [],
        active: Boolean(option.active),
        imageUrl: typeof option.imageUrl === "string" ? option.imageUrl : "",
        translations: option.translations ?? {},
      })),
  }));

  return NextResponse.json(menu);
}

export async function POST(request: Request) {
  const cookieStore = await cookies();
  if (cookieStore.get("admin-auth")?.value !== "true") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const parsed = menuSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid menu structure." }, { status: 400 });
    }

    if (!isMongoConfigured()) {
      const saved = await saveMenuCatalogFile(parsed.data.courses);
      return NextResponse.json({ ok: true, menu: saved });
    }

    await connectToDatabase();

    await MenuOptionModel.deleteMany({});
    await MenuCourseModel.deleteMany({});

    const createdCourses = await Promise.all(
      parsed.data.courses.map((course) =>
        MenuCourseModel.create({
          order: course.order,
          name: course.name,
          description: course.description,
          required: course.required,
          active: course.active,
          imageUrl: course.imageUrl,
          translations: course.translations ?? {},
        }),
      ),
    );

    const inserts = [] as any[];
    for (const course of parsed.data.courses) {
      const createdCourse = createdCourses.find((entry) => entry.name === course.name && entry.order === course.order);
      if (!createdCourse) continue;

      for (const option of course.options) {
        inserts.push({
          courseId: String(createdCourse._id),
          name: option.name,
          description: option.description,
          allergens: option.allergens,
          active: option.active,
          imageUrl: option.imageUrl,
          translations: option.translations ?? {},
        });
      }
    }

    if (inserts.length) {
      await MenuOptionModel.insertMany(inserts);
    }

    return NextResponse.json({ ok: true, menu: parsed.data.courses });
  } catch {
    return NextResponse.json({ error: "Unable to update menu." }, { status: 500 });
  }
}
