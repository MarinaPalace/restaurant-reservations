import { en } from "@/lib/i18n/en";
import { bg } from "@/lib/i18n/bg";
import { de } from "@/lib/i18n/de";
import { fr } from "@/lib/i18n/fr";
import { pl } from "@/lib/i18n/pl";
import { ro } from "@/lib/i18n/ro";
import { ru } from "@/lib/i18n/ru";

/**
 * The guest interface, in the languages the hotel serves.
 *
 * The menu itself has been translatable for a long time — every dish carries
 * its own translations — but the words around it did not: a Bulgarian guest
 * read their courses in Bulgarian and everything else, buttons included, in
 * English. That is the half of the screen that tells you what to do next.
 *
 * Three decisions worth knowing:
 *
 * - **Plain strings with `{placeholders}`, never functions.** The dictionary is
 *   resolved on the server and handed to client components through the React
 *   payload, and functions do not survive that boundary. `format` fills the
 *   gaps; `plural` picks a form through `Intl.PluralRules`, which is what the
 *   Slavic languages here need — Russian and Polish have three.
 * - **Missing keys fall back to English, one key at a time.** A translation
 *   file is a deep partial merged over the English master, so a language that
 *   is only half written shows English for the rest rather than a blank or a
 *   key name. It also means a new key added to `en.ts` never breaks a build.
 * - **Staff screens stay English.** `/admin` is a working tool used by one
 *   team; the guest screens are the ones read by people who have just arrived.
 */

export type Dictionary = typeof en;

/** What a translation file may provide: any subset, nested as deeply as it likes. */
export type PartialDictionary = DeepPartial<Dictionary>;

type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends string ? string : T[K] extends object ? DeepPartial<T[K]> : T[K];
};

export const DEFAULT_LANGUAGE = "en";

/** The cookie the guest's choice lives in. Read on the server, set on the client. */
export const LANGUAGE_COOKIE = "vdm-language";

/** A year: the choice should outlive a stay, and it carries no personal data. */
export const LANGUAGE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

const TRANSLATIONS: Record<string, PartialDictionary> = { bg, de, fr, pl, ro, ru };

/** Every language the interface itself is written in, English first. */
export const UI_LANGUAGES = [DEFAULT_LANGUAGE, ...Object.keys(TRANSLATIONS)];

export function isSupportedLanguage(value: string | undefined | null): boolean {
  return Boolean(value) && (value === DEFAULT_LANGUAGE || value! in TRANSLATIONS);
}

/**
 * Anything unrecognised reads as English. A guest whose cookie survives a
 * language being withdrawn sees the master copy, not an error.
 */
export function resolveLanguage(value: string | undefined | null): string {
  const code = (value ?? "").toLowerCase().split("-")[0];
  return isSupportedLanguage(code) ? code : DEFAULT_LANGUAGE;
}

function mergeInto<T>(base: T, overrides: unknown): T {
  if (!overrides || typeof overrides !== "object") {
    return base;
  }

  const merged: Record<string, unknown> = { ...(base as Record<string, unknown>) };

  for (const [key, value] of Object.entries(overrides as Record<string, unknown>)) {
    const current = merged[key];

    if (typeof value === "string") {
      // A blank translation is a gap, not a choice: fall back to English.
      merged[key] = value.length > 0 ? value : current;
    } else if (value && typeof value === "object" && current && typeof current === "object") {
      merged[key] = mergeInto(current, value);
    }
  }

  return merged as T;
}

const cache = new Map<string, Dictionary>();

export function getDictionary(language: string | undefined | null): Dictionary {
  const code = resolveLanguage(language);

  if (code === DEFAULT_LANGUAGE) {
    return en;
  }

  const cached = cache.get(code);
  if (cached) {
    return cached;
  }

  const merged = mergeInto(en, TRANSLATIONS[code]);
  cache.set(code, merged);
  return merged;
}

/**
 * Fills `{placeholders}`. An unknown placeholder is left standing rather than
 * blanked, so a mistake in a translation reads as an obvious defect instead of
 * a sentence quietly missing its subject.
 */
export function format(template: string, values: Record<string, string | number> = {}): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in values ? String(values[key]) : match,
  );
}

/**
 * Plural forms, chosen by the language's own rules.
 *
 * English needs two, Romanian three, Russian and Polish three or four — so the
 * category comes from `Intl.PluralRules` rather than from `count === 1`, which
 * is right in about half the languages here.
 */
export type PluralForms = {
  one: string;
  few?: string;
  many?: string;
  other: string;
};

export function plural(language: string, count: number, forms: PluralForms): string {
  const category = new Intl.PluralRules(resolveLanguage(language)).select(count);
  const template =
    (category === "one" && forms.one) ||
    (category === "few" && forms.few) ||
    (category === "many" && forms.many) ||
    forms.other;

  return format(template, { count });
}

/**
 * The locale to format dates and numbers with. `Intl` is happy with a bare
 * language code, and the regions the hotel's guests come from all use the same
 * day-month-year order, so nothing is gained by guessing a country.
 */
export function localeOf(language: string) {
  return resolveLanguage(language);
}
