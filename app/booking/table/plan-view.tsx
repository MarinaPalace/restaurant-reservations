"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { cx } from "@/components/ui/utils";
import { FEATURE_LABELS, type FloorFeature } from "@/lib/floor-plan";
import type { TableOffer, ZoneOffer } from "@/lib/floor-plan-availability";
import {
  MAX_ZOOM,
  ZOOM_STEP,
  fitView,
  panView,
  planBounds,
  viewBoxAttr,
  zoomOf,
  zoomView,
  type ViewBox,
} from "@/lib/floor-plan-viewport";

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
 * then moves under a finger deliberately. The arithmetic is in
 * `lib/floor-plan-viewport.ts`, pure and tested; this file is only the hands on
 * it. `docs/floor-plan.md` §18 has the measurements.
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
  const svgRef = useRef<SVGSVGElement | null>(null);
  const bounds = useMemo(() => planBounds(zone), [zone]);
  const [view, setView] = useState<ViewBox>(() => fitView(bounds));

  /**
   * A different room means a different view: a guest who has zoomed into the
   * terrace should not find the main hall at the same magnification.
   *
   * Adjusted **during render** off a remembered zone id, not from an effect —
   * rule 2.15. React re-runs this component immediately with the new view and
   * nothing renders at the wrong magnification, where an effect would paint the
   * old view first and then correct it.
   */
  const [drawnZone, setDrawnZone] = useState(zone.id);

  if (drawnZone !== zone.id) {
    setDrawnZone(zone.id);
    setView(fitView(bounds));
  }

  const zoom = zoomOf(view, bounds);

  /**
   * Pointer position in centimetres of floor.
   *
   * Through the SVG's own screen matrix, not its bounding rectangle: the
   * viewBox is letterboxed inside the element whenever the aspect ratios
   * differ, and measuring against the rect counts the empty bars as floor. The
   * designer learned this the hard way — the same note is in
   * `floor-plan-designer.tsx`.
   */
  const toPlanUnits = useCallback((event: { clientX: number; clientY: number }) => {
    const svg = svgRef.current;
    const matrix = svg?.getScreenCTM();
    if (!svg || !matrix) return null;

    const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
    return { x: point.x, y: point.y };
  }, []);

  /** Screen pixels per centimetre of floor, for turning a drag into a pan. */
  const pixelsPerUnit = () => svgRef.current?.getScreenCTM()?.a || 1;

  /* ---------------------------------------------------------------- *
   * Dragging and pinching
   * ---------------------------------------------------------------- */

  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<number | null>(null);
  const moved = useRef(0);
  const [dragging, setDragging] = useState(false);

  const spread = () => {
    const [a, b] = [...pointers.current.values()];
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : null;
  };

  const onPointerDown = (event: React.PointerEvent<SVGSVGElement>) => {
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (pointers.current.size === 2) {
      pinch.current = spread();
      return;
    }

    // A drag that starts on a table still pans the room; the tap that chooses
    // is decided on click, and a drag suppresses it.
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(true);
  };

  const onPointerMove = (event: React.PointerEvent<SVGSVGElement>) => {
    const previous = pointers.current.get(event.pointerId);
    if (!previous) return;

    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (pointers.current.size >= 2) {
      const was = pinch.current;
      const now = spread();
      if (!was || !now) return;

      const [a, b] = [...pointers.current.values()];
      const middle = a && b ? toPlanUnits({ clientX: (a.x + b.x) / 2, clientY: (a.y + b.y) / 2 }) : null;

      pinch.current = now;
      moved.current = Number.MAX_SAFE_INTEGER;
      setView((current) => zoomView(current, bounds, now / was, middle ?? undefined));
      return;
    }

    const dx = event.clientX - previous.x;
    const dy = event.clientY - previous.y;
    moved.current += Math.abs(dx) + Math.abs(dy);

    const scale = pixelsPerUnit();
    // The floor follows the finger, so the view moves the other way.
    setView((current) => panView(current, bounds, -dx / scale, -dy / scale));
  };

  const onPointerUp = (event: React.PointerEvent<SVGSVGElement>) => {
    pointers.current.delete(event.pointerId);
    pinch.current = pointers.current.size === 2 ? spread() : null;

    if (pointers.current.size === 0) {
      setDragging(false);
      // Cleared after the click this release is about to fire.
      requestAnimationFrame(() => {
        moved.current = 0;
      });
    }
  };

  /** A drag is not a choice. Four pixels of slop for a thumb on glass. */
  const wasDragged = () => moved.current > 4;

  const onWheel = (event: React.WheelEvent<SVGSVGElement>) => {
    if (event.deltaY === 0) return;

    const focus = toPlanUnits(event) ?? undefined;
    setView((current) => zoomView(current, bounds, event.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP, focus));
  };

  /* ---------------------------------------------------------------- *
   * Buttons and keys
   *
   * Gestures alone are not enough: a guest on a laptop with no wheel, or on a
   * keyboard, gets the same three controls.
   * ---------------------------------------------------------------- */

  const zoomBy = (factor: number) => setView((current) => zoomView(current, bounds, factor));
  const fit = () => setView(fitView(bounds));

  const onKeyDown = (event: React.KeyboardEvent<SVGSVGElement>) => {
    const step = 0.15;
    const pans: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };

    const pan = pans[event.key];
    if (pan) {
      event.preventDefault();
      setView((current) => panView(current, bounds, pan[0] * current.width, pan[1] * current.height));
      return;
    }

    if (event.key === "+" || event.key === "=") {
      event.preventDefault();
      zoomBy(ZOOM_STEP);
    } else if (event.key === "-" || event.key === "_") {
      event.preventDefault();
      zoomBy(1 / ZOOM_STEP);
    } else if (event.key === "0") {
      event.preventDefault();
      fit();
    }
  };

  /**
   * A table reached with the keyboard is brought into the frame.
   *
   * Tabbing to something that cannot be seen is the same fault as the clipping,
   * only quieter.
   */
  const revealTable = (table: TableOffer) => {
    setView((current) => {
      const insideX = table.x >= current.x && table.x + table.width <= current.x + current.width;
      const insideY = table.y >= current.y && table.y + table.height <= current.y + current.height;
      if (insideX && insideY) return current;

      return panView(
        current,
        bounds,
        table.x + table.width / 2 - (current.x + current.width / 2),
        table.y + table.height / 2 - (current.y + current.height / 2),
      );
    });
  };

  return (
    <div className="mt-5">
      <div className="relative overflow-hidden rounded-control border border-line bg-surface-muted">
        <svg
          ref={svgRef}
          viewBox={viewBoxAttr(view)}
          preserveAspectRatio="xMidYMid meet"
          tabIndex={0}
          /*
            Shaped like the plan itself rather than given a height of its own.
            A fixed box letterboxed a wide room inside deep empty bands — the
            fitted plan came out at 322 x 416 for a room half again as wide as
            it is deep, which wastes most of a phone screen on nothing. Zooming
            and panning never change the ratio, so this holds at every
            magnification.
          */
          style={{ aspectRatio: `${bounds.width} / ${bounds.height}` }}
          className={cx(
            "block max-h-[70vh] min-h-[12rem] w-full touch-none outline-none focus-visible:ring-2 focus-visible:ring-accent",
            dragging ? "cursor-grabbing" : "cursor-grab",
          )}
          role="group"
          aria-label={`${zone.name}, tables available for ${guestCount}. Drag to move around the room, arrow keys to move, plus and minus to zoom.`}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onWheel={onWheel}
          onKeyDown={onKeyDown}
        >
          {/* The hall itself. Its walls are drawn, so the edge of the room
              reads as an edge rather than as the end of the picture. */}
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
              onActivate={() => {
                if (wasDragged()) return;

                if (table.unavailable) {
                  onRefuse(table);
                  return;
                }

                onChoose(table.id);
              }}
              onFocus={() => revealTable(table)}
            />
          ))}
        </svg>

        <div className="absolute right-2 top-2 flex flex-col gap-1">
          <ZoomButton label="Zoom in" onClick={() => zoomBy(ZOOM_STEP)} disabled={zoom >= MAX_ZOOM - 0.001}>
            +
          </ZoomButton>
          <ZoomButton label="Zoom out" onClick={() => zoomBy(1 / ZOOM_STEP)} disabled={zoom <= 1.001}>
            −
          </ZoomButton>
          <ZoomButton label="Fit the whole room" onClick={fit} disabled={zoom <= 1.001}>
            <span className="text-xs font-medium">Fit</span>
          </ZoomButton>
        </div>
      </div>

      <p className="mt-2 text-center text-xs text-ink-subtle">
        Drag to move around the room, pinch or scroll to zoom — or pick from the list below.
      </p>
    </div>
  );
}

function ZoomButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className="flex size-10 items-center justify-center rounded-control border border-line-strong bg-surface text-lg font-semibold text-ink shadow-sm transition-colors hover:border-accent disabled:opacity-40 disabled:hover:border-line-strong"
    >
      {children}
    </button>
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
  onActivate,
  onFocus,
}: {
  table: TableOffer;
  chosen: boolean;
  onActivate: () => void;
  onFocus: () => void;
}) {
  const free = !table.unavailable;
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
