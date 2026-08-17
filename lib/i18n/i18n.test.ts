import { describe, expect, it } from "vitest";
import { en } from "@/lib/i18n/en";
import { bg } from "@/lib/i18n/bg";
import { de } from "@/lib/i18n/de";
import { fr } from "@/lib/i18n/fr";
import { pl } from "@/lib/i18n/pl";
import { ro } from "@/lib/i18n/ro";
import { ru } from "@/lib/i18n/ru";
import { format, getDictionary, plural, resolveLanguage, UI_LANGUAGES } from "@/lib/i18n";

const TRANSLATIONS = { bg, de, fr, pl, ro, ru } as Record<string, unknown>;

type Node = Record<string, unknown>;

/** Every leaf in a dictionary, as `a.b.c` paths mapped to their text. */
function flatten(node: Node, prefix = ""): Record<string, string> {
  const out: Record<string, string> = {};

  for (const [key, value] of Object.entries(node)) {
    const path = prefix ? `${prefix}.${key}` : key;

    if (typeof value === "string") {
      out[path] = value;
    } else if (value && typeof value === "object") {
      Object.assign(out, flatten(value as Node, path));
    }
  }

  return out;
}

function placeholdersOf(text: string) {
  return [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();
}

const english = flatten(en as unknown as Node);

describe("filling placeholders", () => {
  it("substitutes by name", () => {
    expect(format("Room {room} · {guests}", { room: "402", guests: "2 guests" })).toBe("Room 402 · 2 guests");
  });

  /** A missing value is a defect worth seeing, not a silently blank sentence. */
  it("leaves an unknown placeholder standing", () => {
    expect(format("Hello {name}", {})).toBe("Hello {name}");
  });
});

describe("plural forms", () => {
  it("uses two forms in English", () => {
    const forms = en.common.guestCount;
    expect(plural("en", 1, forms)).toBe("1 guest");
    expect(plural("en", 4, forms)).toBe("4 guests");
  });

  /**
   * The reason `Intl.PluralRules` is used rather than `count === 1`: Russian
   * needs three forms and picks them by the last digits, not by size.
   */
  it("uses three in Russian", () => {
    const forms = ru.common!.guestCount as { one: string; few: string; many: string; other: string };
    expect(plural("ru", 1, forms)).toBe("1 гость");
    expect(plural("ru", 2, forms)).toBe("2 гостя");
    expect(plural("ru", 5, forms)).toBe("5 гостей");
    expect(plural("ru", 21, forms)).toBe("21 гость");
  });

  it("uses three in Polish", () => {
    const forms = pl.common!.guestCount as { one: string; few: string; many: string; other: string };
    expect(plural("pl", 1, forms)).toBe("1 osoba");
    expect(plural("pl", 3, forms)).toBe("3 osoby");
    expect(plural("pl", 7, forms)).toBe("7 osób");
  });

  it("falls back to the other form when a language does not supply one", () => {
    expect(plural("bg", 5, { one: "{count} гост", other: "{count} гости" })).toBe("5 гости");
  });
});

describe("choosing a language", () => {
  it("accepts the languages the interface is written in", () => {
    expect(UI_LANGUAGES).toContain("en");
    for (const code of Object.keys(TRANSLATIONS)) {
      expect(UI_LANGUAGES).toContain(code);
    }
  });

  it("reads a regional tag as its language", () => {
    expect(resolveLanguage("de-AT")).toBe("de");
    expect(resolveLanguage("RU")).toBe("ru");
  });

  it("falls back to English for anything unknown", () => {
    expect(resolveLanguage("kl")).toBe("en");
    expect(resolveLanguage(undefined)).toBe("en");
    expect(resolveLanguage("")).toBe("en");
  });
});

describe("merging a translation over English", () => {
  it("returns the translated text where there is one", () => {
    expect(getDictionary("bg").common.continue).toBe("Напред");
  });

  /**
   * The whole point of the merge: a half-written language must degrade to
   * English one key at a time rather than showing blanks or key names.
   */
  it("falls back to English key by key", () => {
    const partial = getDictionary("bg");
    expect(partial.confirmation.googleCalendar).toBeTruthy();
    expect(typeof partial.errors.generic).toBe("string");
  });

  it("does not mutate the English master", () => {
    getDictionary("ru");
    expect(en.common.continue).toBe("Continue");
  });
});

describe("every translation matches the master", () => {
  for (const [code, dictionary] of Object.entries(TRANSLATIONS)) {
    const translated = flatten(dictionary as Node);

    it(`${code}: has no keys English does not have`, () => {
      // A stray key is a typo or a rename that was not carried through, and it
      // would silently never be shown.
      const strays = Object.keys(translated).filter((path) => !(path in english));
      expect(strays).toEqual([]);
    });

    it(`${code}: keeps the placeholders of each sentence`, () => {
      const mismatched = Object.entries(translated)
        .filter(([path, text]) => {
          const source = english[path];
          if (!source) {
            return false;
          }
          // Plural forms legitimately drop {count} in the "one" case ("One
          // dinner left"), so a translation may only use placeholders the
          // English sentence has — never invent new ones.
          return placeholdersOf(text).some((name) => !placeholdersOf(source).includes(name));
        })
        .map(([path]) => path);

      expect(mismatched).toEqual([]);
    });

    it(`${code}: covers the whole interface`, () => {
      // Not strictly required — English shows through — but a language offered
      // in the picker and only half written is worse than not offering it.
      const missing = Object.keys(english).filter((path) => {
        if (path in translated) {
          return false;
        }

        /**
         * `few` and `many` are only missing because the language has no such
         * category: German and Bulgarian have two forms, Romanian has no
         * `many`. `Intl.PluralRules` never asks for a form the language does
         * not use, and `plural` falls back to `other` regardless.
         */
        const [category, group] = [path.split(".").pop(), path.split(".").slice(0, -1).join(".")];
        return !((category === "few" || category === "many") && `${group}.other` in translated);
      });

      expect(missing).toEqual([]);
    });
  }
});
