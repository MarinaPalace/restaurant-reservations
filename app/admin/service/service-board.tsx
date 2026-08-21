"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardHeader } from "@/components/ui/card";
import { Button, ButtonLink } from "@/components/ui/button";
import { Alert, EmptyState } from "@/components/ui/feedback";
import { cx } from "@/components/ui/utils";
import { createSequentialSaver } from "@/lib/sequential-save";
import { boardSummary, outstandingPlates, type BoardTable } from "@/lib/service-board";
import { formatLongDate } from "@/lib/date";

/**
 * The service board.
 *
 * A screen that lives at the pass during service, on a tablet, used standing up
 * and one-handed. That decides most of what follows.
 *
 * ## Marks apply immediately and reconcile afterwards
 *
 * The floor is not the office. A tap paints straight away and the request
 * follows; if it fails, the failure appears **on its own row** and the mark
 * rolls back there — never as a page-level error that loses the other twenty
 * rows' worth of work.
 *
 * Per-row saves go through `lib/sequential-save.ts`, the same module the
 * promotions screen uses: two taps on one row must reach the server in the
 * order they were made, and only the newest may write to the screen.
 *
 * ## Nothing moves under a finger
 *
 * Rule 2.14. The row order is fixed for the life of the screen — seating a
 * table must not re-sort the list, because a list that re-orders while somebody
 * is reaching for it is how the wrong table gets marked.
 *
 * ## Polling, not sockets
 *
 * Vercel's functions do not hold WebSockets and SSE would pin an invocation per
 * open board. Thirty rows fit on a screen; a poll every few seconds is simpler
 * and survives a flaky connection by construction. It pauses when the tab is
 * hidden, so a tablet left in a drawer is not polling all night, and it never
 * overwrites a row whose own mark is still in flight.
 */

const POLL_MS = 5000;

type RowState = { pending: number; error: string | null };

