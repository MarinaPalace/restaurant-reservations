"use client";

import { useState } from "react";
import { cx } from "@/components/ui/utils";
import { PlanView, refusalOf, refusalSentence } from "@/app/booking/table/plan-view";
import { inspectRun, type TableOffer, type ZoneOffer } from "@/lib/floor-plan-availability";

/**
 * Choosing a table: the zones, the plan, and the same tables as a list.
 *
 * ## Why it is a component and not a step
 *
 * It was the booking flow's fourth screen and nothing else. Then guests needed
 * to change a table on a booking they had already made, which is the same
 * question — *which of tonight's free tables do you want?* — asked from a
 * different place. Two copies of that would drift: one would learn that a
 * taken table should say why, and the other would not.
 *
 * So the choosing lives here and the screens keep their own answers to what
 * happens next. `/booking/table` walks on to the menu; the manage screen saves
 * the change against a booking that already exists.
 *
 * ## Two ways through, always
 *
 * The plan is a picture and the list is text, and both select the same table.
 * The list is the path for a guest on a small screen, for a keyboard, and for
 * anybody who does not want to study a floor plan — and it is the reason a
 * failure in the drawing can no longer take the whole step down with it
 * (`docs/floor-plan.md` §18).
 */
export function TableChooser({
  zones,
  guestCount,
  chosen,
  onChoose,
  locked = false,
}: {
  zones: ZoneOffer[];
  guestCount: number;
  /**
   * What is chosen: a plan table id, or a combination id — `t7+t8` — when
   * tables are pushed together for a party no single table can take.
   */
  chosen: string | null;
  onChoose: (id: string | null) => void;
  /**
   * The table is already decided — the guest is joining a party that has one —
   * so the room is shown and nothing in it can be picked. Drawn rather than
   * hidden, because "you are at table 11" is worth being able to see on the
   * plan.
   */
  locked?: boolean;
}) {
  const [zoneId, setZoneId] = useState<string | null>(null);
  const [refused, setRefused] = useState("");

  const zone = zones.find((entry) => entry.id === zoneId) ?? zones[0] ?? null;

  const choose = (id: string) => {
    // Nothing to choose when the table came with the party being joined.
    if (locked) {
      setRefused("You are being seated with the booking you named, so the table is already decided.");
      return;
    }

    // Tapping what is already chosen lets it go, which is how a guest changes
    // their mind back to "you seat us" without hunting for another control.
    onChoose(chosen === id ? null : id);
    setRefused("");
  };

  if (!zone) {
    return null;
  }

  return (
    <>
      {zones.length > 1 ? (
        <div className="mt-5 flex flex-wrap justify-center gap-1.5">
          {zones.map((entry) => (
            <button
              key={entry.id}
              type="button"
              aria-pressed={entry.id === zone.id}
              onClick={() => {
                setZoneId(entry.id);
                setRefused("");
              }}
              className={cx(
                "min-h-10 rounded-control border px-3 text-sm font-medium transition-colors",
                entry.id === zone.id
                  ? "border-accent bg-accent-soft text-accent-ink"
                  : "border-line-strong bg-surface text-ink-muted hover:border-accent",
              )}
            >
              {entry.name}
            </button>
          ))}
        </div>
      ) : null}

      <PlanView
        zone={zone}
        guestCount={guestCount}
        chosen={chosen}
        onChoose={choose}
        onRefuse={(table) => setRefused(refusalSentence(table))}
      />

      <div className="mt-3 flex flex-wrap items-center justify-center gap-x-4 gap-y-1.5 text-xs text-ink-muted">
        <Key className="border-line-strong bg-surface" label="Free" />
        <Key className="border-accent bg-primary" label="Yours" />
        <Key className="border-line bg-surface-sunken" label="Not free for your party" />
      </div>

      {refused ? (
        <p className="mt-3 text-center text-sm text-ink-muted" role="status">
          {refused}
        </p>
      ) : null}

      <TableList zone={zone} chosen={chosen} onChoose={choose} />
    </>
  );
}

/**
 * The same tables, as a list.
 *
 * Free ones first and smallest first: the guest who does not care which table
 * wants the one that fits, and giving a party of two the four-top at the top of
 * the list costs the restaurant a table it could have sold twice.
 *
 * Unavailable tables are listed too, greyed and with their reason spelled out,
 * for the same reason the plan keeps drawing them: a room that hides what is
 * taken looks like a room with fewer tables than it has.
 */
