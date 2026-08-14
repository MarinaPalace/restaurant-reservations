"use client";

import { useSyncExternalStore } from "react";
import { cx } from "@/components/ui/utils";

export const THEME_STORAGE_KEY = "theme";

export type ThemeChoice = "light" | "dark" | "system";

/**
 * Runs before the first paint, so a guest who chose dark never sees a flash of
 * the light palette. Kept as a string because it is injected into the document
 * head rather than bundled.
 */
export const THEME_INIT_SCRIPT = `(function(){try{var t=localStorage.getItem('${THEME_STORAGE_KEY}');if(t==='dark'||t==='light'){document.documentElement.setAttribute('data-theme',t);}}catch(e){}})();`;

const listeners = new Set<() => void>();

function readChoice(): ThemeChoice {
  const attribute = document.documentElement.getAttribute("data-theme");
  return attribute === "dark" || attribute === "light" ? attribute : "system";
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function applyChoice(choice: ThemeChoice) {
  if (choice === "system") {
    document.documentElement.removeAttribute("data-theme");
  } else {
    document.documentElement.setAttribute("data-theme", choice);
  }

  try {
    if (choice === "system") {
      localStorage.removeItem(THEME_STORAGE_KEY);
    } else {
      localStorage.setItem(THEME_STORAGE_KEY, choice);
    }
  } catch {
    // A guest with storage blocked still gets the theme for this visit.
  }

  for (const listener of listeners) {
    listener();
  }
}

const CHOICES: { id: ThemeChoice; label: string; icon: React.ReactNode }[] = [
  {
    id: "light",
    label: "Light",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="size-4">
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
      </svg>
    ),
  },
  {
    id: "system",
    label: "Auto",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="size-4">
        <rect x="2" y="4" width="20" height="13" rx="2" />
        <path d="M8 21h8M12 17v4" />
      </svg>
    ),
  },
  {
    id: "dark",
    label: "Dark",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="size-4">
        <path d="M21 12.8A9 9 0 1111.2 3a7 7 0 009.8 9.8z" />
      </svg>
    ),
  },
];

export function ThemeToggle({ className }: { className?: string }) {
  /**
   * The chosen theme lives on the document element, put there by the init
   * script before React runs. Reading it through an external store keeps the
   * server render ("system") and the client in agreement.
   */
  const choice = useSyncExternalStore(subscribe, readChoice, () => "system" as ThemeChoice);

  return (
    <div
      role="radiogroup"
      aria-label="Colour theme"
      className={cx("inline-flex items-center gap-0.5 rounded-full border border-line bg-surface p-0.5", className)}
    >
      {CHOICES.map((option) => {
        const isActive = choice === option.id;

        return (
          <button
            key={option.id}
            type="button"
            role="radio"
            aria-checked={isActive}
            title={option.label}
            onClick={() => applyChoice(option.id)}
            className={cx(
              "flex size-8 items-center justify-center rounded-full transition-colors",
              isActive ? "bg-primary text-primary-fg" : "text-ink-subtle hover:text-ink",
            )}
          >
            {option.icon}
            <span className="sr-only">{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}
