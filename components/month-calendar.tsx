"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  addMonths,
  buildCalendarGrid,
  formatLongDate,
  formatMonthLabel,
  isSameMonth,
  startOfMonth,
  toDateKey,
} from "@/lib/date";
import { cx } from "@/components/ui/utils";

const WEEKDAYS = [
  { short: "Mon", long: "Monday" },
  { short: "Tue", long: "Tuesday" },
  { short: "Wed", long: "Wednesday" },
  { short: "Thu", long: "Thursday" },
  { short: "Fri", long: "Friday" },
  { short: "Sat", long: "Saturday" },
  { short: "Sun", long: "Sunday" },
];

export type DayState = {
  /** Not selectable, but still reachable by keyboard and announced. */
  disabled?: boolean;
  /** Short text under the day number, e.g. "12 left". */
  hint?: string;
  /** Extra context for screen readers, e.g. "fully booked". */
  status?: string;
  tone?: "default" | "muted" | "positive";
  /** An evening reserved for invited guests: gold, with a star. */
  premium?: boolean;
};

/**
 * One accessible month grid, shared by the guest booking flow and the admin
 * availability editor — which previously each carried their own copy, both
 * with the same UTC off-by-one bug and neither keyboard navigable.
 */
export function MonthCalendar({
  month,
  onMonthChange,
  selectedDate,
  onSelect,
  getDayState,
  minMonth,
  label,
}: {
  month: Date;
  onMonthChange: (month: Date) => void;
  selectedDate: string | null;
  onSelect: (dateKey: string) => void;
  getDayState: (dateKey: string, date: Date) => DayState;
  minMonth?: Date;
  label: string;
}) {
  const days = useMemo(() => buildCalendarGrid(month), [month]);
  const weeks = useMemo(
    () => Array.from({ length: 6 }, (_, index) => days.slice(index * 7, index * 7 + 7)),
    [days],
  );
  const [focusedKey, setFocusedKey] = useState<string | null>(null);
  const shouldRestoreFocus = useRef(false);
  const dayRefs = useRef(new Map<string, HTMLButtonElement>());

  // Moves real DOM focus to follow arrow-key navigation. Runs only after a
  // keyboard interaction, so it never steals focus on first render.
  useEffect(() => {
    if (!shouldRestoreFocus.current || !focusedKey) {
      return;
    }
    shouldRestoreFocus.current = false;
    dayRefs.current.get(focusedKey)?.focus();
  }, [focusedKey, month]);

  const canGoBack = !minMonth || startOfMonth(month) > startOfMonth(minMonth);

  const tabbableKey =
    (selectedDate && days.some((day) => toDateKey(day) === selectedDate) ? selectedDate : null) ??
    focusedKey ??
    toDateKey(days.find((day) => isSameMonth(day, month)) ?? days[0]);

  const moveFocus = (from: Date, deltaDays: number) => {
    const target = new Date(from);
    target.setDate(from.getDate() + deltaDays);

    if (minMonth && startOfMonth(target) < startOfMonth(minMonth)) {
      return;
    }

    shouldRestoreFocus.current = true;
    setFocusedKey(toDateKey(target));

    if (!isSameMonth(target, month)) {
      onMonthChange(startOfMonth(target));
    }
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, date: Date) => {
    const moves: Record<string, number> = {
      ArrowLeft: -1,
      ArrowRight: 1,
      ArrowUp: -7,
      ArrowDown: 7,
      PageUp: -28,
      PageDown: 28,
    };

    if (event.key in moves) {
      event.preventDefault();
      moveFocus(date, moves[event.key]);
      return;
    }

    if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      const weekday = (date.getDay() + 6) % 7;
      moveFocus(date, event.key === "Home" ? -weekday : 6 - weekday);
    }
  };

  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-2 rounded-control bg-surface-sunken p-2">
        <button
          type="button"
          onClick={() => onMonthChange(addMonths(month, -1))}
          disabled={!canGoBack}
          aria-label="Previous month"
          className="flex size-11 items-center justify-center rounded-control border border-line-strong bg-surface text-lg text-ink transition-colors hover:border-accent disabled:cursor-not-allowed disabled:opacity-40"
        >
          <span aria-hidden="true">←</span>
        </button>
        <div aria-live="polite" className="text-base font-semibold text-ink">
          {formatMonthLabel(month)}
        </div>
        <button
          type="button"
          onClick={() => onMonthChange(addMonths(month, 1))}
          aria-label="Next month"
          className="flex size-11 items-center justify-center rounded-control border border-line-strong bg-surface text-lg text-ink transition-colors hover:border-accent"
        >
          <span aria-hidden="true">→</span>
        </button>
      </div>

      {/* Follows the ARIA grid pattern: rows of gridcells, one roving tab stop,
          arrow keys to move between days. */}
      <div role="grid" aria-label={label} className="flex flex-col gap-1.5 sm:gap-2">
        <div role="row" className="grid grid-cols-7 gap-1.5 sm:gap-2">
          {WEEKDAYS.map((weekday) => (
            <div
              key={weekday.short}
              role="columnheader"
              aria-label={weekday.long}
              className="pb-1 text-center text-[11px] font-semibold uppercase tracking-wide text-ink-subtle"
            >
              <span aria-hidden="true">{weekday.short}</span>
            </div>
          ))}
        </div>

        {weeks.map((week) => (
          <div role="row" key={toDateKey(week[0])} className="grid grid-cols-7 gap-1.5 sm:gap-2">
            {week.map((date) => {
              const dateKey = toDateKey(date);
              const state = getDayState(dateKey, date);
              const isCurrentMonth = isSameMonth(date, month);
              const isSelected = selectedDate === dateKey;

              return (
                <button
                  key={dateKey}
                  ref={(node) => {
                    if (node) {
                      dayRefs.current.set(dateKey, node);
                    } else {
                      dayRefs.current.delete(dateKey);
                    }
                  }}
                  type="button"
                  role="gridcell"
                  tabIndex={dateKey === tabbableKey ? 0 : -1}
                  // aria-disabled rather than disabled: unavailable evenings
                  // stay reachable by keyboard so their reason is announced.
                  aria-disabled={state.disabled || undefined}
                  aria-selected={isSelected}
                  aria-label={`${formatLongDate(dateKey)}${state.status ? `, ${state.status}` : ""}`}
                  onKeyDown={(event) => handleKeyDown(event, date)}
                  onClick={() => {
                    if (!state.disabled) {
                      onSelect(dateKey);
                    }
                  }}
                  className={cx(
                    "relative flex min-h-16 flex-col justify-between rounded-control border p-1.5 text-left transition-colors sm:min-h-20 sm:p-2",
                    !isCurrentMonth && "opacity-45",
                    isSelected
                      ? "border-primary bg-primary text-primary-fg"
                      : state.premium
                        ? "border-gold bg-accent-soft text-accent-ink hover:border-accent"
                        : state.disabled
                          ? "cursor-not-allowed border-line bg-surface-muted text-ink-subtle"
                          : "border-line-strong bg-surface text-ink hover:border-accent",
                  )}
                >
                  <span className="flex items-center justify-between gap-1">
                    <span className="text-sm font-semibold sm:text-base" aria-hidden="true">
                      {date.getDate()}
                    </span>
                    {state.premium ? (
                      <svg
                        aria-hidden="true"
                        viewBox="0 0 24 24"
                        className={cx("size-3.5 shrink-0", isSelected ? "text-primary-fg" : "text-gold")}
                        fill="currentColor"
                      >
                        <path d="M12 2.6l2.7 5.9 6.4.7-4.8 4.3 1.3 6.3L12 16.7 6.4 19.8l1.3-6.3L2.9 9.2l6.4-.7z" />
                      </svg>
                    ) : null}
                  </span>
                  <span
                    aria-hidden="true"
                    className={cx(
                      "text-[10px] leading-tight",
                      isSelected
                        ? "text-primary-fg/80"
                        : state.tone === "positive"
                          ? "text-success"
                          : "text-ink-subtle",
                    )}
                  >
                    {state.hint ?? ""}
                  </span>
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
