"use client";

import { useMemo, useState } from "react";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/feedback";
import { cx } from "@/components/ui/utils";
import { PlanViewport, usePlanDragged } from "@/components/plan-viewport";
import { FEATURE_LABELS, type FloorFeature, type FloorPlan, type FloorTable } from "@/lib/floor-plan";
import type { BoardTable } from "@/lib/service-board";
import { isFinished } from "@/app/admin/service/board-row";

/**
 * The evening drawn on the restaurant itself.
 *
 * ## Why a plan is worth a whole view
 *
 * "Table 12" is a name somebody has to translate into a place. Whoever is
 * running the pass already holds a picture of the room in their head, and every
 * list makes them do that translation on each glance. Drawn, the answer is
 * where it is: the corner by the window is waiting, the long table by the stage
 * has its mains out, and nobody read a number to find out.
 *
 * It is also the view that answers a question no list can. *Which part of the
 * room is behind?* — a thing that is obvious the moment colour is laid over a
 * plan and invisible in table-number order.
 *
 * ## The plan is the drawing; the board is the truth
 *
 * The two are joined on the table's **label** — `docs/floor-plan.md` §3, the
 * same string that becomes a booking's `tableNumber`. So this view can only
 * ever be as good as that matching, and it says so out loud rather than
 * quietly dropping what it cannot place:
 *
 * - A table on the plan with nobody on it is drawn empty. That is a free table,
 *   which is worth seeing.
 * - **A booking whose table is not on the plan is listed underneath**, never
 *   omitted. A board that silently loses a table is worse than no board, and
 *   the honest failure — "these three are not on the plan" — is also the thing
 *   that tells somebody to go and label them.
 *
 * Selecting a table hands it back to the board, which shows the ordinary row
 * beneath the plan. The controls are never redrawn here: a tap has to do the
 * same thing in every view, so there is one place it is written.
 */
