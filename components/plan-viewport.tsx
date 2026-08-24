"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { cx } from "@/components/ui/utils";
import type { Placed } from "@/lib/floor-plan";
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
 * A floor plan you can actually look around.
 *
 * ## Why every plan needs this
 *
 * Twice now the same fault has shipped: an `<svg>` given `w-full min-w-[Nrem]`
 * inside a wrapper with `overflow-x-auto`, and `touch-none` on the drawing so a
 * drag does not scroll the page. On anything narrower than that minimum the
 * drawing is forced wider than the box holding it, the far wall is outside, and
 * the only thing that could scroll to it is the wrapper — which the finger
 * cannot reach, because the finger is on the SVG. It happened to the guest
 * picker (`docs/floor-plan.md` §18) and it happened to the service board.
 *
 * So the viewport is one component, used by both, and the arithmetic under it
 * is `lib/floor-plan-viewport.ts` — pure and tested, because a viewport that
 * can be reasoned about without a browser is one that can be trusted on a
 * phone.
 *
 * ## What it guarantees
 *
 * - The whole plan is visible on open, however small that has to be. Nobody
 *   should move anything to learn that a table exists.
 * - It moves under a finger, a wheel, three buttons and the arrow keys. Gesture
 *   only leaves out a laptop without a wheel and a person without a mouse.
 * - It cannot be dragged off the side of the restaurant, and it cannot zoom out
 *   past the whole room.
 * - The box is shaped like the plan, so a wide room is not letterboxed inside
 *   deep empty bands.
 *
 * ## What it does not do
 *
 * It draws nothing. What is on the floor is `children`, in plan centimetres,
 * and every view keeps its own idea of what a table looks like — the guest's
 * picker and the service board mean very different things by a colour.
 */
export function PlanViewport({
  zone,
  label,
  children,
  reveal,
  onBackgroundTap,
}: {
  /** The hall and everything on it. Only the geometry is read. */
  zone: {
    width: number;
    height: number;
    tables: readonly Placed[];
    features: readonly Placed[];
  };
  /** What a screen reader calls this drawing. */
  label: string;
  children: ReactNode;
  /**
   * Something to bring into the frame — a table that has just been focused with
   * the keyboard, say. Panned to when it changes and is not already visible;
   * tabbing to something that cannot be seen is the same fault as clipping,
   * only quieter.
   */
  reveal?: { x: number; y: number; width: number; height: number } | null;
  /** A tap on the floor itself, rather than on anything drawn. Not a drag. */
  onBackgroundTap?: () => void;
}) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const bounds = useMemo(() => planBounds(zone), [zone]);
  const [view, setView] = useState<ViewBox>(() => fitView(bounds));

  /**
   * A different room means a different view: somebody who has zoomed into the
   * terrace should not find the main hall at the same magnification.
   *
   * Adjusted **during render** off a remembered size, not from an effect — rule
   * 2.15. React re-runs the component immediately and nothing paints at the
   * wrong magnification, where an effect would draw the old view first and then
   * correct it.
   */
  const key = `${bounds.x},${bounds.y},${bounds.width},${bounds.height}`;
  const [drawn, setDrawn] = useState(key);

  if (drawn !== key) {
    setDrawn(key);
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

    // A drag that starts on a table still pans the room; what a tap does is
    // decided on click, and a drag suppresses it.
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

  const onWheel = (event: React.WheelEvent<SVGSVGElement>) => {
    if (event.deltaY === 0) return;

    const focus = toPlanUnits(event) ?? undefined;
    setView((current) => zoomView(current, bounds, event.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP, focus));
  };

  /* ---------------------------------------------------------------- *
   * Buttons and keys
   * ---------------------------------------------------------------- */

  const dragged = useCallback(() => moved.current > DRAG_SLOP, []);

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

  /** Brings something into the frame, if it is not already there. */
  const revealKey = reveal ? `${reveal.x},${reveal.y},${reveal.width},${reveal.height}` : "";
  const [revealed, setRevealed] = useState(revealKey);

  if (revealed !== revealKey) {
    setRevealed(revealKey);

    if (reveal) {
      setView((current) => {
        const insideX = reveal.x >= current.x && reveal.x + reveal.width <= current.x + current.width;
        const insideY = reveal.y >= current.y && reveal.y + reveal.height <= current.y + current.height;
        if (insideX && insideY) return current;

        return panView(
          current,
          bounds,
          reveal.x + reveal.width / 2 - (current.x + current.width / 2),
          reveal.y + reveal.height / 2 - (current.y + current.height / 2),
        );
      });
    }
  }

  return (
    <div className="relative overflow-hidden rounded-control border border-line bg-surface-muted">
      <svg
        ref={svgRef}
        viewBox={viewBoxAttr(view)}
        preserveAspectRatio="xMidYMid meet"
        tabIndex={0}
        /*
          Shaped like the plan rather than given a height of its own. A fixed
          box letterboxed a wide room inside deep empty bands, which wastes most
          of a phone screen on nothing; zooming and panning never change the
          ratio, so this holds at every magnification.

          There is deliberately **no height class here at all**. An explicit
          height beats `aspect-ratio` in CSS, so passing one — even a
          well-meaning `h-[min(70vh,32rem)]` — quietly puts the letterboxing
          back: measured on a phone, a 1440x940 room came out 341 wide and 512
          tall, most of it empty. `max-h` only caps a very deep plan, which is
          the one case worth capping.
        */
        style={{ aspectRatio: `${bounds.width} / ${bounds.height}` }}
        className={cx(
          "block max-h-[70vh] min-h-[12rem] w-full touch-none outline-none focus-visible:ring-2 focus-visible:ring-accent",
          dragging ? "cursor-grabbing" : "cursor-grab",
        )}
        role="group"
        aria-label={`${label}. Drag to move around the room, arrow keys to move, plus and minus to zoom.`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onWheel={onWheel}
        onKeyDown={onKeyDown}
        onClick={(event) => {
          if (event.target === event.currentTarget && moved.current <= DRAG_SLOP) {
            onBackgroundTap?.();
          }
        }}
      >
        <DraggedContext.Provider value={dragged}>{children}</DraggedContext.Provider>
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
  );
}

/** A drag is not a tap. Four pixels of slop for a thumb on glass. */
const DRAG_SLOP = 4;

const DraggedContext = createContext<() => boolean>(() => false);

/**
 * Whether the gesture that ended in this click was a drag.
 *
 * Anything drawn inside a viewport asks this before acting on a tap, so sliding
 * the room past a table never books it. Through context rather than a prop
 * because the answer belongs to the viewport and the question is asked several
 * layers down, on every table.
 */
export function usePlanDragged(): () => boolean {
  return useContext(DraggedContext);
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
  children: ReactNode;
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
