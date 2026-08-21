"use client";

import { useId, useState } from "react";
import { cx } from "@/components/ui/utils";

/**
 * The charts, as inline SVG.
 *
 * ## Why no charting library
 *
 * Three reasons specific to this app, not a general preference:
 *
 * - **Theming.** The marks wear `var(--accent)` and friends, so light and dark
 *   are handled by the tokens already in `globals.css`. No library does that
 *   without being configured twice and drifting.
 * - **Print.** Rules 2.8–2.10 are unforgiving and nothing in the suite checks
 *   them. An SVG in normal flow prints; a canvas usually does not.
 * - **No DOM measuring.** Everything here scales with `viewBox` and
 *   `preserveAspectRatio`, so no `useEffect` reads a width — which rule 2.15
 *   makes awkward anyway.
 *
 * ## Colour: computed, not chosen
 *
 * The app's accent gold and success green were run through the palette
 * validator as a two-series categorical pair and **failed** — ΔE 3.1 under
 * protanopia, 13.1 even with full colour vision. They are the same colour to a
 * great many people.
 *
 * So there is **no categorical palette here at all**. Every chart is a single
 * hue carrying magnitude, which is the safe default and the honest encoding for
 * "how many": bar length already says the value, and spending the identity
 * channel to re-say it is what makes dashboards unreadable. The one ordered
 * ramp — the funnel — is three validated steps of the accent hue
 * (`#cba775 → #a87c45 → #6f4f22` light, `#f0d9b3 → #d9b47d → #a8834a` dark),
 * which pass the ordinal checks in both modes: monotone lightness, ΔL ≥ 0.06
 * between steps, and the light end clear of the surface.
 *
 * Status colours (success / danger) are reserved for state and always ship with
 * a word beside them, never colour alone.
 */

/* ------------------------------------------------------------------ *
 * Shared bits
 * ------------------------------------------------------------------ */

/**
 * Rounds an axis up to something a person would say.
 *
 * The ladder is deliberately finer than 1 / 2 / 5 / 10. That coarse version
 * rounded a peak of 60 up to 100, which left every bar sitting in the bottom
 * third of the chart and made a busy month look empty — the axis was lying by
 * proportion even though every number on it was true.
 */
function niceCeiling(value: number): number {
  if (value <= 0) return 1;

  const magnitude = 10 ** Math.floor(Math.log10(value));
  const normalised = value / magnitude;

  for (const step of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) {
    if (normalised <= step) {
      return step * magnitude;
    }
  }

  return 10 * magnitude;
}

function formatCompact(value: number): string {
  return value >= 10_000 ? `${Math.round(value / 100) / 10}K` : value.toLocaleString("en-GB");
}

