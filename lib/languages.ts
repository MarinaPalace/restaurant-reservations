import type { MenuCourse } from "@/types/booking";

/** Languages the hotel offers by default, in menu order. */
export const SUPPORTED_LANGUAGES = ["en", "fr", "bg", "de", "ru", "pl", "ro"] as const;

export const LANGUAGE_NAMES: Record<string, string> = {
  en: "English",
  fr: "Français",
  bg: "Български",
  de: "Deutsch",
  ru: "Русский",
  pl: "Polski",
  ro: "Română",
  es: "Español",
  it: "Italiano",
  nl: "Nederlands",
  tr: "Türkçe",
  ar: "العربية",
};

export function isLanguageCode(value: string) {
  return /^[a-z]{2,8}$/.test(value);
}

/**
 * The supported set plus any extra language a translation has been written
 * for, so a language added in the editor shows up for guests automatically.
 */
export function listLanguages(courses: Pick<MenuCourse, "translations" | "options">[]) {
  const discovered = new Set<string>(SUPPORTED_LANGUAGES);

  for (const course of courses) {
    for (const code of Object.keys(course.translations ?? {})) {
      discovered.add(code.toLowerCase());
    }
    for (const option of course.options ?? []) {
      for (const code of Object.keys(option.translations ?? {})) {
        discovered.add(code.toLowerCase());
      }
    }
  }

  return [...discovered].sort((a, b) => {
    if (a === "en") return -1;
    if (b === "en") return 1;
    return a.localeCompare(b);
  });
}
