import { describe, expect, it } from "vitest";
import { clampPosition, type FloorFeature, type FloorTable } from "@/lib/floor-plan";
import {
  MAX_ZOOM,
  fitView,
  panView,
  planBounds,
  viewBoxAttr,
  zoomOf,
  zoomView,
} from "@/lib/floor-plan-viewport";

function table(over: Partial<FloorTable> = {}): FloorTable {
  return {
    id: "t1",
    label: "1",
    seats: 4,
    shape: "square",
    active: true,
    x: 100,
    y: 100,
    width: 70,
    height: 70,
    rotation: 0,
    ...over,
  };
}

function feature(over: Partial<FloorFeature> = {}): FloorFeature {
  return { id: "f1", kind: "window", x: 0, y: 0, width: 160, height: 20, rotation: 0, ...over };
}

const ROOM = { width: 1400, height: 900 };

describe("planBounds", () => {
  it("covers the hall itself even when nothing is drawn in it", () => {
    const bounds = planBounds({ ...ROOM, tables: [], features: [] });

    expect(bounds.x).toBeLessThan(0);
    expect(bounds.y).toBeLessThan(0);
    expect(bounds.x + bounds.width).toBeGreaterThan(ROOM.width);
    expect(bounds.y + bounds.height).toBeGreaterThan(ROOM.height);
  });

  it("does not shrink to the furniture when the room is half empty", () => {
    const bounds = planBounds({ ...ROOM, tables: [table()], features: [] });

    expect(bounds.width).toBeGreaterThanOrEqual(ROOM.width);
    expect(bounds.height).toBeGreaterThanOrEqual(ROOM.height);
  });

  it("reaches a window stood on end against the left wall", () => {
    // This is the clipping bug: `clampPosition` stores this at x = -70, and a
    // viewBox starting at 0 cut it off with nothing to scroll to.
    const stood = feature({ rotation: 90, x: -500 });
    const placed = { ...stood, ...clampPosition(stood, ROOM) };

    expect(placed.x).toBeLessThan(0);

    const bounds = planBounds({ ...ROOM, tables: [], features: [placed] });
    const left = placed.x + (placed.width - 20) / 2;

    expect(bounds.x).toBeLessThanOrEqual(left);
  });

  it("reaches a table turned against the far corner", () => {
    const turned = { ...table({ width: 140, height: 80, shape: "oval", rotation: 90 }) };
    const placed = { ...turned, ...clampPosition(turned, ROOM) };
    const bounds = planBounds({ ...ROOM, tables: [placed], features: [] });

    expect(bounds.x + bounds.width).toBeGreaterThanOrEqual(placed.x + placed.width);
    expect(bounds.y + bounds.height).toBeGreaterThanOrEqual(placed.y + placed.height);
  });
});

describe("the view over the plan", () => {
  const bounds = planBounds({ ...ROOM, tables: [table()], features: [] });

  it("opens on the whole plan", () => {
    expect(zoomOf(fitView(bounds), bounds)).toBe(1);
    expect(viewBoxAttr(fitView(bounds))).toBe(viewBoxAttr(bounds));
  });

  it("never zooms out past the fitted plan", () => {
    const out = zoomView(zoomView(fitView(bounds), bounds, 0.2), bounds, 0.2);

    expect(zoomOf(out, bounds)).toBe(1);
    expect(out.width).toBeCloseTo(bounds.width);
  });

  it("stops at the closest allowed zoom", () => {
    let view = fitView(bounds);
    for (let step = 0; step < 40; step += 1) {
      view = zoomView(view, bounds, 1.25);
    }

    expect(zoomOf(view, bounds)).toBeCloseTo(MAX_ZOOM);
  });

  it("keeps the point under the fingers where it was", () => {
    const focus = { x: 300, y: 400 };
    const view = fitView(bounds);
    const closer = zoomView(view, bounds, 2, focus);

    // Same fractional place in the frame, so the floor does not slide away.
    expect((focus.x - closer.x) / closer.width).toBeCloseTo((focus.x - view.x) / view.width);
    expect((focus.y - closer.y) / closer.height).toBeCloseTo((focus.y - view.y) / view.height);
  });

  it("cannot be dragged off the side of the plan", () => {
    const view = panView(zoomView(fitView(bounds), bounds, 4), bounds, 99_999, 99_999);

    expect(view.x + view.width).toBeLessThanOrEqual(bounds.x + bounds.width + 0.001);
    expect(view.y + view.height).toBeLessThanOrEqual(bounds.y + bounds.height + 0.001);

    const back = panView(view, bounds, -99_999, -99_999);

    expect(back.x).toBeGreaterThanOrEqual(bounds.x - 0.001);
    expect(back.y).toBeGreaterThanOrEqual(bounds.y - 0.001);
  });

  it("centres a view wider than the plan rather than pinning it to a corner", () => {
    const wide = panView({ x: 0, y: 0, width: bounds.width * 2, height: bounds.height * 2 }, bounds, 500, 500);

    expect(wide.x + wide.width / 2).toBeCloseTo(bounds.x + bounds.width / 2);
    expect(wide.y + wide.height / 2).toBeCloseTo(bounds.y + bounds.height / 2);
  });
});
