"use client";

import { useMemo, useRef, useState } from "react";
import { Card, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert, Badge } from "@/components/ui/feedback";
import { Field, Input, Select } from "@/components/ui/field";
import { cx } from "@/components/ui/utils";
import {
  DEFAULT_TABLE_SIZE,
  FEATURE_KINDS,
  FEATURE_LABELS,
  GRID,
  MAX_FEATURES_PER_ZONE,
  MAX_SEATS_PER_TABLE,
  MAX_SIZE,
  MAX_TABLES_PER_ZONE,
  MAX_ZONES,
  MIN_SIZE,
  PLAN_HEIGHT,
  PLAN_WIDTH,
  TABLE_SHAPES,
  clampPosition,
  clampSize,
  countPlan,
  countZone,
  describePlanProblems,
  duplicateLabels,
  newFeature,
  newTable,
  newZone,
  type FeatureKind,
  type FloorFeature,
  type FloorPlan,
  type FloorTable,
  type FloorZone,
  type Placed,
  type TableShape,
} from "@/lib/floor-plan";

/**
 * The restaurant designer — `docs/floor-plan.md` §5.
 *
 * Staff draw the floor here and nothing else happens yet: no booking reads the
 * plan and no seat accounting has changed (§9 step 1).
 *
 * A **zone** is a hall of the restaurant — the main hall, the terrace, a
 * private dining room. Never a hotel room; this app already uses that word for
 * where the guest is staying.
 *
 * Two things stand in a zone. **Tables** seat guests, carry the label that
 * becomes a booking's `tableNumber`, and are the only things a guest will ever
 * pick. **Features** are the rest of the restaurant — the walls, the windows,
 * the door, the bar, the stage the musician plays from — which nobody books
 * but which are what make the drawing recognisable as this restaurant rather
 * than a grid of circles.
 *
 * Nothing moves under a finger (rule 2.14): dragging one thing moves that
 * thing, and the plan never re-lays itself out.
 */

const SHAPE_LABELS: Record<TableShape, string> = {
  round: "Round",
  square: "Square",
  rectangle: "Rectangle",
  oval: "Oval",
};

/** Suggested tags, so a floor does not end up with six spellings of "window". */
const SUGGESTED_TAGS = ["window", "quiet", "corner", "by the music", "near the door", "terrace", "step-free"];

type Selection = { kind: "table" | "feature"; id: string } | null;
type DragMode = "move" | "resize";

