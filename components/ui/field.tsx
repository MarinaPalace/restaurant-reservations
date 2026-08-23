"use client";

import {
  useId,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";
import { cx } from "@/components/ui/utils";
import { InfoTip } from "@/components/ui/tooltip";

const controlClasses =
  "w-full rounded-control border border-line-strong bg-surface px-4 py-3 text-ink outline-none transition " +
  "placeholder:text-ink-subtle focus:border-accent aria-[invalid=true]:border-danger";

/**
 * The same control at working density.
 *
 * A guest fills a booking form once and wants room to breathe; reception opens
 * the date editor forty times a day and wants the whole evening on one screen.
 * Same border, same focus ring, less air.
 */
const compactControlClasses =
  "w-full min-h-9 rounded-control border border-line-strong bg-surface px-2.5 py-1.5 text-sm text-ink outline-none " +
  "transition placeholder:text-ink-subtle focus:border-accent aria-[invalid=true]:border-danger";

/**
 * Wires a label, hint and error message to a control with the aria attributes
 * a screen reader needs, so error text is announced instead of being a red
 * paragraph that only sighted users can connect to the field.
 */
export function Field({
  label,
  hint,
  tip,
  tipAlign,
  error,
  compact = false,
  children,
}: {
  label: string;
  /**
   * A line that earns its place on the screen every time it is read — usually
   * because it changes: "8 already reserved", "guests may book until 15:00".
   *
   * Standing explanation belongs in `tip` instead. A paragraph under every
   * control is worth writing once and reading once, and after that it is only
   * something to scroll past.
   */
  hint?: string;
  /** The explanation, behind a mark beside the label. */
  tip?: ReactNode;
  /** `end` for a field near the right edge of a narrow panel. */
  tipAlign?: "start" | "end";
  error?: string;
  /** Tighter spacing, for a dense editing panel rather than a guest form. */
  compact?: boolean;
  children: (props: { id: string; "aria-describedby"?: string; "aria-invalid"?: boolean }) => ReactNode;
}) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(" ");

  return (
    <div className="w-full">
      <span className="flex items-center gap-1.5">
        <label htmlFor={id} className="block text-sm font-medium text-ink">
          {label}
        </label>
        {tip ? (
          <InfoTip label={`About ${label.toLowerCase()}`} align={tipAlign}>
            {tip}
          </InfoTip>
        ) : null}
      </span>
      {hint ? (
        <p id={hintId} className={cx("text-sm text-ink-muted", compact ? "mt-0.5 text-xs" : "mt-1")}>
          {hint}
        </p>
      ) : null}
      <div className={compact ? "mt-1.5" : "mt-2"}>
        {children({
          id,
          "aria-describedby": describedBy || undefined,
          "aria-invalid": error ? true : undefined,
        })}
      </div>
      {error ? (
        <p id={errorId} role="alert" className={cx("text-sm font-medium text-danger", compact ? "mt-1" : "mt-2")}>
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function Input({
  className,
  compact = false,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { compact?: boolean }) {
  return <input className={cx(compact ? compactControlClasses : controlClasses, className)} {...props} />;
}

export function Select({
  className,
  compact = false,
  children,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement> & { compact?: boolean }) {
  return (
    <select
      className={cx(compact ? compactControlClasses : controlClasses, "appearance-none", className)}
      {...props}
    >
      {children}
    </select>
  );
}

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cx(controlClasses, "min-h-24", className)} {...props} />;
}
