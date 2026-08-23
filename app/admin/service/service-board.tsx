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
import type { FloorPlan } from "@/lib/floor-plan";
import { TableRow, isFinished, type BoardActions, type RowState } from "@/app/admin/service/board-row";
import { BoardGrid } from "@/app/admin/service/board-grid";
import { BoardRoom } from "@/app/admin/service/board-room";

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

/**
 * Which of the three ways of looking at the evening is on screen.
 *
 * They are the same data and the same taps — see `board-row.tsx` — and they
 * differ only in what they make easy to see:
 *
 * - `room` draws the plan, so a table is found by *where it is* rather than by
 *   translating a number into a place. It is also the only one that can show
 *   which part of the room is behind.
 * - `list` is one table at a time, in depth: notes, extras, every plate. Best
 *   on a phone and best when walking to a table.
 * - `sheet` is the grid the paper always was — tables down, courses across —
 *   which is the shape somebody moving off paper already knows how to read, and
 *   the one that answers "what is the whole room waiting on" in a glance.
 *
 * Kept on the device rather than in the address. Whoever is at the pass has one
 * way of working and wants it back after the tablet locks; nobody wants to send
 * somebody else a link to *their* preferred view of tonight.
 */
const VIEWS = ["room", "list", "sheet"] as const;
type BoardView = (typeof VIEWS)[number];

const VIEW_LABELS: Record<BoardView, string> = {
  room: "Restaurant",
  list: "List",
  sheet: "Sheet",
};

const VIEW_STORAGE_KEY = "service-board-view";

export function ServiceBoard({
  initialTables,
  plan,
  date,
  isToday,
  canRecord,
}: {
  initialTables: BoardTable[];
  /** The room as staff drew it. Empty until somebody has — the room view says so. */
  plan: FloorPlan;
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

  /**
   * Starts on the list, then takes the device's remembered choice.
   *
   * Read after mount rather than during render: the server has no localStorage,
   * and reading it while rendering is the hydration mismatch this codebase has
   * already been bitten by on the confirmation screen. One frame of the list is
   * cheaper than a board that renders twice.
   */
  const [view, setView] = useState<BoardView>("list");

  useEffect(() => {
    const saved = window.localStorage.getItem(VIEW_STORAGE_KEY);
    if (saved && (VIEWS as readonly string[]).includes(saved)) {
      setView(saved as BoardView);
    }
  }, []);

  const chooseView = (next: BoardView) => {
    setView(next);
    try {
      window.localStorage.setItem(VIEW_STORAGE_KEY, next);
    } catch {
      // A tablet with storage disabled still gets the view, just not next time.
    }
  };

  /** Which table the room view is showing in full, beneath the plan. */
  const [openKey, setOpenKey] = useState<string | null>(null);

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

  /**
   * Every tap the board offers, in one object.
   *
   * Handed to whichever view is on screen rather than reimplemented in each.
   * The optimistic paint, the sequential save and the per-row rollback all live
   * here, so a view is only ever a way of *arranging* the same actions — which
   * is what stops three layouts becoming three subtly different boards.
   */
  /**
   * The staff-only note on one booking of a table.
   *
   * Written against that one booking rather than the table, because that is
   * where it lives — but the row it reports against is the table's, so a failed
   * save appears on the row somebody was typing in.
   */
  const setStaffNote = (table: BoardTable, reservationNumber: string, note: string) =>
    mark(
      { ...table, reservationNumbers: [reservationNumber] },
      { staffNote: note },
      (current) => ({
        ...current,
        bookings: current.bookings.map((booking) =>
          booking.reservationNumber === reservationNumber ? { ...booking, staffNote: note || undefined } : booking,
        ),
      }),
      table.key,
    );

  const actions: BoardActions = { seat, noShow, clearAttendance, toggleCourse, togglePlate, setStaffNote };

  const summary = useMemo(() => boardSummary(tables), [tables]);
  const outstanding = useMemo(() => outstandingPlates(tables), [tables]);

  /**
   * Filtering hides rows; it never reorders them (rule 2.14). A row that moves
   * because a neighbour was finished is a row somebody mis-taps.
   */
  const visible = useMemo(
    () => (hideDone ? tables.filter((table) => table.attendance !== "no-show" && !isFinished(table)) : tables),
    [hideDone, tables],
  );

  /**
   * Looked up on every render rather than held in state, so the open table is
   * the *current* one after a poll rather than a copy taken when it was tapped.
   */
  const openTable = openKey ? (tables.find((table) => table.key === openKey) ?? null) : null;

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
              {/*
                Three ways of looking at one evening. Large targets and always
                in the same place, because it is pressed with a thumb while
                holding something in the other hand.
              */}
              <div className="inline-flex rounded-control border border-line-strong p-0.5" role="group" aria-label="View">
                {VIEWS.map((option) => (
                  <button
                    key={option}
                    type="button"
                    aria-pressed={view === option}
                    onClick={() => chooseView(option)}
                    className={cx(
                      "min-h-10 rounded-[calc(var(--radius-control)-2px)] px-3 text-sm font-semibold transition-colors",
                      view === option ? "bg-accent-soft text-accent-ink" : "text-ink-muted hover:text-ink",
                    )}
                  >
                    {VIEW_LABELS[option]}
                  </button>
                ))}
              </div>
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

        {/*
            Fewer rows is the most valuable thing on a phone, but only where
            there are rows: the plan draws the whole room by definition, so the
            control is not offered there rather than being offered and ignored.
          */}
        {summary.tables > 0 && view !== "room" ? (
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
      ) : view === "list" ? (
        <div className="space-y-2 sm:space-y-3">
          {visible.map((table) => (
            <TableRow
              key={table.key}
              table={table}
              row={rows[table.key]}
              canRecord={canRecord}
              expanded={Boolean(expanded[table.key])}
              onExpand={() => setExpanded((current) => ({ ...current, [table.key]: !current[table.key] }))}
              actions={actions}
            />
          ))}
        </div>
      ) : view === "sheet" ? (
        <BoardGrid
          tables={visible}
          rows={rows}
          canRecord={canRecord}
          actions={actions}
          onOpen={(table) => {
            // The sheet has no room for per-guest plates, so opening a table
            // hands it to the view that does rather than growing a second
            // implementation of the same thing.
            setExpanded((current) => ({ ...current, [table.key]: true }));
            chooseView("list");
          }}
        />
      ) : (
        <div className="space-y-3">
          {/*
            Every table, never the filtered list. Hiding a finished table on a
            plan does not save a scroll — it draws it exactly like a free one,
            which is a worse lie than the row it saved.
          */}
          <BoardRoom plan={plan} tables={tables} selectedKey={openKey} onSelect={setOpenKey} />

          {/*
            The selected table's ordinary row, under the plan. The plan says
            where and how far along; this is where it is actually marked, and it
            is the same component the list uses so a tap cannot mean two things.
          */}
          {openTable ? (
            <Card as="section" className="border-accent p-3 sm:p-4">
              <TableRow
                bare
                table={openTable}
                row={rows[openTable.key]}
                canRecord={canRecord}
                expanded={Boolean(expanded[openTable.key])}
                onExpand={() =>
                  setExpanded((current) => ({ ...current, [openTable.key]: !current[openTable.key] }))
                }
                actions={actions}
              />
            </Card>
          ) : (
            <p className="rounded-control border border-dashed border-line-strong p-4 text-center text-sm text-ink-subtle">
              Tap a table to seat it or send a course.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
