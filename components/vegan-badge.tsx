"use client";

import { useI18n } from "@/components/i18n-provider";
import { cx } from "@/components/ui/utils";

/**
 * Marks a dish as vegan. An inline SVG leaf rather than an emoji, so it keeps
 * its shape and colour across platforms and prints cleanly.
 */
export function VeganBadge({ className, compact = false }: { className?: string; compact?: boolean }) {
  const { t } = useI18n();

  return (
    <span
      className={cx(
        "inline-flex items-center gap-1 rounded-full border border-success/40 bg-success-soft font-semibold text-success",
        compact ? "px-1.5 py-0.5 text-[10px]" : "px-2 py-1 text-xs",
        className,
      )}
      title={t.common.vegan}
    >
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className={compact ? "size-3" : "size-3.5"}
      >
        {/* A leaf: the stem, then the blade curling off it. */}
        <path d="M4 20c0-7 5-12 16-13 0 8-4 13-11 13H4z" />
        <path d="M4 20c3-4 6-6 10-7.5" />
      </svg>
      {t.common.vegan}
    </span>
  );
}
