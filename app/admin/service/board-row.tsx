"use client";

import { Card } from "@/components/ui/card";
import { cx } from "@/components/ui/utils";
import type { BoardPlate, BoardTable } from "@/lib/service-board";

/**
 * One table's row, and the only place the board's controls are written.
 *
 * There are three ways to look at the evening — a list, a grid, and the room
 * itself — and every one of them ends in the same two questions: has this table
 * sat down, and has this course gone out. Writing the buttons once means the
 * three views cannot come to disagree about what a tap does, and that the rules
 * below hold whichever one is on screen.
 */

export type RowState = { pending: number; error: string | null };

/** What a tap does. Owned by the board, so optimistic state has one home. */
export type BoardActions = {
  seat: (table: BoardTable) => void;
  noShow: (table: BoardTable) => void;
  clearAttendance: (table: BoardTable) => void;
  toggleCourse: (table: BoardTable, courseId: string, served: boolean) => void;
  togglePlate: (table: BoardTable, courseId: string, plate: BoardPlate, served: boolean) => void;
};

export const clockOf = (iso: string) =>
  new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso));

/** Whether a seated table has nothing left to send. */
export function isFinished(table: BoardTable): boolean {
  return table.attendance === "seated" && table.courses.every((course) => course.outstanding === 0);
}

