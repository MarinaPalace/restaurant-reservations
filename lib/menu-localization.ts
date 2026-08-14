import type { MenuCourse } from "@/types/booking";

/**
 * Pure localization helpers.
 *
 * These live apart from `lib/services/restaurant.ts` because that module pulls
 * in Mongoose and the filesystem; client components need the localization
 * logic without dragging the server-only dependencies into the browser bundle.
 */

type Translatable = {
  name?: string;
  description?: string;
  translations?: Record<string, { name?: string; description?: string }>;
};

/** Falls back to the English copy whenever a translation is missing or blank. */
export function getLocalizedText<T extends Translatable>(item: T, language: string) {
  const locale = language?.toLowerCase() || "en";
  const translation = item.translations?.[locale] ?? {};

  return {
    name: translation.name || item.name || "",
    description: translation.description || item.description || "",
  };
}

export function localizeMenuCatalog<T extends MenuCourse>(menu: T[], language: string): T[] {
  return menu.map((course) => {
    const localizedCourse = getLocalizedText(course, language);

    return {
      ...course,
      name: localizedCourse.name,
      description: localizedCourse.description,
      options: course.options.map((option) => {
        const localizedOption = getLocalizedText(option, language);
        return { ...option, name: localizedOption.name, description: localizedOption.description };
      }),
    };
  });
}