/** A tooltip that follows the hovered mark. Positioned in percentages, so no measuring. */
function Tooltip({ x, children }: { x: number; children: React.ReactNode }) {
  return (
    <div
      className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded-control border border-line bg-surface px-2.5 py-1.5 text-xs shadow-lg"
      style={{ left: `${x}%`, top: "-2px" }}
      role="presentation"
    >
      {children}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Columns over time
 * ------------------------------------------------------------------ */

export type ColumnPoint = { key: string; label: string; value: number; reference?: number };

/**
 * Covers per day, week or month, with capacity as a hairline behind them.
 *
 * The reference line is **the same axis and the same unit** — both are seats.
 * A second y-scale is the single most common charting mistake and is never
 * correct; two measures that cannot share an axis get two charts.
 */
export function ColumnChart({
  points,
  label,
  referenceLabel,
  valueSuffix = "",
}: {
  points: ColumnPoint[];
  /** Names what is plotted, so a single series needs no legend box. */
  label: string;
  referenceLabel?: string;
  valueSuffix?: string;
}) {
  const [hovered, setHovered] = useState<number | null>(null);
  const titleId = useId();

  const peak = Math.max(...points.map((p) => Math.max(p.value, p.reference ?? 0)), 0);
  const top = niceCeiling(peak);
  const ticks = [0, top / 2, top];

  // A viewBox in abstract units; the SVG stretches to whatever width it gets.
  const width = 100;
  const height = 42;
  const slot = points.length > 0 ? width / points.length : width;
  // Capped at 24px-equivalent and never filling the slot: the leftover is air.
  const barWidth = Math.min(slot * 0.62, 4.2);

  if (points.length === 0) {
    return <p className="py-8 text-center text-sm text-ink-muted">Nothing in this period.</p>;
  }

  return (
    <figure className="relative m-0">
      {hovered !== null ? (
        <Tooltip x={((hovered + 0.5) / points.length) * 100}>
          <span className="block font-semibold text-ink">{points[hovered].label}</span>
          <span className="block text-ink-muted">
            {formatCompact(points[hovered].value)}
            {valueSuffix} {label.toLowerCase()}
          </span>
          {points[hovered].reference !== undefined && referenceLabel ? (
            <span className="block text-ink-subtle">
              {formatCompact(points[hovered].reference!)} {referenceLabel.toLowerCase()}
            </span>
          ) : null}
        </Tooltip>
      ) : null}

      <div className="flex gap-2">
        {/* Ticks carry the values that are not directly labelled. */}
        <div
          className="flex w-10 shrink-0 flex-col justify-between py-0.5 text-right text-[10px] tabular-nums text-ink-subtle"
          aria-hidden="true"
        >
          {[...ticks].reverse().map((tick) => (
            <span key={tick}>{formatCompact(Math.round(tick))}</span>
          ))}
        </div>

        <svg
          viewBox={`0 0 ${width} ${height}`}
          preserveAspectRatio="none"
          role="img"
          aria-labelledby={titleId}
          className="h-44 w-full sm:h-56"
        >
          <title id={titleId}>
            {label} per period. Highest {formatCompact(peak)}
            {valueSuffix}.
          </title>

          {/* Hairline gridlines, one step off the surface and never dashed. */}
          {ticks.map((tick) => (
            <line
              key={tick}
              x1={0}
              x2={width}
              y1={height - (tick / top) * height}
              y2={height - (tick / top) * height}
              stroke="var(--line)"
              strokeWidth={0.25}
              vectorEffect="non-scaling-stroke"
            />
          ))}

          {points.map((point, index) => {
            const barHeight = top > 0 ? (point.value / top) * height : 0;
            const x = index * slot + (slot - barWidth) / 2;
            const isHovered = hovered === index;

            return (
              <g key={point.key}>
                {/* The hit target is the whole slot, so a 1-cover night is
                    still easy to hover. */}
                <rect
                  x={index * slot}
                  y={0}
                  width={slot}
                  height={height}
                  fill="transparent"
                  onMouseEnter={() => setHovered(index)}
                  onMouseLeave={() => setHovered(null)}
                />
                {/*
                  Capacity as a *track* the bar fills, not a floating rule.
                  Drawn first, so the covers bar sits inside it.

                  The first version drew a short line at capacity height. It was
                  the right number on the right axis, but across a month it read
                  as a second, broken series hovering above the bars rather than
                  as the ceiling they were filling. A track says "this much was
                  offered, this much was taken" in one shape — and it is the
                  same fill-against-lighter-step-of-the-same-ramp idiom the
                  meters on this page already use.
                */}
                {point.reference !== undefined && point.reference > 0 ? (
                  <rect
                    x={x}
                    y={height - (point.reference / top) * height}
                    width={barWidth}
                    height={(point.reference / top) * height}
                    rx={0.9}
                    fill="var(--accent-soft)"
                    pointerEvents="none"
                  />
                ) : null}
                {point.value > 0 ? (
                  <rect
                    x={x}
                    y={height - barHeight}
                    width={barWidth}
                    height={barHeight}
                    rx={0.9}
                    fill="var(--accent)"
                    opacity={hovered === null || isHovered ? 1 : 0.45}
                    className="transition-opacity"
                    pointerEvents="none"
                  />
                ) : null}
              </g>
            );
          })}
        </svg>
      </div>

      {/* Every label would collide on a long range, so they thin out. */}
      <div className="ml-12 mt-1 flex text-[10px] text-ink-subtle" aria-hidden="true">
        {points.map((point, index) => {
          const every = Math.ceil(points.length / 8);
          return (
            // `whitespace-nowrap`, not `truncate`: only one slot in `every`
            // carries text, so a label is free to overflow into its empty
            // neighbours. Truncating clipped "25 Aug" to "25 A…" for no reason.
            <span key={point.key} className="min-w-0 flex-1 whitespace-nowrap text-center">
              {index % every === 0 ? point.label : ""}
            </span>
          );
        })}
      </div>

      {referenceLabel ? (
        <figcaption className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-muted">
          <span className="flex items-center gap-2">
            <span aria-hidden="true" className="inline-block size-2.5 rounded-sm bg-accent" />
            {label}
          </span>
          <span className="flex items-center gap-2">
            <span
              aria-hidden="true"
              className="inline-block size-2.5 rounded-sm border border-line"
              style={{ background: "var(--accent-soft)" }}
            />
            {referenceLabel}
          </span>
        </figcaption>
      ) : null}
    </figure>
  );
}

/* ------------------------------------------------------------------ *
 * Horizontal bars
 * ------------------------------------------------------------------ */

export type BarRow = { id: string; label: string; sublabel?: string; value: number; display?: string };

/**
 * A ranked list — dishes, promotions, party sizes.
 *
 * Horizontal because the labels are long words, and every bar wears the **same**
 * hue: these are nominal categories, so colouring them by value would spend the
 * identity channel re-encoding what the length already says.
 */
export function BarList({
  rows,
  emphasiseId,
  valueLabel,
}: {
  rows: BarRow[];
  /** One row the story is about, if any. The rest recede — emphasis, not categorical. */
  emphasiseId?: string;
  valueLabel: string;
}) {
  const peak = Math.max(...rows.map((row) => row.value), 0);

  if (rows.length === 0) {
    return <p className="py-6 text-center text-sm text-ink-muted">Nothing in this period.</p>;
  }

  return (
    <ul className="space-y-2.5">
      {rows.map((row) => {
        const share = peak > 0 ? (row.value / peak) * 100 : 0;
        const dimmed = emphasiseId !== undefined && row.id !== emphasiseId;

        return (
          <li key={row.id} className="group">
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="min-w-0 truncate font-medium text-ink" title={row.label}>
                {row.label}
                {row.sublabel ? <span className="ml-2 text-xs text-ink-subtle">{row.sublabel}</span> : null}
              </span>
              {/* The value rides the row as text in an ink token — never in the
                  mark's colour, which is illegible as type. */}
              <span className="shrink-0 tabular-nums font-semibold text-ink">
                {row.display ?? row.value.toLocaleString("en-GB")}
              </span>
            </div>
            <div
              className="mt-1 h-2 w-full overflow-hidden rounded-full bg-surface-sunken"
              role="img"
              aria-label={`${row.label}: ${row.display ?? row.value} ${valueLabel}`}
            >
              <div
                className={cx("h-full rounded-full transition-[width] duration-500", dimmed ? "opacity-40" : "")}
                style={{ width: `${Math.max(share, row.value > 0 ? 3 : 0)}%`, background: "var(--accent)" }}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/* ------------------------------------------------------------------ *
 * Funnel
 * ------------------------------------------------------------------ */

/**
 * The pass-key funnel: an **ordinal** ramp, not categorical.
 *
 * Swapping the stages would change the meaning, which is the test for ordinal —
 * so the colour carries the order. Three validated steps of the accent hue,
 * checked in both modes for monotone lightness, ΔL ≥ 0.06, and a light end that
 * clears the surface.
 */
const FUNNEL_STEPS = ["var(--chart-step-1)", "var(--chart-step-2)", "var(--chart-step-3)"];

export function Funnel({ stages }: { stages: { label: string; value: number; hint: string }[] }) {
  const top = Math.max(...stages.map((stage) => stage.value), 0);

  return (
    <ol className="space-y-3">
      {stages.map((stage, index) => {
        const share = top > 0 ? (stage.value / top) * 100 : 0;
        const previous = index > 0 ? stages[index - 1].value : null;
        const conversion = previous && previous > 0 ? Math.round((stage.value / previous) * 100) : null;

        return (
          <li key={stage.label}>
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-sm font-medium text-ink">{stage.label}</span>
              <span className="flex items-baseline gap-2">
                {conversion !== null ? (
                  <span className="text-xs tabular-nums text-ink-subtle">{conversion}% of previous</span>
                ) : null}
                <span className="text-lg font-semibold tabular-nums text-ink">{stage.value}</span>
              </span>
            </div>
            <div className="mt-1 h-3 w-full overflow-hidden rounded-full bg-surface-sunken">
              <div
                className="h-full rounded-full transition-[width] duration-500"
                style={{
                  width: `${Math.max(share, stage.value > 0 ? 4 : 0)}%`,
                  background: FUNNEL_STEPS[Math.min(index, FUNNEL_STEPS.length - 1)],
                }}
              />
            </div>
            <p className="mt-0.5 text-xs text-ink-subtle">{stage.hint}</p>
          </li>
        );
      })}
    </ol>
  );
}

/* ------------------------------------------------------------------ *
 * Figures
 * ------------------------------------------------------------------ */

/**
 * A stat tile: label, value, and the same number last period.
 *
 * The comparison is the point — a figure with nothing beside it is decoration.
 * `betterWhen` says which direction is good, because a *falling* cancellation
 * rate is the same arrow as *rising* covers and must not wear the same colour.
 */
export function StatTile({
  label,
  value,
  previous,
  suffix = "",
  betterWhen = "up",
  hint,
  hero = false,
  /**
   * How to render the number. Money needs its currency *on the figure* — a
   * revenue tile reading "298" states an amount without saying of what, and
   * putting the unit only in the hint below leaves the headline wrong.
   */
  format = formatCompact,
}: {
  label: string;
  value: number | null;
  previous?: number | null;
  suffix?: string;
  betterWhen?: "up" | "down" | "neutral";
  hint?: string;
  /** The one number the page leads with. Exactly one per view. */
  hero?: boolean;
  format?: (value: number) => string;
}) {
  const delta = value !== null && previous !== null && previous !== undefined ? value - previous : null;
  const rounded = delta === null ? null : Math.round(delta * 10) / 10;
  const direction = rounded === null || rounded === 0 ? "flat" : rounded > 0 ? "up" : "down";
  const good =
    betterWhen === "neutral" || direction === "flat"
      ? "neutral"
      : (direction === "up") === (betterWhen === "up")
        ? "good"
        : "bad";

  return (
    <div className="rounded-card border border-line bg-surface p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-ink-subtle">{label}</p>
      <p
        className={cx(
          // Proportional figures at display size: tabular-nums makes a large
          // number look loose, and nothing here needs to align in a column.
          "mt-1 font-semibold text-ink",
          hero ? "text-4xl sm:text-5xl" : "text-2xl",
        )}
      >
        {value === null ? <span className="text-ink-subtle">—</span> : `${format(value)}${suffix}`}
      </p>

      {rounded !== null ? (
        <p
          className={cx(
            "mt-1 flex items-center gap-1 text-xs font-medium",
            good === "good" ? "text-success" : good === "bad" ? "text-danger" : "text-ink-muted",
          )}
        >
          {/* An arrow and a sign, so direction never rests on colour alone. */}
          <span aria-hidden="true">{direction === "up" ? "▲" : direction === "down" ? "▼" : "—"}</span>
          {rounded > 0 ? "+" : ""}
          {format(Math.abs(rounded))}
          {suffix} vs previous
        </p>
      ) : null}

      {hint ? <p className="mt-1 text-xs text-ink-subtle">{hint}</p> : null}
    </div>
  );
}

/**
 * A ratio against its limit.
 *
 * The unfilled track is a lighter step of the *same* ramp, so the state reads
 * across the whole bar rather than only where the fill stops.
 */
export function Meter({ label, value, hint }: { label: string; value: number | null; hint?: string }) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-sm font-medium text-ink">{label}</span>
        <span className="text-lg font-semibold tabular-nums text-ink">
          {value === null ? "—" : `${value}%`}
        </span>
      </div>
      <div className="mt-1.5 h-2.5 w-full overflow-hidden rounded-full bg-accent-soft">
        <div
          className="h-full rounded-full transition-[width] duration-500"
          style={{ width: `${Math.min(100, Math.max(0, value ?? 0))}%`, background: "var(--accent)" }}
        />
      </div>
      {hint ? <p className="mt-1 text-xs text-ink-subtle">{hint}</p> : null}
    </div>
  );
}
