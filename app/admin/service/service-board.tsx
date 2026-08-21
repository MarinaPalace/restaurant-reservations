"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardHeader } from "@/components/ui/card";
import { Button, ButtonLink } from "@/components/ui/button";
import { Alert, EmptyState } from "@/components/ui/feedback";
import { cx } from "@/components/ui/utils";
import { createSequentialSaver } from "@/lib/sequential-save";
import { boardSummary, outstandingPlates, type BoardPlate, type BoardTable } from "@/lib/service-board";
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

// A course going out is not a fact anybody needs within five seconds — the
// person who marked it already sees it optimistically. Each poll re-runs the
// server component, so this interval is a direct multiplier on the board's DB
// load; 20s cuts it fourfold with no change to what the board can do.
// See docs/performance.md §3.2.
const POLL_MS = 20000;

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
  /**
   * Which tables are showing their plates.
   *
   * Collapsed by default: the board is read at a glance across a whole room,
   * and every table expanded is a screen nobody can scan. Expanding is how you
   * answer "what is guest 2 eating", which is the question an allergy note
   * makes you ask about one table, not all of them.
   */
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  /**
   * Hides tables that are done — served, or not coming.
   *
   * The most valuable thing on a phone is fewer rows. By the middle of service
   * half the room is finished and none of it needs touching again, so scrolling
   * past it to reach the two tables that do is the actual cost of the small
   * screen. Off by default: the board's first job is to show the whole evening.
   */
  const [hideDone, setHideDone] = useState(false);
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
    (
      table: BoardTable,
      body: Record<string, unknown>,
      optimistic: (current: BoardTable) => BoardTable,
      /** The row the result belongs to; a plate mark targets one booking. */
      rowKey: string = table.key,
    ) => {
      if (!canRecord) {
        return;
      }

      // Paint first. The floor does not wait for a round trip.
      const before = tables.find((entry) => entry.key === rowKey);
      setTables((current) => current.map((entry) => (entry.key === rowKey ? optimistic(entry) : entry)));
      setRows((current) => ({
        ...current,
        [rowKey]: { pending: (current[rowKey]?.pending ?? 0) + 1, error: null },
      }));
      inFlight.current.add(rowKey);

      saverFor(rowKey).save(async (isLatest) => {
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
            setRows((current) => ({ ...current, [rowKey]: { pending: 0, error: null } }));
            inFlight.current.delete(rowKey);
            router.refresh();
          }
        } catch (error) {
          if (!isLatest()) {
            return;
          }

          // Roll this row back, and say so on the row. The other twenty stand.
          if (before) {
            setTables((current) => current.map((entry) => (entry.key === rowKey ? before : entry)));
          }
          setRows((current) => ({
            ...current,
            [rowKey]: { pending: 0, error: error instanceof Error ? error.message : "Could not record that." },
          }));
          inFlight.current.delete(rowKey);
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
          ? {
              ...course,
              plates: course.plates.map((plate) => ({
                ...plate,
                servedAt: served ? new Date().toISOString() : undefined,
              })),
              served: served ? course.plates.length : 0,
              outstanding: served ? 0 : course.plates.length,
              servedAt: served ? new Date().toISOString() : undefined,
            }
          : course,
      ),
    }));

  /**
   * One guest's plate.
   *
   * Written against that guest's own booking, not the table's — a shared table
   * has several bookings and each has its own guest 0, so the reservation
   * number is what disambiguates them.
   */
  const togglePlate = (table: BoardTable, courseId: string, plate: BoardPlate, served: boolean) =>
    mark(
      { ...table, reservationNumbers: [plate.reservationNumber] },
      { courseId, guestIndex: plate.guestIndex, served },
      (current) => ({
        ...current,
        courses: current.courses.map((course) => {
          if (course.courseId !== courseId) {
            return course;
          }

          const plates = course.plates.map((entry) =>
            entry.reservationNumber === plate.reservationNumber && entry.guestIndex === plate.guestIndex
              ? { ...entry, servedAt: served ? new Date().toISOString() : undefined }
              : entry,
          );
          const servedCount = plates.filter((entry) => entry.servedAt).length;

          return {
            ...course,
            plates,
            served: servedCount,
            outstanding: plates.length - servedCount,
            servedAt: servedCount === plates.length ? new Date().toISOString() : undefined,
          };
        }),
      }),
      table.key,
    );

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

  /**
   * Filtering hides rows; it never reorders them (rule 2.14). A row that moves
   * because a neighbour was finished is a row somebody mis-taps.
   */
  const visible = useMemo(
    () =>
      hideDone
        ? tables.filter(
            (table) =>
              table.attendance !== "no-show" &&
              !(table.attendance === "seated" && table.courses.every((course) => course.outstanding === 0)),
          )
        : tables,
    [hideDone, tables],
  );

  return (
    <div className="space-y-4">
      <Card className="p-3 sm:p-5">
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

        {/*
          What is still to go out. The number the pass actually asks for.

          One scrolling line on a phone rather than a wrapped block: six courses
          wrapping to four rows push the tables off the screen entirely, and the
          strip is glanced at, not read.
        */}
        {outstanding.length > 0 ? (
          <div className="-mx-3 mt-3 flex gap-2 overflow-x-auto px-3 pb-1 sm:mx-0 sm:mt-4 sm:flex-wrap sm:px-0">
            {outstanding.map((course) => (
              <span
                key={course.courseId}
                className="inline-flex shrink-0 items-baseline gap-1.5 rounded-control border border-gold/40 bg-accent-soft px-2.5 py-1.5 sm:gap-2 sm:px-3 sm:py-2"
              >
                <span className="text-lg font-semibold tabular-nums text-accent-ink sm:text-xl">
                  {course.plates}
                </span>
                <span className="whitespace-nowrap text-xs text-ink-muted sm:text-sm">
                  {course.courseName}
                </span>
              </span>
            ))}
          </div>
        ) : summary.seated > 0 ? (
          <p className="mt-4 rounded-control border border-success/30 bg-success-soft p-3 text-sm font-medium text-success">
            ✓ Everything seated has been served.
          </p>
        ) : null}

        {summary.tables > 0 ? (
          <label className="mt-3 flex min-h-11 items-center gap-2 text-sm font-medium text-ink">
            <input
              type="checkbox"
              className="size-5 accent-[var(--primary)]"
              checked={hideDone}
              onChange={(event) => setHideDone(event.target.checked)}
            />
            Hide finished and no-shows
            {hideDone ? (
              <span className="text-ink-subtle">
                ({summary.tables - visible.length} hidden)
              </span>
            ) : null}
          </label>
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
        <div className="space-y-2 sm:space-y-3">
          {visible.map((table) => {
            const row = rows[table.key];
            const seated = table.attendance === "seated";

            return (
              <Card
                key={table.key}
                as="section"
                className={cx(
                  "p-3 transition-colors sm:p-4",
                  table.attendance === "no-show" && "opacity-60",
                  seated && "border-gold/40",
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
                            className="min-h-12 rounded-control bg-primary px-5 text-base font-semibold text-primary-fg transition-colors hover:bg-primary-hover sm:min-h-14 sm:px-6"
                          >
                            Seated
                          </button>
                          <button
                            type="button"
                            onClick={() => noShow(table)}
                            className="min-h-12 rounded-control border border-line-strong px-3 text-sm font-medium text-ink-muted hover:border-danger hover:text-danger sm:min-h-14 sm:px-4"
                          >
                            No-show
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          onClick={() => clearAttendance(table)}
                          className={cx(
                            "min-h-12 rounded-control border px-4 text-sm font-semibold transition-colors sm:min-h-14 sm:px-5",
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
                  <div className="mt-3 border-t border-line pt-3">
                    {/*
                      A grid on a phone, where a 160px-wide cell means one per
                      row and six courses fill the screen; flowing chips from
                      `sm` up, where there is room for their natural width.
                    */}
                    <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center">
                      {table.courses.map((course) => {
                        const done = course.outstanding === 0;

                        return (
                          <button
                            key={course.courseId}
                            type="button"
                            disabled={!canRecord}
                            onClick={() => toggleCourse(table, course.courseId, !done)}
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
                            <span
                              className={cx(
                                "block truncate text-sm font-semibold",
                                done ? "text-success" : "text-ink",
                              )}
                            >
                              {done ? "✓ " : ""}
                              {course.courseName}
                              {!done && course.served > 0 ? (
                                <span className="ml-1 font-normal text-ink-muted">
                                  {course.served}/{course.plates.length}
                                </span>
                              ) : null}
                            </span>

                            {/*
                              Which dishes, not just how many. "2 Amuse Bouche"
                              does not tell a waiter what to carry; "2 x Salmon,
                              1 x Veloute" does.
                            */}
                            <span className="mt-0.5 block truncate text-xs text-ink-muted">
                              {done && course.servedAt
                                ? new Intl.DateTimeFormat("en-GB", {
                                    hour: "2-digit",
                                    minute: "2-digit",
                                    hour12: false,
                                  }).format(new Date(course.servedAt))
                                : course.summary
                                    .map((entry) => `${entry.count} × ${entry.optionName}`)
                                    .join(" · ")}
                            </span>
                          </button>
                        );
                      })}
                    </div>

                    {/*
                      Per guest, on demand. An allergy note says "guest 2 is
                      allergic to gluten", so the board has to be able to say
                      what guest 2 is actually eating — and to send that one
                      plate out separately from the rest of the course.
                    */}
                    <button
                      type="button"
                      onClick={() =>
                        setExpanded((current) => ({ ...current, [table.key]: !current[table.key] }))
                      }
                      className="mt-2 min-h-11 text-sm font-medium text-accent-ink underline underline-offset-4"
                      aria-expanded={Boolean(expanded[table.key])}
                    >
                      {expanded[table.key] ? "Hide each guest" : "Show what each guest chose"}
                    </button>

                    {expanded[table.key] ? (
                      <div className="mt-2 space-y-3">
                        {table.courses.map((course) => (
                          <div key={course.courseId}>
                            <p className="text-xs font-semibold uppercase tracking-wide text-ink-subtle">
                              {course.courseName}
                            </p>
                            <div className="mt-1 grid grid-cols-2 gap-1.5 lg:grid-cols-3">
                              {course.plates.map((plate) => {
                                const out = Boolean(plate.servedAt);

                                return (
                                  <button
                                    key={`${plate.reservationNumber}-${plate.guestIndex}`}
                                    type="button"
                                    disabled={!canRecord}
                                    aria-pressed={out}
                                    onClick={() => togglePlate(table, course.courseId, plate, !out)}
                                    className={cx(
                                      "flex min-h-12 items-center justify-between gap-3 rounded-control border px-3 py-2 text-left transition-colors",
                                      out
                                        ? "border-success/40 bg-success-soft"
                                        : "border-line bg-surface hover:border-accent",
                                      !canRecord && "cursor-default",
                                    )}
                                  >
                                    <span className="min-w-0">
                                      <span className="block text-xs text-ink-subtle">{plate.label}</span>
                                      <span
                                        className={cx(
                                          "block truncate text-sm font-medium",
                                          out ? "text-success" : "text-ink",
                                        )}
                                      >
                                        {out ? "✓ " : ""}
                                        {plate.optionName}
                                      </span>
                                    </span>
                                    {out && plate.servedAt ? (
                                      <span className="shrink-0 text-xs tabular-nums text-ink-muted">
                                        {new Intl.DateTimeFormat("en-GB", {
                                          hour: "2-digit",
                                          minute: "2-digit",
                                          hour12: false,
                                        }).format(new Date(plate.servedAt))}
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
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
