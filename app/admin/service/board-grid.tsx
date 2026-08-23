"use client";

import { useMemo } from "react";
import { cx } from "@/components/ui/utils";
import type { BoardTable } from "@/lib/service-board";
import { clockOf, type BoardActions, type RowState } from "@/app/admin/service/board-row";

/**
 * The evening as a sheet: a row per table, a column per course.
 *
 * ## Why this exists beside the list
 *
 * It is the shape of the paper it replaces. A service sheet is a grid — the
 * tables down one side, the courses across the top, and a tick where they meet
 * — and somebody who has run a restaurant off that page for years can read this
 * without being taught anything. The list is better on a phone and better for
 * one table at a time; this is better for the question the grid was always for,
 * which is *what is the whole room waiting on*.
 *
 * Reading a column answers it at a glance. Reading a row answers "where has
 * table 7 got to". Neither is a scroll.
 *
 * ## What a cell is
 *
 * The same tap as the list's course chip, in less space: a whole course out, or
 * back again. `2/4` means a course part-sent, which happens when plates went
 * out one at a time from the per-guest view — the grid can show that state
 * honestly even though it cannot create it.
 *
 * A table that has not sat down has no cells at all, only its Seated button.
 * A table that has not been served cannot have been, and a grid of live-looking
 * cells above an empty chair is exactly the mis-tap the list avoids by hiding
 * them.
 *
 * ## Order never changes
 *
 * Rule 2.14 again. The rows are in the order the board handed them over and
 * marking one must not move it, because a row that shifts under a finger is how
 * the wrong table gets ticked.
 */
