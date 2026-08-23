import { rotatedExtent, type Placed } from "@/lib/floor-plan";

/**
 * What a plan actually covers, and how to look around it.
 *
 * Pure and separate from the screen that uses it, for the reason every other
 * pure module here is separate: a viewport that can be reasoned about in a test
 * is a viewport that can be trusted on a phone.
 *
 * ## Why this exists at all
 *
 * The guest picker was cut off on a phone: the drawing was forced wider than
 * the card holding it and the far wall was outside, with no way for a finger to
 * scroll to it (`docs/floor-plan.md` §18). Fitting the plan and then letting it
 * be moved deliberately is the fix, and both need to know what the plan
 * actually covers.
 *
 * That extent is computed from the drawing, never from the hall's own numbers.
 * `clampPosition` bounds the **rotated** footprint of a shape, so a 160 cm
 * window stood on end against the left wall is stored at `x = -70` with its
 * glass exactly on the wall: its stored rectangle is outside the hall while its
 * drawn one is not. Measuring the stored rectangle would be wrong, and trusting
 * the hall's numbers would be wrong the moment a plan arrived from somewhere
 * that did not clamp.
 */

/** A rectangle in plan centimetres. Serialises straight into an SVG viewBox. */
export type ViewBox = {
  x: number;
  y: number;
  width: number;
  height: number;
};

/**
 * How far in a guest may go. Eight times the fitted view puts one table across
 * a phone; past that the plan stops being a plan.
 */
export const MAX_ZOOM = 8;

/** One press of `+` or `−`. A quarter step, so it takes a few to get lost. */
export const ZOOM_STEP = 1.25;

/**
 * Breathing room around the drawing, in centimetres of floor.
 *
 * A table flush against a wall would otherwise have its outline half on the
 * edge of the picture, which reads as clipped even when nothing is missing.
 */
const MARGIN = 20;

/** The axis-aligned box a rotated shape really occupies. */
function footprint(placed: Placed): ViewBox {
  const extent = rotatedExtent(placed, placed.rotation);

  return {
    x: placed.x - (extent.width - placed.width) / 2,
    y: placed.y - (extent.height - placed.height) / 2,
    width: extent.width,
    height: extent.height,
  };
}

function union(a: ViewBox, b: ViewBox): ViewBox {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);

  return {
    x,
    y,
    width: Math.max(a.x + a.width, b.x + b.width) - x,
    height: Math.max(a.y + a.height, b.y + b.height) - y,
  };
}

/**
 * Everything the drawing covers: the hall, plus anything hanging over its edge.
 *
 * The hall rectangle is always included even when the furniture sits well
 * inside it — a room half full of tables is still that room, and fitting to the
 * furniture alone would make the plan a different shape every evening as
 * tables come and go.
 */
export function planBounds(zone: {
  width: number;
  height: number;
  /** Anything drawn: the guest's `TableOffer` and the designer's `FloorTable` both fit. */
  tables: readonly Placed[];
  features: readonly Placed[];
}): ViewBox {
  let bounds: ViewBox = { x: 0, y: 0, width: zone.width, height: zone.height };

  for (const placed of [...zone.tables, ...zone.features]) {
    bounds = union(bounds, footprint(placed));
  }

  return {
    x: bounds.x - MARGIN,
    y: bounds.y - MARGIN,
    width: bounds.width + MARGIN * 2,
    height: bounds.height + MARGIN * 2,
  };
}

/**
 * The whole plan, which is what a guest is shown first.
 *
 * Nobody should have to move anything to discover that a table exists.
 */
export function fitView(bounds: ViewBox): ViewBox {
  return { ...bounds };
}

/** How much closer than the fitted view this is. 1 is the whole plan. */
export function zoomOf(view: ViewBox, bounds: ViewBox): number {
  return bounds.width / view.width;
}

/**
 * Keeps a view over the plan rather than off the side of it.
 *
 * A view wider than the plan is centred instead of pinned to a corner: zoomed
 * all the way out on a wide screen, the room sits in the middle of the frame
 * where it belongs.
 */
function clampToBounds(view: ViewBox, bounds: ViewBox): ViewBox {
  const place = (start: number, size: number, min: number, extent: number): number => {
    if (size >= extent) {
      return min + (extent - size) / 2;
    }

    return Math.min(Math.max(start, min), min + extent - size);
  };

  return {
    x: place(view.x, view.width, bounds.x, bounds.width),
    y: place(view.y, view.height, bounds.y, bounds.height),
    width: view.width,
    height: view.height,
  };
}

/**
 * Zooms about a point, which is what makes a pinch or a wheel feel attached to
 * the floor: whatever is under the fingers stays under them.
 *
 * `focus` is in plan coordinates. Left out, the view zooms about its middle,
 * which is what the `+` and `−` buttons want.
 */
export function zoomView(
  view: ViewBox,
  bounds: ViewBox,
  factor: number,
  focus?: { x: number; y: number },
): ViewBox {
  const current = zoomOf(view, bounds);
  const wanted = Math.min(Math.max(current * factor, 1), MAX_ZOOM);
  // Snapped back out of the requested factor, so a wheel spun hard at the far
  // end does not drift the plan sideways while the zoom itself cannot move.
  const applied = current / wanted;

  const width = view.width * applied;
  const height = view.height * applied;

  const anchor = focus ?? { x: view.x + view.width / 2, y: view.y + view.height / 2 };
  // The anchor keeps its fractional place in the frame.
  const ratioX = (anchor.x - view.x) / view.width;
  const ratioY = (anchor.y - view.y) / view.height;

  return clampToBounds(
    { x: anchor.x - width * ratioX, y: anchor.y - height * ratioY, width, height },
    bounds,
  );
}

/** Drags the plan by a distance in plan centimetres. */
export function panView(view: ViewBox, bounds: ViewBox, dx: number, dy: number): ViewBox {
  return clampToBounds({ ...view, x: view.x + dx, y: view.y + dy }, bounds);
}

/** A viewBox attribute. */
export function viewBoxAttr(view: ViewBox): string {
  return `${view.x} ${view.y} ${view.width} ${view.height}`;
}
