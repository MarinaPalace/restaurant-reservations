"use client";

import { useMemo, useRef, useState } from "react";
import { Card, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert, Badge } from "@/components/ui/feedback";
import { Field, Input, Select } from "@/components/ui/field";
import { cx } from "@/components/ui/utils";
import {
  GRID,
  MAX_ROOMS,
  MAX_SEATS_PER_TABLE,
  MAX_TABLES_PER_ROOM,
  PLAN_HEIGHT,
  PLAN_WIDTH,
  TABLE_SHAPES,
  TABLE_SIZE,
  clampToPlan,
  countPlan,
  countRoom,
  describePlanProblems,
  duplicateLabels,
  newRoom,
  newTable,
  type FloorPlan,
  type FloorTable,
  type TableShape,
} from "@/lib/floor-plan";

/**
 * The restaurant designer — `docs/floor-plan.md` §5.
 *
 * Staff lay out the room here and nothing else happens yet: no booking reads
 * the plan, no seat accounting changes, and the flag that will one day let
 * guests pick a table does not exist. That is deliberate (§9 step 1). A drawn
 * room is useful before it is wired to anything, and it proves the model
 * without touching the most delicate code in the app.
 *
 * Two rules from HANDOVER shape what is below. Nothing moves under a finger
 * (2.14): dragging a table moves that table and re-lays out nothing else, and
 * the plan does not reflow while it is being edited. And the label is not
 * decoration (§3) — it becomes a booking's `tableNumber`, which is why a
 * duplicate is refused rather than merely noted.
 *
 * This screen is not printed and does not pretend to be, so none of the sheet's
 * print CSS applies to it (rules 2.8–2.10).
 */

const SHAPE_LABELS: Record<TableShape, string> = {
  round: "Round",
  square: "Square",
  rectangle: "Rectangle",
};

/** Suggested tags, so a room does not end up with six spellings of "window". */
const SUGGESTED_TAGS = ["window", "quiet", "corner", "near the door", "terrace", "step-free"];