export function BoardGrid({
  tables,
  rows,
  canRecord,
  actions,
  onOpen,
}: {
  tables: BoardTable[];
  rows: Record<string, RowState>;
  canRecord: boolean;
  actions: BoardActions;
  /** Opens one table in the list view, for the per-guest plates. */
  onOpen: (table: BoardTable) => void;
}) {
  /**
   * The columns, taken from the tables rather than assumed.
   *
   * Every table on one evening is served from one catalogue, so in practice
   * they agree — but taking the union in `order` means a table that somehow
   * carries a course the others do not gets a column instead of losing its
   * plates off the side of the sheet.
   */
  const courses = useMemo(() => {
    const seen = new Map<string, { courseId: string; courseName: string; order: number }>();

    for (const table of tables) {
      for (const course of table.courses) {
        if (!seen.has(course.courseId)) {
          seen.set(course.courseId, {
            courseId: course.courseId,
            courseName: course.courseName,
            order: course.order,
          });
        }
      }
    }

    return [...seen.values()].sort((a, b) => a.order - b.order);
  }, [tables]);

  return (
    /*
      The sheet scrolls sideways inside its own box rather than making the page
      do it. Six courses plus the table details is wider than a phone, and a
      page that scrolls horizontally loses the header and the outstanding strip
      with it.
    */
    <div className="overflow-x-auto rounded-card border border-line bg-surface">
      <table className="w-full min-w-[42rem] border-collapse text-left">
        <thead>
          <tr className="border-b border-line-strong">
            <th scope="col" className="sticky left-0 z-10 bg-surface p-2 text-xs font-semibold uppercase tracking-wide text-ink-subtle sm:p-3">
              Table
            </th>
            <th scope="col" className="p-2 text-xs font-semibold uppercase tracking-wide text-ink-subtle sm:p-3">
              Arrived
            </th>
            {courses.map((course) => (
              <th
                key={course.courseId}
                scope="col"
                className="p-2 text-xs font-semibold uppercase tracking-wide text-ink-subtle sm:p-3"
              >
                {course.courseName}
              </th>
            ))}
          </tr>
        </thead>

        <tbody>
          {tables.map((table) => {
            const seated = table.attendance === "seated";
            const row = rows[table.key];

            return (
              <tr
                key={table.key}
                className={cx(
                  "border-b border-line last:border-0",
                  table.attendance === "no-show" && "opacity-55",
                  seated && "bg-accent-soft/30",
                )}
              >
                {/* Sticky, so the table number stays readable while the
                    courses scroll past it — the whole point of a sheet. */}
                <th
                  scope="row"
                  className={cx(
                    "sticky left-0 z-10 p-2 align-top font-normal sm:p-3",
                    seated ? "bg-[color-mix(in_oklab,var(--accent-soft)_30%,var(--surface))]" : "bg-surface",
                  )}
                >
                  <button
                    type="button"
                    onClick={() => onOpen(table)}
                    className="text-left"
                    aria-label={`Open table ${table.table || table.rooms.join(" and ")}`}
                  >
                    <span className="block text-sm font-semibold text-ink">
                      {table.table ? table.table : "—"}
                    </span>
                    <span className="block text-xs text-ink-muted">
                      {table.rooms.join(" + ")} · {table.guests}
                    </span>
                  </button>
                  {table.notes.length > 0 ? (
                    <span className="mt-0.5 block text-xs font-medium text-danger">{table.notes.join(" · ")}</span>
                  ) : null}
                  {table.extras.length > 0 ? (
                    <span className="mt-0.5 block text-xs font-medium text-accent-ink">
                      + {table.extras.join(", ")}
                    </span>
                  ) : null}
                  {row?.error ? (
                    <span className="mt-0.5 block text-xs font-medium text-danger" role="alert">
                      {row.error}
                    </span>
                  ) : null}
                </th>

                <td className="p-2 align-top sm:p-3">
                  {canRecord ? (
                    table.attendance === null ? (
                      <div className="flex flex-col gap-1">
                        <button
                          type="button"
                          onClick={() => actions.seat(table)}
                          className="min-h-9 rounded-control bg-primary px-3 text-sm font-semibold text-primary-fg transition-colors hover:bg-primary-hover"
                        >
                          Seated
                        </button>
                        <button
                          type="button"
                          onClick={() => actions.noShow(table)}
                          className="min-h-8 rounded-control border border-line-strong px-2 text-xs font-medium text-ink-muted hover:border-danger hover:text-danger"
                        >
                          No-show
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => actions.clearAttendance(table)}
                        className={cx(
                          "min-h-9 rounded-control border px-2.5 text-sm font-semibold transition-colors",
                          seated ? "border-gold bg-accent-soft text-accent-ink" : "border-line-strong text-ink-muted",
                        )}
                      >
                        {seated ? "✓" : "No-show"}
                      </button>
                    )
                  ) : (
                    <span className="text-sm text-ink-muted">
                      {seated ? "Seated" : table.attendance === "no-show" ? "No-show" : "—"}
                    </span>
                  )}
                </td>

                {courses.map((column) => {
                  const course = table.courses.find((entry) => entry.courseId === column.courseId);

                  // No plates of this course at this table, or the table has
                  // not sat down: nothing to tick, so nothing that looks like it.
                  if (!course || course.plates.length === 0 || !seated) {
                    return (
                      <td key={column.courseId} className="p-2 align-top text-center text-ink-subtle sm:p-3">
                        ·
                      </td>
                    );
                  }

                  const done = course.outstanding === 0;
                  const part = course.served > 0 && !done;

                  return (
                    <td key={column.courseId} className="p-1.5 align-top sm:p-2">
                      <button
                        type="button"
                        disabled={!canRecord}
                        aria-pressed={done}
                        aria-label={`${column.courseName} for table ${table.table || table.rooms.join(" and ")}`}
                        onClick={() => actions.toggleCourse(table, column.courseId, !done)}
                        className={cx(
                          "flex min-h-11 w-full flex-col justify-center rounded-control border px-2 py-1 text-center transition-colors",
                          done
                            ? "border-success/40 bg-success-soft text-success"
                            : part
                              ? "border-gold/50 bg-accent-soft text-accent-ink"
                              : "border-line-strong bg-surface text-ink hover:border-accent",
                          !canRecord && "cursor-default",
                        )}
                      >
                        <span className="text-sm font-semibold tabular-nums">
                          {done ? "✓" : part ? `${course.served}/${course.plates.length}` : course.plates.length}
                        </span>
                        <span className="truncate text-[10px] leading-tight text-ink-muted">
                          {done && course.servedAt
                            ? clockOf(course.servedAt)
                            : course.summary.map((entry) => entry.optionName).join(", ")}
                        </span>
                      </button>
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
