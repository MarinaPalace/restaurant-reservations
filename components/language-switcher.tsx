"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { useI18n } from "@/components/i18n-provider";
import { writeBookingSession } from "@/hooks/use-booking-session";
import { LANGUAGE_COOKIE, LANGUAGE_COOKIE_MAX_AGE, UI_LANGUAGES } from "@/lib/i18n";
import { LANGUAGE_NAMES } from "@/lib/languages";
import { cx } from "@/components/ui/utils";

/**
 * The language control, in the header of every guest screen.
 *
 * It used to sit on the menu step alone and change only the dishes, which meant
 * a guest reading Romanian had to reach the fourth screen before anything
 * changed, and the buttons never did. It belongs at the top of the first screen
 * a guest sees.
 *
 * The choice is written to a cookie — the server renders the next screen in
 * that language, so there is no flash of English — and mirrored into the
 * booking session, which is what the menu already reads for its own
 * translations. `router.refresh()` re-renders the current screen in place,
 * keeping whatever the guest has half-filled in.
 *
 * Every language is written in its own name. A guest looking for their language
 * is looking for the word they call it by, not for "Bulgarian".
 */
export function LanguageSwitcher({ className }: { className?: string }) {
  const { language } = useI18n();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const change = (next: string) => {
    if (next === language) {
      return;
    }

    document.cookie = `${LANGUAGE_COOKIE}=${encodeURIComponent(next)}; path=/; max-age=${LANGUAGE_COOKIE_MAX_AGE}; samesite=lax`;
    // The menu reads its language from the booking session; keeping the two in
    // step is what stops the dishes and the buttons disagreeing.
    writeBookingSession({ language: next });

    startTransition(() => {
      router.refresh();
    });
  };

  return (
    <label className={cx("relative inline-flex items-center", className)}>
      <span className="sr-only">Language</span>
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="pointer-events-none absolute left-2.5 size-4 text-ink-subtle"
      >
        <circle cx="12" cy="12" r="9" />
        <path d="M3 12h18M12 3a15 15 0 010 18a15 15 0 010-18z" />
      </svg>
      <select
        value={language}
        disabled={pending}
        onChange={(event) => change(event.target.value)}
        className="min-h-9 appearance-none rounded-full border border-line bg-surface py-1 pl-8 pr-3 text-sm font-medium text-ink outline-none focus:border-accent"
      >
        {UI_LANGUAGES.map((code) => (
          <option key={code} value={code}>
            {LANGUAGE_NAMES[code] ?? code.toUpperCase()}
          </option>
        ))}
      </select>
    </label>
  );
}