export function TableRow({
  table,
  row,
  canRecord,
  expanded,
  onExpand,
  actions,
  /** Drops the card border when the row is already inside one. */
  bare = false,
}: {
  table: BoardTable;
  row: RowState | undefined;
  canRecord: boolean;
  expanded: boolean;
  onExpand: () => void;
  actions: BoardActions;
  bare?: boolean;
}) {
  const seated = table.attendance === "seated";
  const Wrapper = bare ? "div" : Card;

  return (
    <Wrapper
      as="section"
      className={cx(
        "p-3 transition-colors sm:p-4",
        bare && "p-0 sm:p-0",
        !bare && table.attendance === "no-show" && "opacity-60",
        !bare && seated && "border-gold/40",
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex flex-wrap items-baseline gap-2">
            <span className="text-lg font-semibold text-ink sm:text-xl">
              {table.table ? `Table ${table.table}` : "No table yet"}
            </span>
            <span className="text-xs text-ink-muted sm:text-sm">
              {table.rooms.join(" + ")} · {table.guests} {table.guests === 1 ? "guest" : "guests"}
            </span>
          </p>

          {table.notes.length > 0 ? (
            <p className="mt-1 text-sm font-medium text-danger">{table.notes.join(" · ")}</p>
          ) : null}
          {table.extras.length > 0 ? (
            <p className="mt-0.5 text-sm font-medium text-accent-ink">+ {table.extras.join(", ")}</p>
          ) : null}
          {table.attendanceMixed ? (
            <p className="mt-0.5 text-xs text-ink-subtle">The rooms on this table are marked differently.</p>
          ) : null}
        </div>

        {/* The gate. Big, because it is pressed while walking. */}
        {canRecord ? (
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {table.attendance === null ? (
              <>
                <button
                  type="button"
                  onClick={() => actions.seat(table)}
                  className="min-h-12 rounded-control bg-primary px-5 text-base font-semibold text-primary-fg transition-colors hover:bg-primary-hover sm:min-h-14 sm:px-6"
                >
                  Seated
                </button>
                <button
                  type="button"
                  onClick={() => actions.noShow(table)}
                  className="min-h-12 rounded-control border border-line-strong px-3 text-sm font-medium text-ink-muted hover:border-danger hover:text-danger sm:min-h-14 sm:px-4"
                >
                  No-show
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => actions.clearAttendance(table)}
                className={cx(
                  "min-h-12 rounded-control border px-4 text-sm font-semibold transition-colors sm:min-h-14 sm:px-5",
                  seated ? "border-gold bg-accent-soft text-accent-ink" : "border-line-strong text-ink-muted",
                )}
              >
                {seated ? "✓ Seated" : "No-show"}
                <span className="ml-2 text-xs font-normal opacity-70">undo</span>
              </button>
            )}
          </div>
        ) : (
          <span className="text-sm font-medium text-ink-muted">
            {table.attendance === "seated" ? "Seated" : table.attendance === "no-show" ? "No-show" : "Waiting"}
          </span>
        )}
      </div>

      {/*
        Courses appear only once the table is seated: a table that has not sat
        down cannot have been served, and offering the cells first invites
        exactly that error.
      */}
      {seated ? (
        <div className="mt-3 border-t border-line pt-3">
          {/*
            A grid on a phone, where a 160px-wide cell means one per row and six
            courses fill the screen; flowing chips from `sm` up, where there is
            room for their natural width.
          */}
          <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center">
            {table.courses.map((course) => {
              const done = course.outstanding === 0;

              return (
                <button
                  key={course.courseId}
                  type="button"
                  disabled={!canRecord}
                  onClick={() => actions.toggleCourse(table, course.courseId, !done)}
                  aria-pressed={done}
                  className={cx(
                    "min-h-14 rounded-control border px-3 py-2 text-left transition-colors sm:min-h-16 sm:min-w-40 sm:px-4",
                    done
                      ? "border-success/40 bg-success-soft"
                      : course.served > 0
                        ? "border-gold/50 bg-accent-soft"
                        : "border-line-strong bg-surface hover:border-accent",
                    !canRecord && "cursor-default",
                  )}
                >
                  <span className={cx("block truncate text-sm font-semibold", done ? "text-success" : "text-ink")}>
                    {done ? "✓ " : ""}
                    {course.courseName}
                    {!done && course.served > 0 ? (
                      <span className="ml-1 font-normal text-ink-muted">
                        {course.served}/{course.plates.length}
                      </span>
                    ) : null}
                  </span>

                  {/*
                    Which dishes, not just how many. "2 Amuse Bouche" does not
                    tell a waiter what to carry; "2 x Salmon, 1 x Veloute" does.
                  */}
                  <span className="mt-0.5 block truncate text-xs text-ink-muted">
                    {done && course.servedAt
                      ? clockOf(course.servedAt)
                      : course.summary.map((entry) => `${entry.count} × ${entry.optionName}`).join(" · ")}
                  </span>
                </button>
              );
            })}
          </div>

          {/*
            Per guest, on demand. An allergy note says "guest 2 is allergic to
            gluten", so the board has to be able to say what guest 2 is actually
            eating — and to send that one plate out separately from the rest.
          */}
          <button
            type="button"
            onClick={onExpand}
            className="mt-2 min-h-11 text-sm font-medium text-accent-ink underline underline-offset-4"
            aria-expanded={expanded}
          >
            {expanded ? "Hide each guest" : "Show what each guest chose"}
          </button>

          {expanded ? (
            <div className="mt-2 space-y-3">
              {table.courses.map((course) => (
                <div key={course.courseId}>
                  <p className="text-xs font-semibold uppercase tracking-wide text-ink-subtle">{course.courseName}</p>
                  <div className="mt-1 grid grid-cols-2 gap-1.5 lg:grid-cols-3">
                    {course.plates.map((plate) => {
                      const out = Boolean(plate.servedAt);

                      return (
                        <button
                          key={`${plate.reservationNumber}-${plate.guestIndex}`}
                          type="button"
                          disabled={!canRecord}
                          aria-pressed={out}
                          onClick={() => actions.togglePlate(table, course.courseId, plate, !out)}
                          className={cx(
                            "flex min-h-12 items-center justify-between gap-3 rounded-control border px-3 py-2 text-left transition-colors",
                            out ? "border-success/40 bg-success-soft" : "border-line bg-surface hover:border-accent",
                            !canRecord && "cursor-default",
                          )}
                        >
                          <span className="min-w-0">
                            <span className="block text-xs text-ink-subtle">{plate.label}</span>
                            <span
                              className={cx("block truncate text-sm font-medium", out ? "text-success" : "text-ink")}
                            >
                              {out ? "✓ " : ""}
                              {plate.optionName}
                            </span>
                          </span>
                          {out && plate.servedAt ? (
                            <span className="shrink-0 text-xs tabular-nums text-ink-muted">
                              {clockOf(plate.servedAt)}
                            </span>
                          ) : null}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      {/* The failure belongs to its row, never to the page. */}
      {row?.error ? (
        <p className="mt-3 text-sm font-medium text-danger" role="alert">
          {row.error} — tap again to retry.
        </p>
      ) : null}
    </Wrapper>
  );
}