export function BoardRoom({
  plan,
  tables,
  selectedKey,
  onSelect,
}: {
  plan: FloorPlan;
  tables: BoardTable[];
  selectedKey: string | null;
  onSelect: (key: string | null) => void;
}) {
  const [zoneId, setZoneId] = useState(plan.zones[0]?.id ?? "");
  /**
   * The table to bring into the frame, set when one is reached by tabbing —
   * and when the board selects one from the list underneath, so "which one is
   * that?" is answered by the plan moving to it rather than by hunting.
   */
  const [revealed, setRevealed] = useState<FloorTable | null>(null);
  const zone = plan.zones.find((entry) => entry.id === zoneId) ?? plan.zones[0] ?? null;

  /**
   * The evening's tables, reachable by the label the plan draws.
   *
   * A booking on tables pushed together carries both labels — "7 + 8" — so it
   * is registered under each of them and lights up both tables on the plan.
   * Splitting on the separator rather than matching the whole string is what
   * stops a merged party being listed as unplaced beneath a room where both its
   * tables are drawn.
   */
  const byLabel = useMemo(() => {
    const map = new Map<string, BoardTable>();

    for (const table of tables) {
      for (const part of table.table.split("+")) {
        const key = part.trim().toUpperCase();

        if (key) {
          map.set(key, table);
        }
      }
    }

    return map;
  }, [tables]);

  /**
   * Bookings the plan cannot place: no table number yet, or one that is not
   * drawn anywhere. Listed rather than lost.
   */
  const unplaced = useMemo(() => {
    const drawn = new Set(
      plan.zones.flatMap((entry) => entry.tables.map((table) => table.label.trim().toUpperCase())).filter(Boolean),
    );

    return tables.filter((table) => {
      const parts = table.table
        .split("+")
        .map((part) => part.trim().toUpperCase())
        .filter(Boolean);

      // A merged booking counts as placed once any of its tables is on the
      // plan: the party is findable, which is what this list is for.
      return parts.length === 0 || !parts.some((part) => drawn.has(part));
    });
  }, [plan, tables]);

  if (!zone) {
    return (
      <div className="rounded-card border border-line bg-surface p-6">
        <EmptyState
          title="The room has not been drawn yet"
          description="This view lays the evening over your floor plan. Draw the room, give each table the same label it has on the service sheet, and the bookings will appear on it."
          action={<ButtonLink href="/admin/floor-plan">Draw the floor plan</ButtonLink>}
        />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {plan.zones.length > 1 ? (
        <div className="flex flex-wrap gap-1.5">
          {plan.zones.map((entry) => (
            <button
              key={entry.id}
              type="button"
              aria-pressed={entry.id === zone.id}
              onClick={() => setZoneId(entry.id)}
              className={cx(
                "min-h-9 rounded-control border px-3 text-sm font-medium transition-colors",
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

      {/*
        Through the shared viewport, and that is a fix rather than a tidy-up.
        This was a `min-w-[36rem]` drawing inside an `overflow-x-auto` wrapper
        with `touch-none` on the SVG — which is exactly the shape of the bug the
        guest's picker had (`docs/floor-plan.md` §18). On a tablet held in
        portrait at the pass, the far half of the room was outside the card and
        no finger could scroll to it: the tables nobody could reach were the
        ones nobody could mark served.
      */}
      <PlanViewport
        zone={zone}
        label={`${zone.name}, tonight`}
        onBackgroundTap={() => onSelect(null)}
        reveal={revealed}
      >
        <rect width={zone.width} height={zone.height} className="fill-surface-muted" rx={8} />

        {/* The room first, so a table is never hidden under the bar. */}
        {zone.features.map((feature) => (
          <RoomFeature key={feature.id} feature={feature} />
        ))}

        {zone.tables.map((table) => (
          <RoomTable
            key={table.id}
            table={table}
            booking={byLabel.get(table.label.trim().toUpperCase()) ?? null}
            selected={Boolean(selectedKey) && byLabel.get(table.label.trim().toUpperCase())?.key === selectedKey}
            onSelect={onSelect}
            onFocus={() => setRevealed(table)}
          />
        ))}
      </PlanViewport>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-ink-muted">
        <Key className="border-line-strong bg-surface" label="Free" />
        <Key className="border-line-strong bg-surface-sunken" label="Booked, waiting" />
        <Key className="border-gold bg-accent-soft" label="Seated" />
        <Key className="border-success/50 bg-success-soft" label="All served" />
        <Key className="border-line bg-surface opacity-50" label="No-show" />
      </div>

      {/*
        Never dropped. A board that quietly loses a table is worse than no
        board, and saying which ones are unplaced is also what tells somebody
        to go and label them.
      */}
      {unplaced.length > 0 ? (
        <div className="rounded-control border border-line-strong bg-surface-muted p-3">
          <p className="text-sm font-medium text-ink">
            {unplaced.length} {unplaced.length === 1 ? "table is" : "tables are"} not on the plan
          </p>
          <p className="mt-0.5 text-xs text-ink-subtle">
            Either no table number has been assigned, or the number is not drawn in any zone. They are still on the
            list and the sheet.
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {unplaced.map((table) => (
              <button
                key={table.key}
                type="button"
                onClick={() => onSelect(table.key)}
                className={cx(
                  "min-h-9 rounded-control border px-2.5 text-sm font-medium transition-colors",
                  table.key === selectedKey
                    ? "border-accent bg-accent-soft text-accent-ink"
                    : "border-line-strong bg-surface text-ink-muted hover:border-accent",
                )}
              >
                {table.table ? `Table ${table.table}` : table.rooms.join(" + ")}
                <span className="ml-1.5 text-xs font-normal opacity-70">{table.guests}p</span>
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
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

/**
 * The room around the tables — walls, the bar, the stage.
 *
 * Drawn flat and quiet. This view exists so somebody can find a table by where
 * it is, and the landmarks are what make that possible; they are scenery, so
 * nothing here is interactive and nothing competes with a table for attention.
 */
function RoomFeature({ feature }: { feature: FloorFeature }) {
  const label = feature.label || FEATURE_LABELS[feature.kind];

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
          feature.kind === "window"
            ? "fill-accent-soft stroke-gold/50"
            : feature.kind === "path"
              ? "fill-transparent stroke-line"
              : "fill-surface-sunken stroke-line",
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
          {label}
        </text>
      ) : null}
    </g>
  );
}

/**
 * One table, coloured by where it has got to.
 *
 * The three things a pass asks of a table are on it: which table, who is on it,
 * and how many. Rooms are what staff actually call a party — "402 is waiting",
 * not "the Andersons" — so the room numbers get the readable line, and the
 * count sits beside the label where it does not compete with them.
 *
 * The whole shape is the target rather than a button inside it. It is tapped
 * while walking, and a 70cm-wide table drawn to scale is already about as small
 * as a target should be.
 */
function RoomTable({
  table,
  booking,
  selected,
  onSelect,
  onFocus,
}: {
  table: FloorTable;
  booking: BoardTable | null;
  selected: boolean;
  onSelect: (key: string) => void;
  onFocus: () => void;
}) {
  const dragged = usePlanDragged();
  const state = !booking
    ? "free"
    : booking.attendance === "no-show"
      ? "no-show"
      : isFinished(booking)
        ? "served"
        : booking.attendance === "seated"
          ? "seated"
          : "waiting";

  const fill = {
    free: "fill-surface stroke-line-strong",
    waiting: "fill-surface-sunken stroke-line-strong",
    seated: "fill-accent-soft stroke-gold",
    served: "fill-success-soft stroke-success/50",
    "no-show": "fill-surface stroke-line opacity-50",
  }[state];

  const rooms = booking?.rooms.join(" + ") ?? "";
  const middle = { x: table.width / 2, y: table.height / 2 };

  return (
    <g
      transform={`translate(${table.x} ${table.y}) rotate(${table.rotation} ${middle.x} ${middle.y})`}
      className={booking ? "cursor-pointer" : "cursor-default"}
      role={booking ? "button" : undefined}
      tabIndex={booking ? 0 : undefined}
      aria-label={
        booking
          ? `Table ${table.label}, ${rooms}, ${booking.guests} guests, ${state}`
          : `Table ${table.label}, free`
      }
      onFocus={onFocus}
      // Sliding the room past a table must not select it.
      onClick={() => booking && !dragged() && onSelect(booking.key)}
      onKeyDown={(event) => {
        if (booking && (event.key === "Enter" || event.key === " ")) {
          event.preventDefault();
          event.stopPropagation();
          onSelect(booking.key);
        }
      }}
    >
      {table.shape === "round" || table.shape === "oval" ? (
        <ellipse
          cx={middle.x}
          cy={middle.y}
          rx={table.width / 2}
          ry={table.height / 2}
          className={cx("stroke-2", fill)}
        />
      ) : (
        <rect width={table.width} height={table.height} rx={8} className={cx("stroke-2", fill)} />
      )}

      {/* The selection ring is drawn outside the shape rather than as a
          thicker border, so selecting a table does not change its size. */}
      {selected ? (
        <rect
          x={-8}
          y={-8}
          width={table.width + 16}
          height={table.height + 16}
          rx={12}
          className="fill-none stroke-accent"
          strokeWidth={3}
          strokeDasharray="8 6"
        />
      ) : null}

      <text
        x={middle.x}
        y={booking ? middle.y - 6 : middle.y + 6}
        textAnchor="middle"
        className="pointer-events-none select-none fill-ink text-[17px] font-semibold"
      >
        {table.label || "—"}
        {booking ? <tspan className="fill-ink-muted text-[13px] font-normal"> · {booking.guests}p</tspan> : null}
      </text>

      {booking ? (
        <text
          x={middle.x}
          y={middle.y + 12}
          textAnchor="middle"
          className="pointer-events-none select-none fill-ink-muted text-[13px]"
        >
          {rooms.length > 14 ? `${rooms.slice(0, 13)}…` : rooms}
        </text>
      ) : null}

      {/* An allergy or a request is the one thing that must not need a tap. */}
      {booking && booking.notes.length > 0 ? (
        <circle cx={table.width - 6} cy={6} r={7} className="fill-danger" />
      ) : null}
    </g>
  );
}
