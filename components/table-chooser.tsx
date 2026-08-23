"use client";

import { useState } from "react";
import { cx } from "@/components/ui/utils";
import { PlanView, refusalOf, refusalSentence } from "@/app/booking/table/plan-view";
import type { TableOffer, ZoneOffer } from "@/lib/floor-plan-availability";

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
}: {
  zones: ZoneOffer[];
  guestCount: number;
  /** The plan table id currently chosen, or nothing. */
  chosen: string | null;
  onChoose: (tableId: string | null) => void;
}) {
  const [zoneId, setZoneId] = useState<string | null>(null);
  const [refused, setRefused] = useState("");

  const zone = zones.find((entry) => entry.id === zoneId) ?? zones[0] ?? null;

  const choose = (tableId: string) => {
    // Tapping the chosen table again lets it go, which is how a guest changes
    // their mind back to "you seat us" without hunting for another control.
    onChoose(chosen === tableId ? null : tableId);
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
        <Key className="border-line bg-surface-sunken" label="Taken or too small" />
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
  onChoose: (tableId: string) => void;
}) {
  const ordered = [...zone.tables].sort((a, b) => {
    const free = Number(Boolean(a.unavailable)) - Number(Boolean(b.unavailable));
    if (free !== 0) return free;
    if (a.seats !== b.seats) return a.seats - b.seats;

    return a.label.localeCompare(b.label, undefined, { numeric: true });
  });

  return (
    <div className="mt-5">
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

/** Every table on offer, across every zone. What a summary line names. */
export function findOffer(zones: ZoneOffer[], tableId: string | null): TableOffer | null {
  if (!tableId) return null;

  return zones.flatMap((zone) => zone.tables).find((table) => table.id === tableId) ?? null;
}
