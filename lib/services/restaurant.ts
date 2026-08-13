import { getMockMenuCatalog, getMockRestaurantDate, getMockRestaurantDates } from "@/lib/db/mock-store";
import { isMongoConfigured } from "@/lib/db/connect";
import { MenuCourseModel } from "@/lib/models/menu-course";
import { MenuOptionModel } from "@/lib/models/menu-option";
import { RestaurantDateModel } from "@/lib/models/restaurant-date";
import { connectToDatabase } from "@/lib/db/connect";
import type { MenuCourse, RestaurantDateAvailability } from "@/types/booking";

export function getLocalizedText<T extends { name?: string; description?: string; translations?: Record<string, { name?: string; description?: string }> }>(item: T, language: string) {
  const locale = language?.toLowerCase() || "en";
  const translation = item.translations?.[locale] ?? {};

  return {
    name: translation.name || item.name || "",
    description: translation.description || item.description || "",
  };
}

export function localizeMenuCatalog(menu: MenuCourse[], language: string) {
  return menu.map((course) => ({
    ...course,
    name: getLocalizedText(course, language).name,
    description: getLocalizedText(course, language).description,
    options: course.options.map((option) => ({
      ...option,
      name: getLocalizedText(option, language).name,
      description: getLocalizedText(option, language).description,
    })),
  }));
}

export async function getRestaurantDates(): Promise<RestaurantDateAvailability[]> {
  if (!isMongoConfigured()) {
    return getMockRestaurantDates();
  }

  await connectToDatabase();
  const dates = await RestaurantDateModel.find().sort({ date: 1 }).lean();

  return dates.map((date) => ({
    date: String(date.date),
    isOpen: Boolean(date.isOpen),
    capacity: Number(date.capacity),
    reservedSeats: Number(date.reservedSeats),
    remainingSeats: Math.max(Number(date.capacity) - Number(date.reservedSeats), 0),
  }));
}

export async function getRestaurantDate(date: string): Promise<RestaurantDateAvailability | null> {
  if (!isMongoConfigured()) {
    return getMockRestaurantDate(date);
  }

  await connectToDatabase();
  const record = await RestaurantDateModel.findOne({ date }).lean();
  if (!record) {
    return null;
  }

  return {
    date: String(record.date),
    isOpen: Boolean(record.isOpen),
    capacity: Number(record.capacity),
    reservedSeats: Number(record.reservedSeats),
    remainingSeats: Math.max(Number(record.capacity) - Number(record.reservedSeats), 0),
  };
}

export async function getMenuCatalog(language = "en"): Promise<MenuCourse[]> {
  const menu = isMongoConfigured()
    ? await (async () => {
        await connectToDatabase();
        const courses = await MenuCourseModel.find({ active: true }).sort({ order: 1 }).lean();
        const options = await MenuOptionModel.find({ active: true }).lean();

        return courses.map((course) => ({
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
      })()
    : getMockMenuCatalog();

  return localizeMenuCatalog(menu, language);
}
