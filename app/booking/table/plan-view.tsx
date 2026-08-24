"use client";

import { useState } from "react";
import { cx } from "@/components/ui/utils";
import { PlanViewport, usePlanDragged } from "@/components/plan-viewport";
import { FEATURE_LABELS, type FloorFeature } from "@/lib/floor-plan";
import { inspectRun, type TableOffer, type ZoneOffer } from "@/lib/floor-plan-availability";

/**
 * The room, drawn, with a way to move around it.
 *
 * ## Why this is its own file now
 *
 * The plan used to be a bare `<svg>` inside the picker, sized `w-full
 * min-w-[22rem]` in a wrapper with `overflow-x-auto`, and on a phone it was cut
 * off: measured at 390 px wide, the drawing came out 352 px inside a 324 px
 * card, and the table at the far wall was drawn outside it. The wrapper could
 * be scrolled in principle — but the SVG carries `touch-none`, so a finger on
 * the plan scrolled nothing, and a guest whose table was in the far half of the
 * room could not reach it at all.
 *
 * The fix is not a wider box. It is a view that fits the whole plan first and
 * then moves under a finger deliberately — `components/plan-viewport.tsx`,
 * which the service board draws through as well, because the same fault had
 * shipped there too. This file is only what the guest's room looks like.
 * `docs/floor-plan.md` §18 has the measurements.
 *
 * ## The plan is never the only way through
 *
 * Whatever happens here, `table-picker.tsx` lists the same tables in text
 * beside it. That list is the accessible path and the small-screen path, and it
 * is why this component can afford to be a picture.
 */
