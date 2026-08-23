"use client";

import { useState } from "react";
import { cx } from "@/components/ui/utils";
import { PlanViewport, usePlanDragged } from "@/components/plan-viewport";
import { FEATURE_LABELS, type FloorFeature } from "@/lib/floor-plan";
import type { TableOffer, ZoneOffer } from "@/lib/floor-plan-availability";

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
  chosen: string | null;
  onChoose: (tableId: string) => void;
  /** A guest tapped a table they cannot have. Says why, in words. */
  onRefuse: (table: TableOffer) => void;
}) {
  /**
   * The table to bring into the frame. Set when one is reached by tabbing, so
   * the keyboard never lands on something off screen.
   */
  const [reveal, setReveal] = useState<TableOffer | null>(null);

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

        {zone.tables.map((table) => (
          <PickableTable
            key={table.id}
            table={table}
            chosen={chosen === table.id}
            onChoose={onChoose}
            onRefuse={onRefuse}
            onFocus={() => setReveal(table)}
          />
        ))}
      </PlanViewport>

      <p className="mt-2 text-center text-xs text-ink-subtle">
        Drag to move around the room, pinch or scroll to zoom — or pick from the list below.
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
  onChoose,
  onRefuse,
  onFocus,
}: {
  table: TableOffer;
  chosen: boolean;
  onChoose: (tableId: string) => void;
  onRefuse: (table: TableOffer) => void;
  onFocus: () => void;
}) {
  const dragged = usePlanDragged();
  const free = !table.unavailable;

  const onActivate = () => {
    // Sliding the room past a table must never book it.
    if (dragged()) return;

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
      aria-label={free ? `Table ${table.label}, seats ${table.seats}` : refusalSentence(table)}
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
    default:
      return `Table ${table.label} seats ${table.seats}.`;
  }
}
