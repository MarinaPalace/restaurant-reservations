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
  onChoose,
  onRefuse,
}: {
  zone: ZoneOffer;
  guestCount: number;
  /** A table id, or a combination id — `t7+t8` — when tables are pushed together. */
  chosen: string | null;
  onChoose: (id: string) => void;
  /** A guest tapped a table they cannot have. Says why, in words. */
  onRefuse: (table: TableOffer) => void;
}) {
  /**
   * The table to bring into the frame. Set when one is reached by tabbing, so
   * the keyboard never lands on something off screen.
   */
  const [reveal, setReveal] = useState<TableOffer | null>(null);

  /**
   * Which combination tapping each table takes.
   *
   * A four-top is "too small" for a party of five on its own, and the plan used
   * to grey it out and stop there. If it is part of an offered stretch, tapping
   * it takes that stretch — the guest is choosing *where to sit*, and how many
   * tables that means is the restaurant's arithmetic, not theirs.
   *
   * ## A table can be in more than one of them
   *
   * Offered stretches overlap: in a row of six two-tops a party of six is
   * offered 1+2+3, 2+3+4, 3+4+5 and 4+5+6, and table 3 is in three of those.
   * The **first** wins, which is the tightest — so tapping a table always takes
   * the offer that costs the room least, and a guest who wants one of the others
   * picks it from the list, where they are named. Last-one-wins would have made
   * the tap depend on the order the search happened to run in.
   *
   * A stretch the guest has already chosen stays chosen: tapping any of its
   * tables lets it go again, rather than silently swapping them onto a different
   * stretch that happens to share a table.
   */
  const inCombination = new Map<string, string>();

  for (const combination of zone.combinations) {
    for (const tableId of combination.tableIds) {
      if (!inCombination.has(tableId)) {
        inCombination.set(tableId, combination.id);
      }
    }
  }

  /** The stretch a tap on this table should take, the chosen one winning. */
  const combinationFor = (tableId: string): string | null => {
    const chosenIds = (chosen ?? "").split("+");

    if (chosenIds.length > 1 && chosenIds.includes(tableId)) {
      return chosen;
    }

    return inCombination.get(tableId) ?? null;
  };

  /**
   * What tapping a table does when a row is already being built.
   *
   * The picker offers ready-made stretches, and for most guests that is the
   * whole interaction. But a guest who wants a *different* three tables — the
   * ones by the window, not the ones the arithmetic preferred — has no way to
   * say so except by pointing at them. So the room is not only a set of buttons
   * for prepared answers: tables can be added to a row one at a time.
   *
   * ## What a tap may do
   *
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

    // Big enough already — see above.
    if (inspectRun(run).seats >= guestCount) {
      return alone;
    }

    const extended = [
      [table, ...run],
      [...run, table],
    ].find((candidate) => inspectRun(candidate).ok);

    return extended ? extended.map((entry) => entry.id).join("+") : alone;
  };

  /** What the row being built seats, for the line under the plan. */
  const building = (chosen ?? "").split("+").filter(Boolean);
  const buildingRun = building
    .map((id) => zone.tables.find((entry) => entry.id === id))
    .filter((entry): entry is TableOffer => Boolean(entry));
  const buildingSeats = buildingRun.length > 1 ? inspectRun(buildingRun).seats : 0;

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
            joinWith={combinationFor(table.id)}
            buildRun={() => runAfterTapping(table)}
            building={building.length > 1}
            onChoose={onChoose}
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
      {buildingRun.length > 1 ? (
        <p className="mt-2 text-center text-sm text-ink" role="status">
          <span className="font-medium">
            Tables {buildingRun.map((entry) => entry.label).join(" + ")}
          </span>{" "}
          seat {buildingSeats} pushed together
          {buildingSeats < guestCount ? (
            <span className="text-ink-muted"> — tap a table at either end to add it</span>
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
  joinWith,
  buildRun,
  building,
  onChoose,
  onRefuse,
  onFocus,
}: {
  table: TableOffer;
  chosen: boolean;
  /**
   * The combination this table is half of, when the party needs two tables
   * pushed together. Tapping it takes the whole combination.
   */
  joinWith: string | null;
  /** The row this tap would leave behind, once one is being built by hand. */
  buildRun: () => string | null;
  /** Whether a row is being built, in which case a tap adjusts it. */
  building: boolean;
  onChoose: (id: string) => void;
  onRefuse: (table: TableOffer) => void;
  onFocus: () => void;
}) {
  const dragged = usePlanDragged();

  /**
   * A table too small on its own is still pickable when it is half of an
   * offered pair — that is the entire point of pushing two together. The same
   * goes for one being added to a row the guest is building by hand, and for
   * one kept back for a larger party, which is an answer about a table standing
   * on its own.
   *
   * Anything taken or out of service is not pickable, in any of those cases.
   */
  const held = table.occupied || table.unavailable === "out-of-service";
  const free = !table.unavailable || (!held && (Boolean(joinWith) || building));

  const onActivate = () => {
    // Sliding the room past a table must never book it.
    if (dragged()) return;

    /**
     * Once a row is being built by hand, every tap adjusts *that* row — adding
     * a table at either end, taking one off, or starting again somewhere else.
     * The prepared combination is only what a tap means when nothing is being
     * built yet, or it would take the row away from a guest halfway through
     * choosing it.
     */
    if (building) {
      const next = buildRun();

      if (next) {
        onChoose(next);
        return;
      }
    }

    if (joinWith) {
      onChoose(joinWith);
      return;
    }

    if (table.unavailable) {
      onRefuse(table);
      return;
    }

    onChoose(table.id);
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
        joinWith
          ? `Table ${table.label}, seats ${table.seats}, pushed together with another table for your party`
          : free
            ? `Table ${table.label}, seats ${table.seats}`
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
