import { cookies, headers } from "next/headers";
import { getDictionary, isSupportedLanguage, LANGUAGE_COOKIE, resolveLanguage } from "@/lib/i18n";

/**
 * The language for this request.
 *
 * The guest's own choice wins and is remembered in a cookie. Failing that, the
 * browser is asked: somebody arriving from a QR code on a printed card has made
 * no choice yet, and `Accept-Language` is the only thing that knows they read
 * Polish. English is the last resort rather than the first.
 */
export async function getRequestLanguage(): Promise<string> {
  const chosen = (await cookies()).get(LANGUAGE_COOKIE)?.value;

  if (isSupportedLanguage(resolveLanguage(chosen)) && chosen) {
    return resolveLanguage(chosen);
  }

  const header = (await headers()).get("accept-language") ?? "";

  for (const part of header.split(",")) {
    // "bg-BG;q=0.9" → "bg"
    const code = part.split(";")[0]?.trim().toLowerCase().split("-")[0];
    if (code && isSupportedLanguage(code)) {
      return code;
    }
  }

  return "en";
}

/** The dictionary for this request, for use in a server component. */
export async function getRequestDictionary() {
  return getDictionary(await getRequestLanguage());
}