function TableList({
  zone,
  chosen,
  onChoose,
}: {
  zone: ZoneOffer;
  chosen: string | null;
  onChoose: (id: string) => void;
}) {
  const ordered = [...zone.tables].sort((a, b) => {
    const free = Number(Boolean(a.unavailable)) - Number(Boolean(b.unavailable));
    if (free !== 0) return free;
    if (a.seats !== b.seats) return a.seats - b.seats;

    return a.label.localeCompare(b.label, undefined, { numeric: true });
  });

  return (
    <div className="mt-5">
      {/*
        Tables pushed together come first, and only appear when no single table
        would have done — so on the evening a guest sees them, they are the
        answer rather than something to weigh against an ordinary table.

        Several are offered when the room allows it: the same number of tables
        in different parts of the hall, which is a real choice. How many tables
        is not offered, because that is the restaurant's arithmetic.
      */}
      {zone.combinations.length > 0 ? (
        <div className="mb-4">
          <h2 className="text-sm font-medium text-ink-muted">
            {zone.combinations.length > 1
              ? "Choose tables to be pushed together"
              : "Tables pushed together for your party"}
          </h2>
          <p className="mt-0.5 text-xs text-ink-subtle">
            No single table in {zone.name} seats your party, so these are joined for you.
            {zone.combinations.length > 1 ? " Pick whichever part of the room you would rather sit in." : ""}{" "}
            The seats shown are what they seat pushed together, which is fewer than their totals
            added up.
          </p>
          <ul className="mt-2 grid gap-2 sm:grid-cols-2">
            {zone.combinations.map((combination) => (
              <li key={combination.id}>
                <button
                  type="button"
                  aria-pressed={chosen === combination.id}
                  onClick={() => onChoose(combination.id)}
                  className={cx(
                    "flex min-h-12 w-full items-center justify-between gap-3 rounded-control border px-3 py-2 text-left text-sm transition-colors",
                    chosen === combination.id
                      ? "border-accent bg-accent-soft text-accent-ink"
                      : "border-line-strong bg-surface text-ink hover:border-accent",
                  )}
                >
                  <span className="font-medium">Tables {combination.labels.join(" + ")}</span>
                  <span
                    className={cx("text-xs", chosen === combination.id ? "text-accent-ink" : "text-ink-muted")}
                  >
                    Seats {combination.seats}
                    {chosen === combination.id ? " · chosen" : ""}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <h2 className="text-sm font-medium text-ink-muted">Every table in {zone.name}</h2>
      <ul className="mt-2 grid gap-2 sm:grid-cols-2">
        {ordered.map((table) => (
          <li key={table.id}>
            <TableRow table={table} chosen={chosen === table.id} onChoose={() => onChoose(table.id)} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function TableRow({
  table,
  chosen,
  onChoose,
}: {
  table: TableOffer;
  chosen: boolean;
  onChoose: () => void;
}) {
  const free = !table.unavailable;

  return (
    <button
      type="button"
      disabled={!free}
      aria-pressed={free ? chosen : undefined}
      onClick={onChoose}
      className={cx(
        "flex min-h-12 w-full items-center justify-between gap-3 rounded-control border px-3 py-2 text-left text-sm transition-colors",
        chosen
          ? "border-accent bg-accent-soft text-accent-ink"
          : free
            ? "border-line-strong bg-surface text-ink hover:border-accent"
            : "border-line bg-surface-sunken text-ink-subtle",
      )}
    >
      <span className="font-medium">Table {table.label}</span>
      <span className={cx("text-xs", chosen ? "text-accent-ink" : "text-ink-muted")}>
        {free ? `Seats ${table.seats}${chosen ? " · chosen" : ""}` : refusalOf(table)}
      </span>
    </button>
  );
}

function Key({ className, label }: { className: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={cx("inline-block size-3 rounded-sm border", className)} aria-hidden="true" />
      {label}
    </span>
  );
}

/**
 * What a choice is called and how many it seats, for the line that confirms it.
 *
 * Answers for a combination as well as a table, because from the summary bar's
 * point of view they are the same thing: somewhere to sit, with a name and a
 * size.
 */
export function findOffer(
  zones: ZoneOffer[],
  id: string | null,
): { label: string; seats: number; tables: number } | null {
  if (!id) return null;

  const table = zones.flatMap((zone) => zone.tables).find((entry) => entry.id === id);

  if (table) {
    return { label: table.label, seats: table.seats, tables: 1 };
  }

  const combination = zones.flatMap((zone) => zone.combinations).find((entry) => entry.id === id);

  if (combination) {
    return {
      label: combination.labels.join(" + "),
      seats: combination.seats,
      tables: combination.tableIds.length,
    };
  }

  /**
   * A row the guest built themselves, which is in no list of prepared offers.
   *
   * Worked out from the tables instead. Without this the summary line said
   * "no table chosen" to a guest looking at three tables lit up on the plan —
   * and the continue button, which asks the same question, would have let them
   * walk on believing they had chosen nothing.
   */
  const ids = id.split("+").filter(Boolean);

  if (ids.length < 2) {
    return null;
  }

  const offers = zones.flatMap((zone) => zone.tables);
  const run = ids
    .map((entry) => offers.find((candidate) => candidate.id === entry))
    .filter((entry): entry is TableOffer => Boolean(entry));

  if (run.length !== ids.length) {
    return null;
  }

  const inspected = inspectRun(run);

  if (!inspected.ok) {
    return null;
  }

  return {
    label: run.map((entry) => entry.label).join(" + "),
    seats: inspected.seats,
    tables: run.length,
  };
}
