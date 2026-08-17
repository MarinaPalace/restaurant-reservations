"use client";

import { createContext, useContext, type ReactNode } from "react";
import { getDictionary, type Dictionary } from "@/lib/i18n";

/**
 * The chosen language and its dictionary, for client components.
 *
 * Resolved once on the server and handed down, so every screen — server-
 * rendered or not — agrees on the language for the same request, and there is
 * no flash of English before a client effect catches up.
 *
 * The dictionary is plain strings, which is what lets it cross the server /
 * client boundary at all.
 */
const I18nContext = createContext<{ language: string; t: Dictionary }>({
  language: "en",
  t: getDictionary("en"),
});

export function I18nProvider({
  language,
  dictionary,
  children,
}: {
  language: string;
  dictionary: Dictionary;
  children: ReactNode;
}) {
  return <I18nContext.Provider value={{ language, t: dictionary }}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  return useContext(I18nContext);
}