export function FloorPlanDesigner({ initialPlan, canEdit }: { initialPlan: FloorPlan; canEdit: boolean }) {
  const [plan, setPlan] = useState(initialPlan);
  const [activeZoneId, setActiveZoneId] = useState(initialPlan.zones[0]?.id ?? "");
  const [selection, setSelection] = useState<Selection>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [dirty, setDirty] = useState(false);

  const svgRef = useRef<SVGSVGElement | null>(null);
  /** What the pointer is doing, and where in the shape it grabbed. */
  const drag = useRef<{ mode: DragMode; offsetX: number; offsetY: number } | null>(null);

  const zone = plan.zones.find((entry) => entry.id === activeZoneId) ?? plan.zones[0] ?? null;

  const selected: FloorTable | FloorFeature | null = useMemo(() => {
    if (!zone || !selection) return null;
    return selection.kind === "table"
      ? (zone.tables.find((table) => table.id === selection.id) ?? null)
      : (zone.features.find((feature) => feature.id === selection.id) ?? null);
  }, [zone, selection]);

  const totals = useMemo(() => countPlan(plan), [plan]);
  const zoneTotals = useMemo(() => (zone ? countZone(zone) : { tables: 0, seats: 0 }), [zone]);
  const problems = useMemo(() => describePlanProblems(plan), [plan]);
  const clashes = useMemo(() => new Set(duplicateLabels(plan)), [plan]);

  const change = (next: FloorPlan) => {
    setPlan(next);
    setDirty(true);
    setNotice("");
    setError("");
  };

  const editZone = (edit: (zone: FloorZone) => FloorZone) => {
    if (!zone) return;
    change({ ...plan, zones: plan.zones.map((entry) => (entry.id === zone.id ? edit(entry) : entry)) });
  };

  /** Applies an edit to whichever element is selected, table or feature. */
  const editSelected = (edit: <T extends Placed>(element: T) => T) => {
    if (!selection) return;

    editZone((current) =>
      selection.kind === "table"
        ? { ...current, tables: current.tables.map((table) => (table.id === selection.id ? edit(table) : table)) }
        : {
            ...current,
            features: current.features.map((feature) => (feature.id === selection.id ? edit(feature) : feature)),
          },
    );
  };

  /* ---------------------------------------------------------------- *
   * Dragging and resizing
   * ---------------------------------------------------------------- */

  /** Pointer position in plan units, whatever size the SVG is on screen. */
  const toPlanUnits = (event: { clientX: number; clientY: number }) => {
    const svg = svgRef.current;
    if (!svg) return null;

    const rect = svg.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;

    return {
      x: ((event.clientX - rect.left) / rect.width) * PLAN_WIDTH,
      y: ((event.clientY - rect.top) / rect.height) * PLAN_HEIGHT,
    };
  };

  const startDrag = (
    event: React.PointerEvent<SVGElement>,
    element: Placed & { id: string },
    kind: "table" | "feature",
    mode: DragMode,
  ) => {
    setSelection({ kind, id: element.id });
    if (!canEdit) return;

    const point = toPlanUnits(event);
    if (!point) return;

    drag.current =
      mode === "move"
        ? { mode, offsetX: point.x - element.x, offsetY: point.y - element.y }
        : { mode, offsetX: point.x - (element.x + element.width), offsetY: point.y - (element.y + element.height) };

    event.currentTarget.setPointerCapture(event.pointerId);
    event.stopPropagation();
    event.preventDefault();
  };

  const onDrag = (event: React.PointerEvent<SVGElement>, element: Placed) => {
    const active = drag.current;
    if (!active || !canEdit) return;

    const point = toPlanUnits(event);
    if (!point) return;

    if (active.mode === "move") {
      // Snapped and clamped as it moves, so what is on screen is what saves.
      const position = clampPosition({
        x: point.x - active.offsetX,
        y: point.y - active.offsetY,
        width: element.width,
        height: element.height,
      });

      if (position.x !== element.x || position.y !== element.y) {
        editSelected((current) => ({ ...current, ...position }));
      }
      return;
    }

    const size = clampSize(point.x - active.offsetX - element.x, point.y - active.offsetY - element.y);

    if (size.width !== element.width || size.height !== element.height) {
      // Re-clamped, since growing something at the far wall would push it out.
      editSelected((current) => ({
        ...current,
        ...size,
        ...clampPosition({ x: current.x, y: current.y, ...size }),
      }));
    }
  };

  const endDrag = (event: React.PointerEvent<SVGElement>) => {
    drag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const nudge = (event: React.KeyboardEvent, element: Placed) => {
    if (!canEdit) return;

    const step = event.shiftKey ? GRID * 5 : GRID;
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    const move = moves[event.key];
    if (!move) return;

    event.preventDefault();
    editSelected((current) => ({
      ...current,
      ...clampPosition({
        x: element.x + move[0],
        y: element.y + move[1],
        width: element.width,
        height: element.height,
      }),
    }));
  };

  /* ---------------------------------------------------------------- *
   * Adding and removing
   * ---------------------------------------------------------------- */

  const addZone = () => {
    const created = newZone(plan);
    change({ ...plan, zones: [...plan.zones, created] });
    setActiveZoneId(created.id);
    setSelection(null);
  };

  const removeZone = () => {
    if (!zone) return;
    const contents = zone.tables.length + zone.features.length;

    if (contents > 0 && !confirm(`Delete “${zone.name}” and everything in it (${contents} item(s))?`)) {
      return;
    }

    const zones = plan.zones.filter((entry) => entry.id !== zone.id);
    change({ ...plan, zones });
    setActiveZoneId(zones[0]?.id ?? "");
    setSelection(null);
  };

  const addTable = (shape: TableShape) => {
    if (!zone || zone.tables.length >= MAX_TABLES_PER_ZONE) return;

    const created = newTable(zone, shape);
    editZone((current) => ({ ...current, tables: [...current.tables, created] }));
    setSelection({ kind: "table", id: created.id });
  };

  const addFeature = (kind: FeatureKind) => {
    if (!zone || zone.features.length >= MAX_FEATURES_PER_ZONE) return;

    const created = newFeature(zone, kind);
    editZone((current) => ({ ...current, features: [...current.features, created] }));
    setSelection({ kind: "feature", id: created.id });
  };

  const removeSelected = () => {
    if (!selection) return;

    editZone((current) =>
      selection.kind === "table"
        ? { ...current, tables: current.tables.filter((table) => table.id !== selection.id) }
        : { ...current, features: current.features.filter((feature) => feature.id !== selection.id) },
    );
    setSelection(null);
  };

  const duplicateSelected = () => {
    if (!selection || !selected || !zone) return;

    const copy = {
      ...selected,
      id: `f-${Math.random().toString(36).slice(2, 10)}`,
      ...clampPosition({
        x: selected.x + GRID * 2,
        y: selected.y + GRID * 2,
        width: selected.width,
        height: selected.height,
      }),
    };

    if (selection.kind === "table") {
      // A copied table keeps everything but its label: two tables answering to
      // the same number is the one thing a save refuses.
      editZone((current) => ({ ...current, tables: [...current.tables, { ...(copy as FloorTable), label: "" }] }));
    } else {
      editZone((current) => ({ ...current, features: [...current.features, copy as FloorFeature] }));
    }

    setSelection({ kind: selection.kind, id: copy.id });
  };

  const save = async () => {
    if (saving) return;

    setSaving(true);
    setError("");
    setNotice("");

    try {
      const response = await fetch("/api/admin/floor-plan", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(plan),
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(data.error ?? "Unable to save the floor plan.");
      }

      // The stored plan is authoritative — it has been snapped and clamped, and
      // showing anything else would be showing a plan that was not saved.
      setPlan(data.plan as FloorPlan);
      setDirty(false);
      setNotice("Floor plan saved.");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Unable to save the floor plan.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <Card className="p-5 sm:p-6">
        <CardHeader
          as="h1"
          eyebrow="Floor plan"
          title="Design the restaurant"
          actions={
            canEdit ? (
              <div className="flex flex-wrap items-center gap-3">
                {dirty ? <Badge tone="warning">Unsaved changes</Badge> : null}
                <Button onClick={save} disabled={saving || !dirty}>
                  {saving ? "Saving…" : "Save floor plan"}
                </Button>
              </div>
            ) : (
              <Badge>Read only</Badge>
            )
          }
        />

        <p className="mt-3 max-w-2xl text-sm text-ink-muted">
          Lay out each hall as it really stands — tables, the bar, the windows, the door, the stage the musician plays
          from. A table&rsquo;s <strong>label</strong> is the number that appears on the service sheet, so it has to be
          unique across the whole restaurant. Nothing here changes bookings yet.
        </p>

        <dl className="mt-5 grid gap-4 sm:grid-cols-3">
          {[
            { label: "Zones", value: totals.zones },
            { label: "Tables in service", value: totals.tables },
            { label: "Seats in service", value: totals.seats },
          ].map((stat) => (
            <div key={stat.label} className="rounded-control border border-line bg-surface-muted p-4">
              <dt className="text-sm font-medium text-ink-muted">{stat.label}</dt>
              <dd className="mt-1 text-3xl font-semibold tabular-nums text-ink">{stat.value}</dd>
            </div>
          ))}
        </dl>

        <p className="mt-3 text-sm text-ink-subtle">
          Seats count only tables that are in service. An evening&rsquo;s capacity is still set on the calendar and is
          not changed by anything on this page.
        </p>

        {error ? (
          <Alert tone="danger" className="mt-4">
            {error}
          </Alert>
        ) : null}
        {notice ? (
          <Alert tone="success" className="mt-4">
            {notice}
          </Alert>
        ) : null}
        {problems.map((problem) => (
          <Alert key={problem} tone="warning" className="mt-4">
            {problem}
          </Alert>
        ))}
      </Card>

      <Card className="p-5 sm:p-6">
        {/* Zones: halls of the restaurant, a list from the start because a
            terrace is a real thing and making the plan a list later would mean
            rewriting every read of it (§8.6). */}
        <div className="flex flex-wrap items-center gap-2">
          {plan.zones.map((entry) => {
            const counted = countZone(entry);
            const isActive = entry.id === zone?.id;

            return (
              <button
                key={entry.id}
                type="button"
                onClick={() => {
                  setActiveZoneId(entry.id);
                  setSelection(null);
                }}
                className={cx(
                  "min-h-11 rounded-control border px-4 py-2 text-sm font-semibold transition-colors",
                  isActive
                    ? "border-accent bg-accent-soft text-ink"
                    : "border-line-strong bg-surface text-ink-muted hover:border-accent",
                )}
              >
                {entry.name}
                <span className="ml-2 font-normal tabular-nums text-ink-subtle">{counted.seats}</span>
              </button>
            );
          })}

          {canEdit && plan.zones.length < MAX_ZONES ? (
            <Button variant="secondary" onClick={addZone}>
              Add a zone
            </Button>
          ) : null}
        </div>

        {zone ? (
          <>
            {canEdit ? (
              <div className="mt-4 flex flex-col gap-3 rounded-control border border-line bg-surface-muted p-4">
                <div className="flex flex-wrap items-end gap-3">
                  <div className="min-w-52">
                    <Field label="Zone name" hint="The hall as staff call it.">
                      {(fieldProps) => (
                        <Input
                          {...fieldProps}
                          maxLength={60}
                          value={zone.name}
                          onChange={(event) => editZone((current) => ({ ...current, name: event.target.value }))}
                        />
                      )}
                    </Field>
                  </div>
                  <Button variant="secondary" onClick={removeZone}>
                    Delete zone
                  </Button>
                </div>

                <div>
                  <p className="text-sm font-medium text-ink-muted">Tables</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {TABLE_SHAPES.map((shape) => (
                      <Button key={shape} variant="secondary" onClick={() => addTable(shape)}>
                        {SHAPE_LABELS[shape]}
                      </Button>
                    ))}
                  </div>
                </div>

                <div>
                  <p className="text-sm font-medium text-ink-muted">The rest of the room</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {FEATURE_KINDS.map((kind) => (
                      <Button key={kind} variant="secondary" onClick={() => addFeature(kind)}>
                        {FEATURE_LABELS[kind]}
                      </Button>
                    ))}
                  </div>
                </div>
              </div>
            ) : null}

            <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1fr)_21rem]">
              <div className="overflow-x-auto">
                <svg
                  ref={svgRef}
                  viewBox={`0 0 ${PLAN_WIDTH} ${PLAN_HEIGHT}`}
                  className="w-full min-w-[44rem] touch-none rounded-control border border-line bg-surface-muted"
                  role="group"
                  aria-label={`Floor plan of ${zone.name}`}
                  onPointerDown={(event) => {
                    if (event.target === event.currentTarget) setSelection(null);
                  }}
                >
                  <defs>
                    <pattern id="floor-grid" width={GRID * 5} height={GRID * 5} patternUnits="userSpaceOnUse">
                      <path
                        d={`M ${GRID * 5} 0 L 0 0 0 ${GRID * 5}`}
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1"
                        className="text-line"
                      />
                    </pattern>
                  </defs>
                  <rect width={PLAN_WIDTH} height={PLAN_HEIGHT} fill="url(#floor-grid)" />

                  {/* Features first, so a table is never hidden under the bar. */}
                  {zone.features.map((feature) => (
                    <FeatureShape
                      key={feature.id}
                      feature={feature}
                      selected={selection?.kind === "feature" && selection.id === feature.id}
                      canEdit={canEdit}
                      onPointerDown={(event, mode) => startDrag(event, feature, "feature", mode)}
                      onPointerMove={(event) => onDrag(event, feature)}
                      onPointerUp={endDrag}
                      onKeyDown={(event) => nudge(event, feature)}
                    />
                  ))}

                  {zone.tables.map((table) => (
                    <TableShape
                      key={table.id}
                      table={table}
                      selected={selection?.kind === "table" && selection.id === table.id}
                      clashing={clashes.has(table.label.trim().toUpperCase())}
                      canEdit={canEdit}
                      onPointerDown={(event, mode) => startDrag(event, table, "table", mode)}
                      onPointerMove={(event) => onDrag(event, table)}
                      onPointerUp={endDrag}
                      onKeyDown={(event) => nudge(event, table)}
                    />
                  ))}
                </svg>

                <p className="mt-2 text-sm text-ink-subtle">
                  {canEdit
                    ? "Drag to move, drag the corner handle to resize, or select something and use the arrow keys. Everything snaps to the grid."
                    : "Select something to see its details."}{" "}
                  {zone.name}: {zoneTotals.tables} table(s) · {zoneTotals.seats} seat(s) ·{" "}
                  {zone.features.length} feature(s).
                </p>
              </div>

              <ElementProperties
                element={selected}
                kind={selection?.kind ?? null}
                canEdit={canEdit}
                clashing={
                  selection?.kind === "table" && selected
                    ? clashes.has((selected as FloorTable).label.trim().toUpperCase())
                    : false
                }
                onChange={editSelected}
                onRemove={removeSelected}
                onDuplicate={duplicateSelected}
              />
            </div>
          </>
        ) : (
          <div className="mt-5 rounded-control border border-dashed border-line-strong p-8 text-center">
            <p className="text-ink-muted">No zones yet. A zone is a hall of the restaurant — the main hall, the terrace.</p>
            {canEdit ? (
              <Button className="mt-4" onClick={addZone}>
                Draw the first zone
              </Button>
            ) : null}
          </div>
        )}
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Drawing
 * ------------------------------------------------------------------ */

type ShapeHandlers = {
  canEdit: boolean;
  selected: boolean;
  onPointerDown: (event: React.PointerEvent<SVGElement>, mode: DragMode) => void;
  onPointerMove: (event: React.PointerEvent<SVGElement>) => void;
  onPointerUp: (event: React.PointerEvent<SVGElement>) => void;
  onKeyDown: (event: React.KeyboardEvent) => void;
};

/** The corner grip that resizes whatever is selected. */
function ResizeHandle({ element, onPointerDown, onPointerMove, onPointerUp }: { element: Placed } & Omit<ShapeHandlers, "canEdit" | "selected" | "onKeyDown">) {
  return (
    <rect
      x={element.width - 7}
      y={element.height - 7}
      width={14}
      height={14}
      rx={3}
      className="cursor-se-resize fill-surface stroke-accent stroke-2"
      onPointerDown={(event) => onPointerDown(event, "resize")}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    />
  );
}

function TableShape({
  table,
  clashing,
  canEdit,
  selected,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onKeyDown,
}: { table: FloorTable; clashing: boolean } & ShapeHandlers) {
  const outline = selected ? "stroke-accent" : clashing ? "stroke-danger" : "stroke-line-strong";
  const fill = table.active ? "fill-surface" : "fill-surface-sunken";

  return (
    <g
      transform={`translate(${table.x} ${table.y}) rotate(${table.rotation} ${table.width / 2} ${table.height / 2})`}
      className={cx(canEdit ? "cursor-grab" : "cursor-pointer")}
      role="button"
      tabIndex={0}
      aria-label={`Table ${table.label || "unlabelled"}, ${table.seats} seats`}
      onKeyDown={onKeyDown}
    >
      {table.shape === "round" || table.shape === "oval" ? (
        <ellipse
          cx={table.width / 2}
          cy={table.height / 2}
          rx={table.width / 2}
          ry={table.height / 2}
          className={cx("stroke-2", fill, outline)}
          onPointerDown={(event) => onPointerDown(event, "move")}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        />
      ) : (
        <rect
          width={table.width}
          height={table.height}
          rx={table.shape === "square" ? 6 : 8}
          className={cx("stroke-2", fill, outline)}
          onPointerDown={(event) => onPointerDown(event, "move")}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        />
      )}

      <text
        x={table.width / 2}
        y={table.height / 2 - 2}
        textAnchor="middle"
        className={cx("pointer-events-none select-none text-[15px] font-semibold", table.active ? "fill-ink" : "fill-ink-subtle")}
      >
        {table.label || "—"}
      </text>
      <text
        x={table.width / 2}
        y={table.height / 2 + 14}
        textAnchor="middle"
        className="pointer-events-none select-none fill-ink-subtle text-[11px]"
      >
        {table.seats}
      </text>

      {selected && canEdit ? (
        <ResizeHandle
          element={table}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
        />
      ) : null}
    </g>
  );
}

/**
 * A feature, drawn as the thing it is.
 *
 * Each kind reads differently on purpose: a wall is solid, a window is open, a
 * walkway is only an outline because nothing stands in it. Staff should be able
 * to recognise their own restaurant at a glance rather than decode a legend.
 */
function FeatureShape({
  feature,
  canEdit,
  selected,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onKeyDown,
}: { feature: FloorFeature } & ShapeHandlers) {
  const outline = selected ? "stroke-accent" : "stroke-line-strong";

  const body = () => {
    switch (feature.kind) {
      case "wall":
        return <rect width={feature.width} height={feature.height} className={cx("fill-ink-subtle stroke-2", outline)} />;
      case "window":
        return (
          <>
            <rect width={feature.width} height={feature.height} className={cx("fill-surface stroke-2", outline)} />
            <line
              x1={0}
              y1={feature.height / 2}
              x2={feature.width}
              y2={feature.height / 2}
              className={cx("stroke-2", outline)}
            />
          </>
        );
      case "door":
        return (
          <>
            <rect width={feature.width} height={feature.height} className="fill-surface" />
            <path
              d={`M 0 ${feature.height} A ${feature.width} ${feature.width} 0 0 1 ${feature.width} ${feature.height}`}
              className={cx("fill-none stroke-2", outline)}
              strokeDasharray="6 4"
            />
            <line x1={0} y1={feature.height} x2={feature.width} y2={feature.height} className={cx("stroke-2", outline)} />
          </>
        );
      case "path":
        return (
          <rect
            width={feature.width}
            height={feature.height}
            rx={4}
            className={cx("fill-none stroke-2", outline)}
            strokeDasharray="8 6"
          />
        );
      case "plant":
        return (
          <ellipse
            cx={feature.width / 2}
            cy={feature.height / 2}
            rx={feature.width / 2}
            ry={feature.height / 2}
            className={cx("fill-surface-sunken stroke-2", outline)}
          />
        );
      case "text":
        return <rect width={feature.width} height={feature.height} className="fill-none" />;
      default:
        // Stage, bar and screen: solid furniture with a name on it.
        return (
          <rect
            width={feature.width}
            height={feature.height}
            rx={6}
            className={cx("fill-surface-sunken stroke-2", outline)}
          />
        );
    }
  };

  const caption = feature.label || (feature.kind === "text" ? "" : FEATURE_LABELS[feature.kind]);

  return (
    <g
      transform={`translate(${feature.x} ${feature.y}) rotate(${feature.rotation} ${feature.width / 2} ${feature.height / 2})`}
      className={cx(canEdit ? "cursor-grab" : "cursor-pointer")}
      role="button"
      tabIndex={0}
      aria-label={`${FEATURE_LABELS[feature.kind]}${feature.label ? `: ${feature.label}` : ""}`}
      onKeyDown={onKeyDown}
      onPointerDown={(event) => onPointerDown(event, "move")}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      {body()}

      {caption && feature.height >= 30 ? (
        <text
          x={feature.width / 2}
          y={feature.height / 2 + 4}
          textAnchor="middle"
          className="pointer-events-none select-none fill-ink-muted text-[12px] font-medium"
        >
          {caption}
        </text>
      ) : null}

      {selected && canEdit ? (
        <ResizeHandle
          element={feature}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
        />
      ) : null}
    </g>
  );
}

/* ------------------------------------------------------------------ *
 * The properties panel
 * ------------------------------------------------------------------ */

function ElementProperties({
  element,
  kind,
  canEdit,
  clashing,
  onChange,
  onRemove,
  onDuplicate,
}: {
  element: FloorTable | FloorFeature | null;
  kind: "table" | "feature" | null;
  canEdit: boolean;
  clashing: boolean;
  onChange: (edit: <T extends Placed>(element: T) => T) => void;
  onRemove: () => void;
  onDuplicate: () => void;
}) {
  if (!element || !kind) {
    return (
      <div className="rounded-control border border-dashed border-line-strong p-5 text-sm text-ink-subtle">
        Select a table or a feature to change it. Add tables and the rest of the room from the buttons above.
      </div>
    );
  }

  const table = kind === "table" ? (element as FloorTable) : null;
  const feature = kind === "feature" ? (element as FloorFeature) : null;
  const tags = table?.tags ?? [];

  return (
    <div className="flex flex-col gap-4 rounded-control border border-line bg-surface-muted p-5">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-muted">
        {table ? "Selected table" : `Selected ${FEATURE_LABELS[feature!.kind].toLowerCase()}`}
      </h2>

      {table ? (
        <>
          <Field label="Label" hint={clashing ? "Another table already uses this label." : "Appears on the service sheet."}>
            {(fieldProps) => (
              <Input
                {...fieldProps}
                maxLength={12}
                disabled={!canEdit}
                value={table.label}
                onChange={(event) => onChange((current) => ({ ...current, label: event.target.value }))}
              />
            )}
          </Field>

          <Field label="Seats">
            {(fieldProps) => (
              <Input
                {...fieldProps}
                type="number"
                min={0}
                max={MAX_SEATS_PER_TABLE}
                disabled={!canEdit}
                value={table.seats}
                onChange={(event) =>
                  onChange((current) => ({
                    ...current,
                    seats: Math.min(Math.max(Math.round(Number(event.target.value) || 0), 0), MAX_SEATS_PER_TABLE),
                  }))
                }
              />
            )}
          </Field>

          <Field label="Shape">
            {(fieldProps) => (
              <Select
                {...fieldProps}
                disabled={!canEdit}
                value={table.shape}
                onChange={(event) => {
                  const shape = event.target.value as TableShape;
                  // Takes the new shape's default size, since a round table
                  // stretched into an oval is otherwise still a circle.
                  const size = clampSize(DEFAULT_TABLE_SIZE[shape].width, DEFAULT_TABLE_SIZE[shape].height);
                  onChange((current) => ({
                    ...current,
                    shape,
                    ...size,
                    ...clampPosition({ x: current.x, y: current.y, ...size }),
                  }));
                }}
              >
                {TABLE_SHAPES.map((shape) => (
                  <option key={shape} value={shape}>
                    {SHAPE_LABELS[shape]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </>
      ) : (
        <Field label="Name" hint="Drawn on the plan. The stage is worth naming — guests ask about the music.">
          {(fieldProps) => (
            <Input
              {...fieldProps}
              maxLength={40}
              disabled={!canEdit}
              placeholder={FEATURE_LABELS[feature!.kind]}
              value={feature!.label ?? ""}
              onChange={(event) => onChange((current) => ({ ...current, label: event.target.value }))}
            />
          )}
        </Field>
      )}

      {/* Size, typed as well as dragged: a bar is easier to make exactly 300
          wide here than by aiming at a corner handle. */}
      <div className="grid grid-cols-2 gap-3">
        <Field label="Width">
          {(fieldProps) => (
            <Input
              {...fieldProps}
              type="number"
              min={MIN_SIZE}
              max={MAX_SIZE}
              step={GRID}
              disabled={!canEdit}
              value={element.width}
              onChange={(event) =>
                onChange((current) => {
                  const size = clampSize(Number(event.target.value) || MIN_SIZE, current.height);
                  return { ...current, ...size, ...clampPosition({ x: current.x, y: current.y, ...size }) };
                })
              }
            />
          )}
        </Field>
        <Field label="Height">
          {(fieldProps) => (
            <Input
              {...fieldProps}
              type="number"
              min={MIN_SIZE}
              max={MAX_SIZE}
              step={GRID}
              disabled={!canEdit}
              value={element.height}
              onChange={(event) =>
                onChange((current) => {
                  const size = clampSize(current.width, Number(event.target.value) || MIN_SIZE);
                  return { ...current, ...size, ...clampPosition({ x: current.x, y: current.y, ...size }) };
                })
              }
            />
          )}
        </Field>
      </div>

      <Button
        variant="secondary"
        disabled={!canEdit}
        onClick={() => onChange((current) => ({ ...current, rotation: (current.rotation + 90) % 360 }))}
      >
        Rotate a quarter turn ({element.rotation}°)
      </Button>

      {table ? (
        <>
          <label className="flex items-center gap-3 text-sm text-ink">
            <input
              type="checkbox"
              disabled={!canEdit}
              checked={table.active}
              onChange={(event) => onChange((current) => ({ ...current, active: event.target.checked }))}
              className="size-4"
            />
            In service
          </label>
          <p className="-mt-2 text-sm text-ink-subtle">
            A table out of service stays on the plan but is not counted in the seat total.
          </p>

          <div>
            <p className="text-sm font-medium text-ink-muted">Tags</p>
            <p className="mb-2 text-sm text-ink-subtle">What a guest might ask for. Nothing reads these yet.</p>
            <div className="flex flex-wrap gap-2">
              {[...new Set([...SUGGESTED_TAGS, ...tags])].map((tag) => (
                <button
                  key={tag}
                  type="button"
                  disabled={!canEdit}
                  onClick={() =>
                    onChange((current) => {
                      const held = (current as unknown as FloorTable).tags ?? [];
                      return {
                        ...current,
                        tags: held.includes(tag) ? held.filter((entry) => entry !== tag) : [...held, tag],
                      };
                    })
                  }
                  className={cx(
                    "min-h-9 rounded-full border px-3 py-1 text-sm transition-colors disabled:opacity-60",
                    tags.includes(tag)
                      ? "border-accent bg-accent-soft text-ink"
                      : "border-line-strong bg-surface text-ink-muted hover:border-accent",
                  )}
                >
                  {tag}
                </button>
              ))}
            </div>
          </div>
        </>
      ) : null}

      {canEdit ? (
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={onDuplicate}>
            Duplicate
          </Button>
          <Button variant="secondary" onClick={onRemove}>
            Remove
          </Button>
        </div>
      ) : null}
    </div>
  );
}