export function FloorPlanDesigner({ initialPlan, canEdit }: { initialPlan: FloorPlan; canEdit: boolean }) {
  const [plan, setPlan] = useState(initialPlan);
  const [activeRoomId, setActiveRoomId] = useState(initialPlan.rooms[0]?.id ?? "");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  /**
   * Whether anything has changed since the last save. Tracked rather than
   * compared, because a deep comparison of the plan on every drag frame is
   * both slow and beside the point.
   */
  const [dirty, setDirty] = useState(false);

  const svgRef = useRef<SVGSVGElement | null>(null);
  /** Where in the table the pointer went down, so it does not jump on grab. */
  const grabOffset = useRef<{ x: number; y: number } | null>(null);

  const room = plan.rooms.find((entry) => entry.id === activeRoomId) ?? plan.rooms[0] ?? null;
  const selected = room?.tables.find((table) => table.id === selectedId) ?? null;

  const totals = useMemo(() => countPlan(plan), [plan]);
  const roomTotals = useMemo(() => (room ? countRoom(room) : { tables: 0, seats: 0 }), [room]);
  const problems = useMemo(() => describePlanProblems(plan), [plan]);
  const clashes = useMemo(() => new Set(duplicateLabels(plan)), [plan]);

  const change = (next: FloorPlan) => {
    setPlan(next);
    setDirty(true);
    setNotice("");
    setError("");
  };

  const editRoom = (roomId: string, edit: (tables: FloorTable[]) => FloorTable[]) => {
    change({
      ...plan,
      rooms: plan.rooms.map((entry) => (entry.id === roomId ? { ...entry, tables: edit(entry.tables) } : entry)),
    });
  };

  const editTable = (tableId: string, edit: (table: FloorTable) => FloorTable) => {
    if (!room) return;
    editRoom(room.id, (tables) => tables.map((table) => (table.id === tableId ? edit(table) : table)));
  };

  /* ---------------------------------------------------------------- *
   * Dragging
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

  const startDrag = (event: React.PointerEvent<SVGGElement>, table: FloorTable) => {
    setSelectedId(table.id);
    if (!canEdit) return;

    const point = toPlanUnits(event);
    if (!point) return;

    grabOffset.current = { x: point.x - table.x, y: point.y - table.y };
    // Keeps the pointer bound to this table even when it outruns the shape.
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
  };

  const onDrag = (event: React.PointerEvent<SVGGElement>, table: FloorTable) => {
    const offset = grabOffset.current;
    if (!offset || !canEdit) return;

    const point = toPlanUnits(event);
    if (!point) return;

    // Snapped and clamped here rather than on drop, so what is on screen while
    // dragging is exactly what will be saved.
    const position = clampToPlan({ x: point.x - offset.x, y: point.y - offset.y, shape: table.shape });

    if (position.x !== table.x || position.y !== table.y) {
      editTable(table.id, (current) => ({ ...current, ...position }));
    }
  };

  const endDrag = (event: React.PointerEvent<SVGGElement>) => {
    grabOffset.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  /* ---------------------------------------------------------------- *
   * Rooms and tables
   * ---------------------------------------------------------------- */

  const addRoom = () => {
    const created = newRoom(plan);
    change({ ...plan, rooms: [...plan.rooms, created] });
    setActiveRoomId(created.id);
    setSelectedId(null);
  };

  const removeRoom = () => {
    if (!room) return;

    if (room.tables.length > 0 && !confirm(`Delete “${room.name}” and its ${room.tables.length} table(s)?`)) {
      return;
    }

    const rooms = plan.rooms.filter((entry) => entry.id !== room.id);
    change({ ...plan, rooms });
    setActiveRoomId(rooms[0]?.id ?? "");
    setSelectedId(null);
  };

  const addTable = (shape: TableShape) => {
    if (!room || room.tables.length >= MAX_TABLES_PER_ROOM) return;

    const created = newTable(room, shape);
    editRoom(room.id, (tables) => [...tables, created]);
    setSelectedId(created.id);
  };

  const removeTable = (tableId: string) => {
    if (!room) return;
    editRoom(room.id, (tables) => tables.filter((table) => table.id !== tableId));
    setSelectedId(null);
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

      // The stored plan is authoritative: it has been snapped and clamped, and
      // showing anything else would be showing a plan that is not the one saved.
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
          title="Design the room"
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
          Lay out the tables as they stand in the room. Nothing here changes bookings yet — a table&rsquo;s{" "}
          <strong>label</strong> is the number that will appear on the service sheet, so it has to be unique across
          every room.
        </p>

        <dl className="mt-5 grid gap-4 sm:grid-cols-3">
          {[
            { label: "Rooms", value: totals.rooms },
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
          Seats are counted from tables that are in service. An evening&rsquo;s capacity is still set on the calendar
          and is not changed by anything on this page.
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
        {/* Rooms. A list from the start, because a terrace or a private room is
            a real thing and making the plan a list later would mean rewriting
            every read of it (§8.6). */}
        <div className="flex flex-wrap items-center gap-2">
          {plan.rooms.map((entry) => {
            const counted = countRoom(entry);
            const isActive = entry.id === room?.id;

            return (
              <button
                key={entry.id}
                type="button"
                onClick={() => {
                  setActiveRoomId(entry.id);
                  setSelectedId(null);
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

          {canEdit && plan.rooms.length < MAX_ROOMS ? (
            <Button variant="secondary" onClick={addRoom}>
              Add a room
            </Button>
          ) : null}
        </div>

        {room ? (
          <>
            {canEdit ? (
              <div className="mt-4 flex flex-wrap items-end gap-3">
                <div className="min-w-52">
                  <Field label="Room name">
                    {(fieldProps) => (
                      <Input
                        {...fieldProps}
                        maxLength={60}
                        value={room.name}
                        onChange={(event) =>
                          change({
                            ...plan,
                            rooms: plan.rooms.map((entry) =>
                              entry.id === room.id ? { ...entry, name: event.target.value } : entry,
                            ),
                          })
                        }
                      />
                    )}
                  </Field>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {TABLE_SHAPES.map((shape) => (
                    <Button key={shape} variant="secondary" onClick={() => addTable(shape)}>
                      Add {SHAPE_LABELS[shape].toLowerCase()}
                    </Button>
                  ))}
                  <Button variant="secondary" onClick={removeRoom}>
                    Delete room
                  </Button>
                </div>
              </div>
            ) : null}

            <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
              <div className="overflow-x-auto">
                <svg
                  ref={svgRef}
                  viewBox={`0 0 ${PLAN_WIDTH} ${PLAN_HEIGHT}`}
                  className="w-full min-w-[36rem] touch-none rounded-control border border-line bg-surface-muted"
                  role="group"
                  aria-label={`Floor plan of ${room.name}`}
                  onPointerDown={(event) => {
                    // A tap on the empty floor is how you deselect.
                    if (event.target === event.currentTarget) setSelectedId(null);
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

                  {room.tables.map((table) => {
                    const size = TABLE_SIZE[table.shape];
                    const isSelected = table.id === selectedId;
                    const clashing = clashes.has(table.label.trim().toUpperCase());

                    return (
                      <g
                        key={table.id}
                        transform={`translate(${table.x} ${table.y}) rotate(${table.rotation ?? 0} ${size.width / 2} ${size.height / 2})`}
                        onPointerDown={(event) => startDrag(event, table)}
                        onPointerMove={(event) => onDrag(event, table)}
                        onPointerUp={endDrag}
                        onPointerCancel={endDrag}
                        className={cx(canEdit ? "cursor-grab" : "cursor-pointer")}
                        role="button"
                        tabIndex={0}
                        aria-label={`Table ${table.label || "unlabelled"}, ${table.seats} seats`}
                        onKeyDown={(event) => {
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
                          editTable(table.id, (current) => ({
                            ...current,
                            ...clampToPlan({ x: current.x + move[0], y: current.y + move[1], shape: current.shape }),
                          }));
                        }}
                      >
                        {table.shape === "round" ? (
                          <circle
                            cx={size.width / 2}
                            cy={size.height / 2}
                            r={size.width / 2}
                            className={cx(
                              "stroke-2",
                              table.active ? "fill-surface" : "fill-surface-sunken",
                              isSelected ? "stroke-accent" : clashing ? "stroke-danger" : "stroke-line-strong",
                            )}
                          />
                        ) : (
                          <rect
                            width={size.width}
                            height={size.height}
                            rx={6}
                            className={cx(
                              "stroke-2",
                              table.active ? "fill-surface" : "fill-surface-sunken",
                              isSelected ? "stroke-accent" : clashing ? "stroke-danger" : "stroke-line-strong",
                            )}
                          />
                        )}

                        <text
                          x={size.width / 2}
                          y={size.height / 2 - 2}
                          textAnchor="middle"
                          className={cx(
                            "select-none text-[15px] font-semibold",
                            table.active ? "fill-ink" : "fill-ink-subtle",
                          )}
                        >
                          {table.label || "—"}
                        </text>
                        <text
                          x={size.width / 2}
                          y={size.height / 2 + 14}
                          textAnchor="middle"
                          className="select-none fill-ink-subtle text-[11px]"
                        >
                          {table.seats}
                        </text>
                      </g>
                    );
                  })}
                </svg>

                <p className="mt-2 text-sm text-ink-subtle">
                  {canEdit
                    ? "Drag a table to move it, or select one and use the arrow keys. Positions snap to the grid."
                    : "Select a table to see its details."}
                  {" "}
                  {room.name}: {roomTotals.tables} table(s) · {roomTotals.seats} seat(s).
                </p>
              </div>

              <TableProperties
                table={selected}
                canEdit={canEdit}
                clashing={selected ? clashes.has(selected.label.trim().toUpperCase()) : false}
                onChange={(edit) => selected && editTable(selected.id, edit)}
                onRemove={() => selected && removeTable(selected.id)}
              />
            </div>
          </>
        ) : (
          <div className="mt-5 rounded-control border border-dashed border-line-strong p-8 text-center">
            <p className="text-ink-muted">No rooms yet.</p>
            {canEdit ? (
              <Button className="mt-4" onClick={addRoom}>
                Draw the first room
              </Button>
            ) : null}
          </div>
        )}
      </Card>
    </div>
  );
}

/** The selected table's details. Separate so the plan does not re-render per keystroke. */
function TableProperties({
  table,
  canEdit,
  clashing,
  onChange,
  onRemove,
}: {
  table: FloorTable | null;
  canEdit: boolean;
  clashing: boolean;
  onChange: (edit: (table: FloorTable) => FloorTable) => void;
  onRemove: () => void;
}) {
  if (!table) {
    return (
      <div className="rounded-control border border-dashed border-line-strong p-5 text-sm text-ink-subtle">
        Select a table to change its label, seats or shape.
      </div>
    );
  }

  const tags = table.tags ?? [];

  const toggleTag = (tag: string) => {
    onChange((current) => {
      const held = current.tags ?? [];
      return {
        ...current,
        tags: held.includes(tag) ? held.filter((entry) => entry !== tag) : [...held, tag],
      };
    });
  };

  return (
    <div className="flex flex-col gap-4 rounded-control border border-line bg-surface-muted p-5">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-muted">Selected table</h2>

      <Field
        label="Label"
        hint={clashing ? "Another table already uses this label." : "Appears on the service sheet."}
      >
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
              // Re-clamped: a rectangle is wider, so a round table flush to the
              // right wall would otherwise end up outside the room.
              onChange((current) => ({
                ...current,
                shape,
                ...clampToPlan({ x: current.x, y: current.y, shape }),
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

      {table.shape === "rectangle" ? (
        <Button
          variant="secondary"
          disabled={!canEdit}
          onClick={() => onChange((current) => ({ ...current, rotation: ((current.rotation ?? 0) + 90) % 360 }))}
        >
          Rotate a quarter turn ({table.rotation ?? 0}°)
        </Button>
      ) : null}

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
        <p className="mb-2 text-sm text-ink-subtle">
          What a guest might ask for. Nothing reads these yet.
        </p>
        <div className="flex flex-wrap gap-2">
          {[...new Set([...SUGGESTED_TAGS, ...tags])].map((tag) => (
            <button
              key={tag}
              type="button"
              disabled={!canEdit}
              onClick={() => toggleTag(tag)}
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

      {canEdit ? (
        <Button variant="secondary" onClick={onRemove}>
          Remove this table
        </Button>
      ) : null}
    </div>
  );
}