export function PlanView({
  zone,
  guestCount,
  chosen,
  onSelect,
  onRefuse,
}: {
  zone: ZoneOffer;
  guestCount: number;
  /** A table id, or a combination id — `t7+t8` — when tables are pushed together. */
  chosen: string | null;
  /** The whole selection after a tap — a row, a single table, or nothing. */
  onSelect: (next: string | null) => void;
  /** A guest tapped a table they cannot have. Says why, in words. */
  onRefuse: (table: TableOffer) => void;
}) {
  /**
   * The table to bring into the frame. Set when one is reached by tabbing, so
   * the keyboard never lands on something off screen.
   */
  const [reveal, setReveal] = useState<TableOffer | null>(null);

  /**
   * What tapping a table does when a row is already being built.
   *
   * The picker offers ready-made stretches, and for most guests that is the
   * whole interaction. But a guest who wants a *different* three tables — the
   * ones by the window, not the ones the arithmetic preferred — has no way to
   * say so except by pointing at them. So the room is not only a set of buttons
   * for prepared answers: tables can be added to a row one at a time.
   *
   * ## Every tap is about the row, including the first
   *
   * - **Start it**, when nothing is chosen — with that one table, and only that
   *   one. Tapping a table used to take the whole prepared stretch it belonged
   *   to, which meant a guest could never begin a row of their own: the first
   *   tap answered the question for them. The prepared stretches are still
   *   there, named, in the list below.
   * - **Extend the row**, when the table stands at either end of it. Only at an
   *   end, because a row is a row: tables that do not touch cannot be pushed
   *   together, and a gap in the middle is two rows with somebody else between.
   * - **Shorten it**, when the table tapped is the end of it — the way anybody
   *   undoes the last thing they did.
   * - **Start again** with that table alone, for anything else. Tapping a table
   *   across the room is not a mistake to be refused; it is a guest changing
   *   their mind about where to sit.
   *
   * ## What it will not do
   *
   * Add a table to a row that **already seats the party**. The guest is not
   * being economical on the restaurant's behalf and should not have to be, but
   * a party of four holding six tables is a room sold out by mid-evening. The
   * row stops growing when it is big enough, which also means the seat count
   * cannot be run up by accident.
   */
  const runAfterTapping = (table: TableOffer): string | null => {
    const current = (chosen ?? "").split("+").filter(Boolean);
    const byId = new Map(zone.tables.map((entry) => [entry.id, entry]));
    const run = current.map((id) => byId.get(id)).filter((entry): entry is TableOffer => Boolean(entry));

    const alone = table.unavailable ? null : table.id;

    if (run.length === 0) {
      return alone;
    }

    const at = run.findIndex((entry) => entry.id === table.id);

    if (at === 0) {
      // The near end: let it go, and the row that is left stands on its own.
      return run.slice(1).map((entry) => entry.id).join("+") || null;
    }

    if (at === run.length - 1) {
      return run.slice(0, -1).map((entry) => entry.id).join("+") || null;
    }

    // Somewhere in the middle of the row: not an end, so not something to
    // remove without tearing the row in two. Start again from it instead.
    if (at > 0) {
      return alone;
    }

    const extended = [
      [table, ...run],
      [...run, table],
    ].find((candidate) => inspectRun(candidate).ok);

    if (!extended) {
      // Nowhere near the row: a guest changing their mind about where to sit.
      return alone;
    }

    /**
     * Big enough already, so the row does not grow — but the selection is not
     * thrown away either. Tapping the next table along when a party of six
     * already has its six seats is a stray tap, and losing three chosen tables
     * to one of those is the sort of thing that makes people start again.
     */
    if (inspectRun(run).seats >= guestCount) {
      return chosen;
    }

    return extended.map((entry) => entry.id).join("+");
  };

  /** What the row being built seats, for the line under the plan. */
  const building = (chosen ?? "").split("+").filter(Boolean);
  const buildingRun = building
    .map((id) => zone.tables.find((entry) => entry.id === id))
    .filter((entry): entry is TableOffer => Boolean(entry));
  const buildingSeats = buildingRun.length > 0 ? inspectRun(buildingRun).seats : 0;

  /** Every table the current choice covers. One, or two pushed together. */
  const chosenTables = new Set((chosen ?? "").split("+").filter(Boolean));

  /** The tables of the chosen combination, so the join can be drawn. */
  const joined = chosenTables.size > 1 ? zone.tables.filter((table) => chosenTables.has(table.id)) : [];

  return (
    <div className="mt-5">
      <PlanViewport
        zone={zone}
        label={`${zone.name}, tables available for ${guestCount}`}
        reveal={reveal}
      >
        {/* The hall itself. Its walls are drawn, so the edge of the room reads
            as an edge rather than as the end of the picture. */}
        <rect
          x={0}
          y={0}
          width={zone.width}
          height={zone.height}
          rx={8}
          className="fill-surface stroke-line-strong"
          strokeWidth={3}
        />

        {zone.features.map((feature) => (
          <RoomFeature key={feature.id} feature={feature} />
        ))}

        {/*
          The join, drawn under the tables: a band from the middle of one to the
          middle of the next, so two tables chosen together read as one table
          rather than as two separate picks that happen to be highlighted.
        */}
        {joined.length > 1
          ? joined.slice(1).map((table, index) => {
              const previous = joined[index];

              return (
                <line
                  key={`join-${table.id}`}
                  x1={previous.x + previous.width / 2}
                  y1={previous.y + previous.height / 2}
                  x2={table.x + table.width / 2}
                  y2={table.y + table.height / 2}
                  className="pointer-events-none stroke-primary"
                  strokeWidth={14}
                  strokeLinecap="round"
                  opacity={0.85}
                />
              );
            })
          : null}

        {zone.tables.map((table) => (
          <PickableTable
            key={table.id}
            table={table}
            chosen={chosenTables.has(table.id)}
            buildRun={() => runAfterTapping(table)}
            onSelect={onSelect}
            onRefuse={onRefuse}
            onFocus={() => setReveal(table)}
          />
        ))}
      </PlanViewport>

      {/*
        What the row being built comes to, as it is built. A guest adding tables
        one at a time is answering "will we all fit", and the number has to move
        under their finger — finding out at the summary that three two-tops seat
        six is finding out too late.
      */}
      {buildingRun.length > 0 ? (
        <p className="mt-2 text-center text-sm text-ink" role="status">
          <span className="font-medium">
            {buildingRun.length > 1 ? "Tables " : "Table "}
            {buildingRun.map((entry) => entry.label).join(" + ")}
          </span>{" "}
          {buildingRun.length > 1 ? `seat ${buildingSeats} pushed together` : `seats ${buildingSeats}`}
          {buildingSeats < guestCount ? (
            <span className="text-ink-muted">
              {" "}
              — not enough for {guestCount}, tap a table beside it to add it
            </span>
          ) : null}
        </p>
      ) : null}

      <p className="mt-2 text-center text-xs text-ink-subtle">
        Drag to move around the room, pinch or scroll to zoom — or pick from the list below. Tap a
        table beside the ones you have to push more together.
      </p>
    </div>
  );
}

/** The room around the tables. Scenery: nothing here is interactive. */
function RoomFeature({ feature }: { feature: FloorFeature }) {
  return (
    <g
      transform={`translate(${feature.x} ${feature.y}) rotate(${feature.rotation} ${feature.width / 2} ${feature.height / 2})`}
      className="pointer-events-none"
    >
      <rect
        width={feature.width}
        height={feature.height}
        rx={feature.kind === "plant" ? feature.width / 2 : 6}
        className={cx(
          feature.kind === "window" ? "fill-accent-soft stroke-gold/50" : "fill-surface-sunken stroke-line",
        )}
        strokeWidth={2}
      />
      {feature.height >= 40 && feature.width >= 70 ? (
        <text
          x={feature.width / 2}
          y={feature.height / 2 + 5}
          textAnchor="middle"
          className="select-none fill-ink-subtle text-[14px]"
        >
          {feature.label || FEATURE_LABELS[feature.kind]}
        </text>
      ) : null}
    </g>
  );
}

/**
 * One table.
 *
 * Unavailable tables keep their place and lose their affordance, but they are
 * no longer silent: a tap says why, because a table that does nothing when
 * pressed reads as a broken screen rather than as a table somebody else has.
 * They are crossed through as well as greyed — a difference in tone alone is
 * not a difference everybody receives.
 */