export function ServiceBoard({
  initialTables,
  date,
  isToday,
  canRecord,
}: {
  initialTables: BoardTable[];
  date: string;
  isToday: boolean;
  /** The route enforces this too (rule 2.5); this only avoids offering a control that would fail. */
  canRecord: boolean;
}) {
  const router = useRouter();
  const [tables, setTables] = useState(initialTables);
  const [rows, setRows] = useState<Record<string, RowState>>({});
  const [closing, setClosing] = useState(false);
  const [notice, setNotice] = useState("");

  /** Rows with a mark still in flight. A poll must leave these alone. */
  const inFlight = useRef(new Set<string>());
  const saversRef = useRef(new Map<string, ReturnType<typeof createSequentialSaver>>());

  const saverFor = (key: string) => {
    const existing = saversRef.current.get(key);
    if (existing) {
      return existing;
    }
    const saver = createSequentialSaver();
    saversRef.current.set(key, saver);
    return saver;
  };

  // Server-rendered updates replace the board, except where a tap is pending.
  useEffect(() => {
    setTables((current) =>
      initialTables.map((incoming) => {
        const isPending = inFlight.current.has(incoming.key);
        return isPending ? (current.find((table) => table.key === incoming.key) ?? incoming) : incoming;
      }),
    );
  }, [initialTables]);

  /**
   * Refresh from the server on a timer.
   *
   * `router.refresh()` re-runs the server component, which is where the board
   * is built — no second endpoint, no duplicate aggregation.
   */
  useEffect(() => {
    if (!isToday) {
      return;
    }

    let timer: ReturnType<typeof setInterval> | null = null;

    const start = () => {
      timer ??= setInterval(() => {
        // Nothing to reconcile while a tap is unacknowledged.
        if (inFlight.current.size === 0) {
          router.refresh();
        }
      }, POLL_MS);
    };

    const stop = () => {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    };

    const onVisibility = () => (document.hidden ? stop() : start());

    start();
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [isToday, router]);

  /**
   * Keeps the tablet awake for the length of the service.
   *
   * Without it somebody re-unlocks a screen every ninety seconds all evening.
   * Best-effort: unsupported browsers and denied permissions are not worth an
   * error on a screen whose job is elsewhere.
   */
  useEffect(() => {
    let lock: { release: () => Promise<void> } | null = null;
    let cancelled = false;

    const request = async () => {
      try {
        const wakeLock = (navigator as Navigator & { wakeLock?: { request: (t: "screen") => Promise<typeof lock> } })
          .wakeLock;
        if (!wakeLock) return;
        const held = await wakeLock.request("screen");
        if (cancelled) {
          void held?.release();
          return;
        }
        lock = held;
      } catch {
        // Denied or unsupported. The board still works.
      }
    };

    void request();
    // A wake lock is dropped when the tab is hidden; take it again on return.
    const onVisibility = () => {
      if (!document.hidden) void request();
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisibility);
      void lock?.release();
    };
  }, []);

  const mark = useCallback(
    (table: BoardTable, body: Record<string, unknown>, optimistic: (current: BoardTable) => BoardTable) => {
      if (!canRecord) {
        return;
      }

      // Paint first. The floor does not wait for a round trip.
      const before = tables.find((entry) => entry.key === table.key);
      setTables((current) => current.map((entry) => (entry.key === table.key ? optimistic(entry) : entry)));
      setRows((current) => ({
        ...current,
        [table.key]: { pending: (current[table.key]?.pending ?? 0) + 1, error: null },
      }));
      inFlight.current.add(table.key);

      saverFor(table.key).save(async (isLatest) => {
        try {
          /**
           * A shared table is several bookings. One tap writes to all of them,
           * in sequence rather than in parallel: they are separate rows in the
           * store, and a partial failure must be visible rather than hidden by
           * a race.
           */
          for (const reservationNumber of table.reservationNumbers) {
            const response = await fetch(`/api/admin/reservations/${reservationNumber}/service`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(body),
            });

            if (!response.ok) {
              const data = await response.json().catch(() => ({}));
              throw new Error(data.error ?? "Could not record that.");
            }
          }

          if (isLatest()) {
            setRows((current) => ({ ...current, [table.key]: { pending: 0, error: null } }));
            inFlight.current.delete(table.key);
            router.refresh();
          }
        } catch (error) {
          if (!isLatest()) {
            return;
          }

          // Roll this row back, and say so on the row. The other twenty stand.
          if (before) {
            setTables((current) => current.map((entry) => (entry.key === table.key ? before : entry)));
          }
          setRows((current) => ({
            ...current,
            [table.key]: { pending: 0, error: error instanceof Error ? error.message : "Could not record that." },
          }));
          inFlight.current.delete(table.key);
        }
      });
    },
    [canRecord, router, tables],
  );

  const seat = (table: BoardTable) =>
    mark(table, { attendance: "seated" }, (current) => ({ ...current, attendance: "seated", attendanceMixed: false }));

  const noShow = (table: BoardTable) =>
    mark(table, { attendance: "no-show" }, (current) => ({ ...current, attendance: "no-show", attendanceMixed: false }));

  const clearAttendance = (table: BoardTable) =>
    mark(table, { attendance: null }, (current) => ({ ...current, attendance: null, attendanceMixed: false }));

  const toggleCourse = (table: BoardTable, courseId: string, served: boolean) =>
    mark(table, { courseId, served }, (current) => ({
      ...current,
      courses: current.courses.map((course) =>
        course.courseId === courseId
          ? { ...course, servedAt: served ? new Date().toISOString() : undefined }
          : course,
      ),
    }));

  /**
   * Marks every table nobody has touched as a no-show, in one pass.
   *
   * This is what makes the data actually get recorded. Nobody taps "no-show" at
   * 19:20 — they notice at 21:00 that four tables never came. Confirmed first,
   * and naming the tables, because it writes a permanent record.
   */
  const closeEvening = async () => {
    const waiting = tables.filter((table) => table.attendance === null);
    if (waiting.length === 0 || closing) {
      return;
    }

    const names = waiting.map((table) => table.table || table.rooms.join(" + ")).join(", ");
    if (!window.confirm(`Mark ${waiting.length} table(s) as no-shows? ${names}\n\nThis is recorded and can be undone per table.`)) {
      return;
    }

    setClosing(true);
    setNotice("");

    try {
      for (const table of waiting) {
        for (const reservationNumber of table.reservationNumbers) {
          await fetch(`/api/admin/reservations/${reservationNumber}/service`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ attendance: "no-show" }),
          });
        }
      }
      setNotice(`${waiting.length} table(s) marked as no-shows.`);
      router.refresh();
    } finally {
      setClosing(false);
    }
  };

  const summary = useMemo(() => boardSummary(tables), [tables]);
  const outstanding = useMemo(() => outstandingPlates(tables), [tables]);

  return (
    <div className="space-y-4">
      <Card className="p-5">
        <CardHeader
          as="h1"
          eyebrow={isToday ? "Tonight" : "Service board"}
          title={formatLongDate(date)}
          description={`${summary.seated} of ${summary.tables} tables seated · ${summary.guestsSeated} of ${summary.guestsExpected} guests · ${summary.finished} finished`}
          actions={
            <div className="flex flex-wrap items-center gap-2">
              <ButtonLink href="/admin">Dashboard</ButtonLink>
              {canRecord && summary.waiting > 0 ? (
                <Button variant="secondary" onClick={closeEvening} loading={closing} loadingLabel="Marking…">
                  Close the evening
                </Button>
              ) : null}
            </div>
          }
        />

        {/* What is still to go out. The number the pass actually asks for. */}
        {outstanding.length > 0 ? (
          <div className="mt-4 flex flex-wrap gap-2">
            {outstanding.map((course) => (
              <span
                key={course.courseId}
                className="inline-flex items-baseline gap-2 rounded-control border border-gold/40 bg-accent-soft px-3 py-2"
              >
                <span className="text-xl font-semibold tabular-nums text-accent-ink">{course.plates}</span>
                <span className="text-sm text-ink-muted">{course.courseName} to go</span>
              </span>
            ))}
          </div>
        ) : summary.seated > 0 ? (
          <p className="mt-4 rounded-control border border-success/30 bg-success-soft p-3 text-sm font-medium text-success">
            ✓ Everything seated has been served.
          </p>
        ) : null}

        {notice ? (
          <Alert tone="success" className="mt-4">
            {notice}
          </Alert>
        ) : null}
        {!canRecord ? (
          <Alert tone="info" className="mt-4">
            You can see the board but not mark it. Ask an administrator for the “Run the service board”
            permission.
          </Alert>
        ) : null}
      </Card>

      {tables.length === 0 ? (
        <Card className="p-6">
          <EmptyState
            title="No tables this evening"
            description="Nothing is booked for this date, or every booking has been cancelled."
            action={<ButtonLink href="/admin">Back to the calendar</ButtonLink>}
          />
        </Card>
      ) : (
        <div className="space-y-3">
          {tables.map((table) => {
            const row = rows[table.key];
            const seated = table.attendance === "seated";

            return (
              <Card
                key={table.key}
                as="section"
                className={cx(
                  "p-4 transition-colors",
                  table.attendance === "no-show" && "opacity-60",
                  seated && "border-gold/40",
                )}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-baseline gap-2">
                      <span className="text-xl font-semibold text-ink">
                        {table.table ? `Table ${table.table}` : "No table yet"}
                      </span>
                      <span className="text-sm text-ink-muted">
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
                      <p className="mt-0.5 text-xs text-ink-subtle">
                        The rooms on this table are marked differently.
                      </p>
                    ) : null}
                  </div>

                  {/* The gate. Big, because it is pressed while walking. */}
                  {canRecord ? (
                    <div className="flex shrink-0 flex-wrap items-center gap-2">
                      {table.attendance === null ? (
                        <>
                          <button
                            type="button"
                            onClick={() => seat(table)}
                            className="min-h-14 rounded-control bg-primary px-6 text-base font-semibold text-primary-fg transition-colors hover:bg-primary-hover"
                          >
                            Seated
                          </button>
                          <button
                            type="button"
                            onClick={() => noShow(table)}
                            className="min-h-14 rounded-control border border-line-strong px-4 text-sm font-medium text-ink-muted hover:border-danger hover:text-danger"
                          >
                            No-show
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          onClick={() => clearAttendance(table)}
                          className={cx(
                            "min-h-14 rounded-control border px-5 text-sm font-semibold transition-colors",
                            seated
                              ? "border-gold bg-accent-soft text-accent-ink"
                              : "border-line-strong text-ink-muted",
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
                  Courses appear only once the table is seated: a table that has
                  not sat down cannot have been served, and offering the cells
                  first invites exactly that error.
                */}
                {seated ? (
                  <div className="mt-3 flex flex-wrap gap-2 border-t border-line pt-3">
                    {table.courses.map((course) => {
                      const served = Boolean(course.servedAt);

                      return (
                        <button
                          key={course.courseId}
                          type="button"
                          disabled={!canRecord}
                          onClick={() => toggleCourse(table, course.courseId, !served)}
                          aria-pressed={served}
                          className={cx(
                            "min-h-14 min-w-28 rounded-control border px-4 text-left transition-colors",
                            served
                              ? "border-success/40 bg-success-soft"
                              : "border-line-strong bg-surface hover:border-accent",
                            !canRecord && "cursor-default",
                          )}
                        >
                          <span className={cx("block text-sm font-semibold", served ? "text-success" : "text-ink")}>
                            {served ? "✓ " : ""}
                            {course.courseName}
                          </span>
                          <span className="block text-xs text-ink-muted">
                            {served
                              ? new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false }).format(
                                  new Date(course.servedAt!),
                                )
                              : `${course.plates} ${course.plates === 1 ? "plate" : "plates"}`}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                ) : null}

                {/* The failure belongs to its row, never to the page. */}
                {row?.error ? (
                  <p className="mt-3 text-sm font-medium text-danger" role="alert">
                    {row.error} — tap again to retry.
                  </p>
                ) : null}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
