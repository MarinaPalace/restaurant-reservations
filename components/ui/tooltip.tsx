"use client";

import { useId, useState, type ReactNode } from "react";
import { cx } from "@/components/ui/utils";

/**
 * A small "why is this here" mark that gives up its explanation on demand.
 *
 * ## What it is for
 *
 * The date editor had a paragraph under every control. Each one was worth
 * writing and none of them was worth reading twice, and together they made a
 * panel somebody uses forty times a day into something that has to be scrolled.
 * Explanation that is only needed the first time belongs behind a tip; a number
 * that changes — "8 already reserved" — belongs on the screen.
 *
 * ## Hover and focus, never a click to pin
 *
 * Deliberately not a toggle. A pinned tooltip has to be dismissed, which means
 * a click-outside listener, an Escape handler and a way to be left open over
 * the control it describes.
 *
 * Showing on hover **and focus** covers every input without any of that:
 * a pointer hovers, a keyboard tabs to it, and a touch tap focuses the button —
 * which is why the trigger is a real `<button>` rather than a styled span.
 * Tapping anywhere else blurs it and the tip goes away, with nothing listening.
 *
 * `aria-describedby` ties the text to the trigger, so a screen reader reads the
 * explanation as part of the control rather than as a stray paragraph. The
 * trigger is `aria-hidden` to nothing and carries a real label, because "ⓘ"
 * announced on its own says nothing at all.
 */
export function InfoTip({
  label,
  children,
  align = "start",
}: {
  /** What this explains, e.g. "About total seats". Read aloud; never decorative. */
  label: string;
  children: ReactNode;
  /**
   * Which edge of the tip lines up with the trigger.
   *
   * `end` for a trigger sitting near the right of a narrow panel, where a tip
   * growing rightwards would run off the edge. There is no collision detection:
   * this panel is a known width and one prop is a great deal less to go wrong
   * than measuring the viewport on every hover.
   */
  align?: "start" | "end";
}) {
  const id = useId();
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const shown = hovered || focused;

  return (
    <span className="relative inline-flex align-middle">
      <button
        type="button"
        aria-label={label}
        aria-describedby={shown ? id : undefined}
        onPointerEnter={() => setHovered(true)}
        onPointerLeave={() => setHovered(false)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        // Nothing to submit and nothing to toggle: the button exists so that a
        // keyboard and a touch screen can reach what a pointer gets by hovering.
        onClick={(event) => event.preventDefault()}
        className={cx(
          "inline-flex size-4 shrink-0 items-center justify-center rounded-full border text-[10px] font-bold leading-none transition-colors",
          shown
            ? "border-accent bg-accent-soft text-accent-ink"
            : "border-line-strong bg-surface text-ink-subtle hover:border-accent",
        )}
      >
        <span aria-hidden="true">i</span>
      </button>

      {shown ? (
        <span
          role="tooltip"
          id={id}
          className={cx(
            "absolute top-full z-30 mt-1.5 w-56 rounded-control border border-line-strong bg-surface p-2.5",
            "text-left text-xs font-normal leading-relaxed text-ink-muted shadow-card",
            align === "end" ? "right-0" : "left-0",
          )}
        >
          {children}
        </span>
      ) : null}
    </span>
  );
}

/**
 * A label with its explanation tucked behind a tip.
 *
 * Exists so that the label and the mark cannot drift apart in spacing across
 * the dozen places that want the pair, and so `label` is written once rather
 * than repeated into the tip's `aria-label`.
 */
export function LabelWithTip({
  label,
  tip,
  align,
  className,
  htmlFor,
}: {
  label: string;
  tip?: ReactNode;
  align?: "start" | "end";
  className?: string;
  htmlFor?: string;
}) {
  const Text = htmlFor ? "label" : "span";

  return (
    <span className={cx("inline-flex items-center gap-1.5", className)}>
      <Text htmlFor={htmlFor} className="text-sm font-medium text-ink">
        {label}
      </Text>
      {tip ? (
        <InfoTip label={`About ${label.toLowerCase()}`} align={align}>
          {tip}
        </InfoTip>
      ) : null}
    </span>
  );
}