function PickableTable({
  table,
  chosen,
  buildRun,
  onSelect,
  onRefuse,
  onFocus,
}: {
  table: TableOffer;
  chosen: boolean;
  /** The whole selection this tap would leave behind. */
  buildRun: () => string | null;
  onSelect: (next: string | null) => void;
  onRefuse: (table: TableOffer) => void;
  onFocus: () => void;
}) {
  const dragged = usePlanDragged();

  /**
   * A table too small on its own is still pickable, because it is a place to
   * start or continue a row — that is the entire point of pushing tables
   * together, and refusing the tap would leave the guest nothing to build with.
   *
   * Two things are still refused. **Somebody is already there**, in which case
   * no part of it is anybody else's; and it is **kept back for a larger party**,
   * which is the right-sizing rule and would be undone by a tap. That second one
   * never collides with building a row: a table held back for a larger party is
   * one that fits this party on its own, and stretches are only ever offered
   * when nothing fits on its own.
   */
  const free = !(
    table.occupied ||
    table.unavailable === "out-of-service" ||
    table.unavailable === "kept-for-larger"
  );

  const onActivate = () => {
    // Sliding the room past a table must never book it.
    if (dragged()) return;

    if (!free) {
      onRefuse(table);
      return;
    }

    // Every tap adjusts the row: starting it, extending it at either end,
    // shortening it, or starting again somewhere else.
    onSelect(buildRun());
  };
  const middle = { x: table.width / 2, y: table.height / 2 };

  const fill = chosen
    ? "fill-primary stroke-accent"
    : free
      ? "fill-surface stroke-line-strong"
      : "fill-surface-sunken stroke-line";

  const stroke = chosen ? "stroke-[5]" : "stroke-2";

  return (
    <g
      transform={`translate(${table.x} ${table.y}) rotate(${table.rotation} ${middle.x} ${middle.y})`}
      role="button"
      tabIndex={0}
      aria-disabled={free ? undefined : true}
      aria-pressed={free ? chosen : undefined}
      aria-label={
        free
          ? chosen
            ? `Table ${table.label}, seats ${table.seats}, chosen — activate to remove it`
            : `Table ${table.label}, seats ${table.seats} — activate to add it`
          : refusalSentence(table)
      }
      className={cx(free ? "cursor-pointer" : "cursor-default opacity-60")}
      onClick={onActivate}
      onFocus={onFocus}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          event.stopPropagation();
          onActivate();
        }
      }}
    >
      {table.shape === "round" || table.shape === "oval" ? (
        <ellipse
          cx={middle.x}
          cy={middle.y}
          rx={table.width / 2}
          ry={table.height / 2}
          className={cx(stroke, fill)}
        />
      ) : (
        <rect width={table.width} height={table.height} rx={8} className={cx(stroke, fill)} />
      )}

      {/* A cross over what cannot be had: legible in grey, in print, and to
          anybody for whom the greying is not a difference they can see. */}
      {free ? null : (
        <g className="pointer-events-none stroke-line-strong opacity-70" strokeWidth={2}>
          <line x1={6} y1={6} x2={table.width - 6} y2={table.height - 6} />
          <line x1={table.width - 6} y1={6} x2={6} y2={table.height - 6} />
        </g>
      )}

      <text
        x={middle.x}
        y={middle.y - 2}
        textAnchor="middle"
        className={cx(
          "pointer-events-none select-none text-[17px] font-semibold",
          chosen ? "fill-primary-fg" : "fill-ink",
        )}
      >
        {table.label}
      </text>
      <text
        x={middle.x}
        y={middle.y + 14}
        textAnchor="middle"
        className={cx(
          "pointer-events-none select-none text-[13px]",
          chosen ? "fill-primary-fg" : "fill-ink-subtle",
        )}
      >
        {table.seats}
      </text>
    </g>
  );
}

/**
 * Why a table cannot be picked, short enough for a row in the list.
 *
 * Sentence case, not a fragment bolted onto a name: the same string has to read
 * beside "Table 3" in a list and inside a screen reader's announcement of it.
 */
export function refusalOf(table: TableOffer): string {
  switch (table.unavailable) {
    case "too-small":
      return `Seats ${table.seats} — too small for your party`;
    case "taken":
      return "Already taken";
    case "out-of-service":
      return "Not in use that evening";
    case "kept-for-larger":
      return `Seats ${table.seats} — kept for a larger party`;
    default:
      return `Seats ${table.seats}`;
  }
}

/** The same refusal as something a person would say. */
export function refusalSentence(table: TableOffer): string {
  switch (table.unavailable) {
    case "too-small":
      return `Table ${table.label} seats ${table.seats} — too small for your party.`;
    case "taken":
      return `Table ${table.label} is already taken.`;
    case "out-of-service":
      return `Table ${table.label} is not in use that evening.`;
    case "kept-for-larger":
      return `Table ${table.label} seats ${table.seats}, so it is kept for a larger party — please take one of the smaller tables.`;
    default:
      return `Table ${table.label} seats ${table.seats}.`;
  }
}
