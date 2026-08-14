/**
 * The fourteen allergens EU food law requires to be declared.
 *
 * The editor offers these as a picker, but never limits what a menu may hold:
 * whatever is already on a dish is kept and shown alongside, so switching to
 * the picker cannot quietly drop an allergen someone typed by hand.
 */
export const STANDARD_ALLERGENS = [
  "Gluten",
  "Crustaceans",
  "Eggs",
  "Fish",
  "Peanuts",
  "Soy",
  "Milk",
  "Tree nuts",
  "Celery",
  "Mustard",
  "Sesame",
  "Sulphites",
  "Lupin",
  "Molluscs",
] as const;

/** The standard list plus anything this menu already uses, without duplicates. */
export function listAllergenChoices(existing: string[]) {
  const seen = new Map<string, string>();

  for (const allergen of [...STANDARD_ALLERGENS, ...existing]) {
    const key = allergen.trim().toLowerCase();
    if (key && !seen.has(key)) {
      seen.set(key, allergen.trim());
    }
  }

  return [...seen.values()];
}

export function hasAllergen(allergens: string[], candidate: string) {
  return allergens.some((entry) => entry.trim().toLowerCase() === candidate.trim().toLowerCase());
}

export function toggleAllergen(allergens: string[], candidate: string) {
  return hasAllergen(allergens, candidate)
    ? allergens.filter((entry) => entry.trim().toLowerCase() !== candidate.trim().toLowerCase())
    : [...allergens, candidate];
}
