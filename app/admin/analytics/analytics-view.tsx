"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Card, CardHeader } from "@/components/ui/card";
import { Button, ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/feedback";
import { Field, Input } from "@/components/ui/field";
import { BarList, ColumnChart, Funnel, Meter, StackedColumns, StatTile, TrendChart } from "@/components/charts";
import { cx } from "@/components/ui/utils";
import { formatPrice, type Currency } from "@/lib/money";
import { shortTimeZoneLabel } from "@/lib/timezone";
import { formatBookedAt } from "@/lib/reservation-order";
import { formatLongDate, formatShortDate } from "@/lib/date";
import {
  RANGE_PRESETS,
  RANGE_PRESET_LABELS,
  formatBucket,
  formatRange,
  type Bucket,
  type DateRange,
  type RangePreset,
} from "@/lib/analytics/range";
import type {
  CancellationLine,
  Coefficient,
  EveningLine,
  FunnelStage,
  LeadBucket,
  WeekdayLine,
  Popularity,
  PartySize,
  PromotionLine,
  Totals,
  Trend,
} from "@/lib/analytics/metrics";

/**
 * The analytics dashboard.
 *
 * Everything here arrives already folded — the browser is handed numbers, not
 * reservations. This component's whole job is layout, the range control, and
 * the table view.
 *
 * **The table view is not optional.** Every chart on this page is also readable
 * as text, because a chart that is the only way to reach a number excludes
 * anybody using a screen reader and anybody who needs to copy a figure into an
 * email. It doubles as the CSV.
 */

export type AnalyticsData = {
  range: DateRange;
  comparison: DateRange;
  bucket: Bucket;
  totals: Totals;
  previousTotals: Totals;
  covers: Trend[];
  capacity: Trend[];
  dishes: Popularity[];
  declines: { courseId: string; courseName: string; count: number }[];
  promotions: PromotionLine[];
  parties: PartySize[];
  cancellations: CancellationLine[];
  funnel: FunnelStage[];
  coefficients: Coefficient[];
  minutesPerManualBooking: number;
  weekdays: WeekdayLine[];
  leadTime: { buckets: LeadBucket[]; counted: number; unknown: number };
  source: Array<{ key: string; label: string; parts: number[] }>;
  evenings: EveningLine[];
  previousCovers: Trend[];
};

const TABS = [
  { key: "overview" as const, label: "Overview" },
  { key: "guests" as const, label: "Guests" },
  { key: "kitchen" as const, label: "Kitchen" },
  { key: "keys" as const, label: "Pass-keys" },
];

type Tab = (typeof TABS)[number]["key"];

function Section({
  title,
  description,
  children,
  className,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Card as="section" className={cx("p-5", className)}>
      <h2 className="text-lg font-semibold text-ink">{title}</h2>
      {description ? <p className="mt-0.5 text-sm text-ink-muted">{description}</p> : null}
      <div className="mt-4">{children}</div>
    </Card>
  );
}

export function AnalyticsView({
  data,
  preset,
  isCustom,
  currency,
  timeZone,
}: {
  data: AnalyticsData;
  preset: RangePreset;
  isCustom: boolean;
  currency: Currency;
  timeZone: string;
}) {
  const router = useRouter();
  const [from, setFrom] = useState(data.range.from);
  const [to, setTo] = useState(data.range.to);
  const [showTable, setShowTable] = useState(false);
  const [tab, setTab] = useState<Tab>("overview");
  /**
   * Whether every chart carries the previous period beside it.
   *
   * Off by default. The stat tiles already show the direction of travel, and a
   * second line on every chart when nobody asked for one is the difference
   * between a chart that answers a question and one that has to be studied.
   */
  const [compare, setCompare] = useState(false);
  /** The evening a chart was clicked on, shown in full beneath it. */
  const [openDate, setOpenDate] = useState<string | null>(null);

  const openEvening = data.evenings.find((evening) => evening.date === openDate) ?? null;

  /**
   * A bucket key maps to an evening only when the bucket *is* one evening.
   * Clicking a week would otherwise open whichever day happened to name it,
   * which is a worse answer than not opening anything.
   */
  const openBucket = data.bucket === "day" ? (key: string) => setOpenDate(key) : undefined;

  const { totals, previousTotals } = data;
  const money = (amount: number) => formatPrice(amount, currency, "en-GB");

  const applyCustom = () => {
    router.push(`/admin/analytics?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
  };

  /** One row per bucket, so every chart on the page is also reachable as text. */
  const tableRows = data.covers.map((point, index) => ({
    key: point.key,
    label: formatBucket(point.key, data.bucket),
    covers: point.value,
    capacity: data.capacity[index]?.value ?? 0,
  }));

  const downloadCsv = () => {
    const lines = [
      ["Period", "Covers", "Seats offered"],
      ...tableRows.map((row) => [row.label, String(row.covers), String(row.capacity)]),
      [],
      ["Dish", "Course", "Chosen"],
      ...data.dishes.map((dish) => [dish.optionName, dish.courseName, String(dish.count)]),
      [],
      ["Promotion", "Group", "Sold", "Revenue", "Discount given"],
      ...data.promotions.map((line) => [
        line.optionName,
        line.courseName,
        String(line.count),
        line.revenue.toFixed(2),
        line.discount.toFixed(2),
      ]),
    ];

    const escape = (cell: string) => (/[",\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell);
    // The BOM is what makes Excel read this as UTF-8 rather than mojibake.
    const csv = "﻿" + lines.map((row) => row.map(escape).join(",")).join("\r\n");

    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `analytics-${data.range.from}-to-${data.range.to}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  const nothingYet = totals.bookings === 0 && totals.cancelled === 0 && totals.eveningsOpen === 0;

  return (
    <div className="space-y-5">
      <Card className="p-5 sm:p-6">
        <CardHeader
          as="h1"
          eyebrow="Admin panel"
          title="Analytics"
          description={`${formatRange(data.range)} · compared with ${formatRange(data.comparison)}`}
          actions={
            <div className="flex flex-wrap items-center gap-2" data-print="hide">
              <ButtonLink href="/admin">Dashboard</ButtonLink>
              <Button variant="secondary" onClick={downloadCsv}>
                Export CSV
              </Button>
              <Button variant="secondary" onClick={() => window.print()}>
                Print
              </Button>
            </div>
          }
        />

        {/* Filters in one row above the charts, where they are expected. */}
        <div className="mt-5 flex flex-wrap items-end gap-3" data-print="hide">
          <div role="group" aria-label="Period" className="flex flex-wrap rounded-control border border-line-strong">
            {RANGE_PRESETS.map((option) => (
              <Link
                key={option}
                href={`/admin/analytics?range=${option}`}
                aria-current={!isCustom && preset === option ? "page" : undefined}
                className={cx(
                  "flex min-h-11 items-center px-4 text-sm font-medium transition-colors first:rounded-l-control last:rounded-r-control",
                  !isCustom && preset === option
                    ? "bg-primary text-primary-fg"
                    : "bg-surface text-ink hover:bg-surface-sunken",
                )}
              >
                {RANGE_PRESET_LABELS[option]}
              </Link>
            ))}
          </div>

          {/* Sized to their content: a date input left to fill the row pushes
              the presets onto a line of their own and the filters stop reading
              as one control. */}
          <div className="flex flex-wrap items-end gap-2">
            {/* Constrained here rather than by changing `Field`, which is
                `w-full` on purpose everywhere else in the app. */}
            <div className="w-40">
              <Field label="From">
                {(fieldProps) => (
                  <Input {...fieldProps} type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
                )}
              </Field>
            </div>
            <div className="w-40">
              <Field label="To">
                {(fieldProps) => (
                  <Input {...fieldProps} type="date" value={to} onChange={(event) => setTo(event.target.value)} />
                )}
              </Field>
            </div>
            <Button variant="secondary" onClick={applyCustom} disabled={!from || !to || from > to}>
              Apply
            </Button>
          </div>
        </div>

        {/*
          Off by default. The stat tiles already carry the direction of travel,
          and a second line on every chart nobody asked for is the difference
          between a chart that answers a question and one that has to be
          studied. The period it compares against is named, because "previous"
          is ambiguous the moment somebody types a custom range.
        */}
        <label className="mt-3 flex min-h-11 items-center gap-2 text-sm font-medium text-ink" data-print="hide">
          <input
            type="checkbox"
            className="size-5 accent-[var(--primary)]"
            checked={compare}
            onChange={(event) => setCompare(event.target.checked)}
          />
          Compare with the previous period
          <span className="text-xs font-normal tabular-nums text-ink-subtle">
            ({formatShortDate(data.comparison.from)} — {formatShortDate(data.comparison.to)})
          </span>
        </label>

        <p className="mt-3 text-xs text-ink-subtle">
          Times are {shortTimeZoneLabel(timeZone)}. Covers count confirmed bookings; occupancy counts only
          evenings that were open.
        </p>
      </Card>

      {nothingYet ? (
        <Card className="p-6">
          <EmptyState
            title="Nothing in this period"
            description="No evenings were open and no bookings were taken. Choose a different period, or open some dates on the dashboard."
            action={<ButtonLink href="/admin">Go to the calendar</ButtonLink>}
          />
        </Card>
      ) : (
        <>
          {/*
            Four audiences, four tabs.

            The page had grown to one column of everything, which meant the
            kitchen scrolled past occupancy and the owner scrolled past dish
            counts. Splitting it is not decoration: each of these is read by a
            different person for a different decision, and the one thing they
            share is the period, which is why the range picker stays above.

            State rather than the address, unlike the range: which tab somebody
            is on is not a thing they send to anybody, and the period is.
          */}
          <div
            role="group"
            aria-label="Section"
            className="flex flex-wrap gap-1 rounded-control border border-line-strong p-1"
            data-print="hide"
          >
            {TABS.map((option) => (
              <button
                key={option.key}
                type="button"
                aria-pressed={tab === option.key}
                onClick={() => setTab(option.key)}
                className={cx(
                  "min-h-10 flex-1 rounded-[calc(var(--radius-control)-3px)] px-3 text-sm font-semibold transition-colors",
                  tab === option.key ? "bg-accent-soft text-accent-ink" : "text-ink-muted hover:text-ink",
                )}
              >
                {option.label}
              </button>
            ))}
          </div>

          {tab === "overview" ? (
            <>
          {/* The one hero figure, then the supporting tiles. */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
            <StatTile
              hero
              label="Covers served"
              value={totals.covers}
              previous={previousTotals.covers}
              hint={`${totals.bookings} bookings · ${totals.averageParty ?? "—"} avg party`}
            />
            <StatTile
              label="Occupancy"
              value={totals.occupancy}
              previous={previousTotals.occupancy}
              suffix="%"
              hint={
                totals.attendanceRecorded > 0
                  ? // Booked against served. The two diverging is the interesting
                    // number, and it only exists once somebody marks the board.
                    `${totals.covers} of ${totals.seatsOffered} seats booked · ${totals.seatedCovers} actually sat down`
                  : `${totals.covers} of ${totals.seatsOffered} seats over ${totals.eveningsOpen} evenings`
              }
            />
            <StatTile
              label="Cancellation rate"
              value={totals.cancellationRate}
              previous={previousTotals.cancellationRate}
              suffix="%"
              // Falling is good here — the arrow must not wear the same colour
              // as a falling covers count.
              betterWhen="down"
              hint={`${totals.cancelled} cancelled`}
            />
            {/*
              No-shows, and the coverage figure that qualifies them.

              These two are inseparable. A no-show rate computed over a night
              nobody marked is a confident number about nothing, so the tile
              states how much of the period was actually recorded — and when
              nothing was, it says so instead of showing 0%.
            */}
            <StatTile
              label="No-show rate"
              value={totals.noShowRate}
              previous={previousTotals.noShowRate}
              suffix="%"
              betterWhen="down"
              hint={
                totals.attendanceRecorded === 0
                  ? "Nobody marked attendance in this period"
                  : `${totals.noShows} of ${totals.attendanceRecorded} recorded · ${totals.attendanceCoverage}% of bookings marked`
              }
            />
            <StatTile
              label="Promotion revenue"
              value={totals.promotionRevenue}
              previous={previousTotals.promotionRevenue}
              format={money}
              hint={`${money(totals.promotionDiscount)} given away in discounts`}
            />
          </div>

          <Section
            title="Covers over time"
            description={
              data.bucket === "day"
                ? "Guests served each evening. Click a point to open that evening."
                : `Guests served per ${data.bucket}.`
            }
          >
            {/*
              A line rather than the columns this used to be. Covers are one
              continuous thing read for their direction; thirty columns is a
              picket fence in which no trend is visible at all.
            */}
            <TrendChart
              points={data.covers.map((point, index) => ({
                key: point.key,
                label: formatBucket(point.key, data.bucket),
                value: point.value,
                // Paired by position, not by date: a comparison is two
                // different stretches of calendar by definition.
                previous: compare ? data.previousCovers[index]?.value : undefined,
              }))}
              label="Covers"
              comparisonLabel={compare ? "Previous period" : undefined}
              onSelect={openBucket}
            />
          </Section>

          {/* The evening a point was clicked on. Folded on the server with
              everything else, so opening one costs no round trip. */}
          {openEvening ? <EveningPanel evening={openEvening} onClose={() => setOpenDate(null)} /> : null}

          <Section
            title="Seats offered against seats taken"
            description="The same two numbers, side by side rather than one behind the other."
          >
            <ColumnChart
              points={data.covers.map((point, index) => ({
                key: point.key,
                label: formatBucket(point.key, data.bucket),
                value: point.value,
                reference: data.capacity[index]?.value,
              }))}
              label="Covers"
              referenceLabel="Seats offered"
            />
          </Section>

          <div className="grid gap-5 lg:grid-cols-2">
            <Section
              title="The shape of the week"
              description="Averaged per evening open, so a month with five Saturdays does not report Saturday as busier by arithmetic alone."
            >
              <BarList
                rows={data.weekdays.map((line) => ({
                  id: String(line.weekday),
                  label: line.name,
                  sublabel:
                    line.eveningsOpen === 0
                      ? "never open"
                      : `${line.eveningsOpen} evening${line.eveningsOpen === 1 ? "" : "s"}${
                          line.occupancy === null ? "" : ` · ${line.occupancy}% full`
                        }`,
                  value: line.averageCovers ?? 0,
                  display: line.averageCovers === null ? "—" : String(line.averageCovers),
                }))}
                valueLabel="covers an evening"
              />
            </Section>

            <Section
              title="Who took the booking"
              description="The total is on the chart above; this is what it is made of. A flat month that quietly moved to self-service is a real change, and is invisible in the total."
            >
              <StackedColumns
                points={data.source}
                series={["Booked by guests", "Taken by staff"]}
                onSelect={openBucket}
              />
            </Section>
          </div>

          {/* Nothing on this page is reachable only as a chart. */}
          <Card as="section" className="p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-ink">The numbers, as a table</h2>
                <p className="mt-0.5 text-sm text-ink-muted">
                  Every chart above, as text — for a screen reader, or to paste into an email.
                </p>
              </div>
              <Button variant="secondary" onClick={() => setShowTable((current) => !current)} data-print="hide">
                {showTable ? "Hide" : "Show"}
              </Button>
            </div>

            {showTable ? (
              <div className="mt-4 overflow-x-auto">
                <table className="min-w-full border-collapse text-left text-sm">
                  <caption className="sr-only">Covers and seats offered per period</caption>
                  <thead className="bg-surface-sunken text-ink-muted">
                    <tr>
                      <th scope="col" className="px-3 py-2 font-semibold">Period</th>
                      <th scope="col" className="px-3 py-2 text-right font-semibold">Covers</th>
                      <th scope="col" className="px-3 py-2 text-right font-semibold">Seats offered</th>
                      <th scope="col" className="px-3 py-2 text-right font-semibold">Occupancy</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tableRows.map((row) => (
                      <tr key={row.key} className="border-t border-line">
                        <td className="px-3 py-2">{row.label}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{row.covers}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{row.capacity || "—"}</td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {row.capacity > 0 ? `${Math.round((row.covers / row.capacity) * 100)}%` : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </Card>
            </>
          ) : null}

          {tab === "guests" ? (
            <>
          <div className="grid gap-5 lg:grid-cols-2">
            <Section title="Party sizes" description="How many people a booking is usually for.">
              <BarList
                rows={data.parties.map((party) => ({
                  id: String(party.guests),
                  label: `${party.guests} ${party.guests === 1 ? "guest" : "guests"}`,
                  value: party.bookings,
                }))}
                valueLabel="bookings"
              />
            </Section>

            <Section
              title="Cancellations"
              description="How many, and how much notice they gave — ten a month is fine a week out and expensive at six o'clock."
            >
              {data.cancellations.length === 0 ? (
                <p className="py-6 text-center text-sm text-ink-muted">None in this period.</p>
              ) : (
                <ul className="space-y-2.5">
                  {data.cancellations.slice(0, 12).map((line) => (
                    <li key={line.reservationNumber} className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line pb-2 last:border-0">
                      <span className="min-w-0">
                        <Link
                          href={`/admin/reservation/${line.reservationNumber}`}
                          className="font-medium text-ink underline underline-offset-2"
                        >
                          {line.reservationNumber}
                        </Link>
                        <span className="ml-2 text-sm text-ink-muted">
                          room {line.room} · {formatLongDate(line.date)}
                        </span>
                        {line.reason ? (
                          <span className="mt-0.5 block text-xs text-ink-subtle">{line.reason}</span>
                        ) : null}
                      </span>
                      <span className="shrink-0 text-right text-xs text-ink-muted">
                        {line.noticeHours === null
                          ? formatBookedAt(line.at)
                          : line.noticeHours >= 0
                            ? `${line.noticeHours}h notice`
                            : `${Math.abs(line.noticeHours)}h late`}
                        <span className="block text-ink-subtle">by {line.actorName}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Section>

            <Section
              title="How far ahead people book"
              description="The figure the booking cutoff should be set from, rather than guessed at."
            >
              <BarList
                rows={data.leadTime.buckets.map((bucket) => ({
                  id: bucket.key,
                  label: bucket.label,
                  value: bucket.bookings,
                }))}
                valueLabel="bookings"
              />
              <p className="mt-3 text-xs text-ink-subtle">
                {data.leadTime.counted} booking{data.leadTime.counted === 1 ? "" : "s"} counted.
                {data.leadTime.unknown > 0
                  ? ` ${data.leadTime.unknown} had no record of when ${data.leadTime.unknown === 1 ? "it was" : "they were"} taken and ${data.leadTime.unknown === 1 ? "is" : "are"} left out — unknown is not the same as same-day.`
                  : ""}
              </p>
            </Section>
          </div>
            </>
          ) : null}

          {tab === "kitchen" ? (
            <div className="grid gap-5 lg:grid-cols-2">
          <Section title="What guests ate" description="Every dish chosen on a confirmed booking, by course.">
            <BarList
              rows={data.dishes.map((dish) => ({
                id: dish.optionId,
                label: dish.optionName,
                sublabel: dish.courseName,
                value: dish.count,
              }))}
              valueLabel="chosen"
            />

            {data.declines.length > 0 ? (
              <div className="mt-5 border-t border-line pt-4">
                <h3 className="text-sm font-semibold text-ink">Courses declined</h3>
                <p className="mt-0.5 text-xs text-ink-muted">
                  &ldquo;No thank you&rdquo; is a real choice, and never a plate.
                </p>
                <ul className="mt-2 space-y-1 text-sm">
                  {data.declines.map((decline) => (
                    <li key={decline.courseId} className="flex justify-between gap-3">
                      <span className="text-ink-muted">{decline.courseName}</span>
                      <span className="font-semibold tabular-nums text-ink">{decline.count}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </Section>
<Section title="Promotions" description="Taken on the confirmation screen, and what they earned.">
            <Meter
              label="Take-up"
              value={totals.promotionTakeUp}
              hint={`of ${totals.bookings} confirmed bookings took at least one`}
            />
            <div className="mt-5">
              <BarList
                rows={data.promotions.map((line) => ({
                  id: line.optionId,
                  label: line.optionName,
                  sublabel: line.courseName,
                  value: line.revenue,
                  display: `${money(line.revenue)} · ${line.count}×`,
                }))}
                valueLabel="revenue"
              />
            </div>
          </Section>
            </div>
          ) : null}

          {tab === "keys" ? (
            <>
          <Section
            title="Pass-keys"
            description="One cohort: keys issued in this period, and what became of them."
          >
            <Funnel stages={data.funnel} />
          </Section>

          <Section
            title="What the system is doing for you"
            description="Each of these is something that happened by itself against something a member of staff would otherwise have done by hand."
          >
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {data.coefficients.map((coefficient) => (
                <CoefficientTile key={coefficient.key} coefficient={coefficient} />
              ))}
            </div>

            {/*
              The one assumption on the page, put where the figure that rests
              on it is read rather than buried in a settings screen. It lives in
              the address, like the date range does, so a particular reading can
              be sent to somebody else and come back saying the same thing.
            */}
            <form className="mt-4 flex flex-wrap items-center gap-2 border-t border-line pt-4" method="get">
              {preset ? <input type="hidden" name="range" value={preset} /> : null}
              {isCustom ? (
                <>
                  <input type="hidden" name="from" value={data.range.from} />
                  <input type="hidden" name="to" value={data.range.to} />
                </>
              ) : null}
              <label className="text-sm text-ink-muted" htmlFor="minutes-per-booking">
                A booking taken by hand costs
              </label>
              <input
                id="minutes-per-booking"
                name="minutes"
                type="number"
                min={0}
                max={120}
                defaultValue={data.minutesPerManualBooking}
                className="h-9 w-20 rounded-control border border-line-strong bg-surface px-2 text-sm tabular-nums text-ink"
              />
              <span className="text-sm text-ink-muted">minutes of somebody&rsquo;s time.</span>
              <Button type="submit" variant="secondary">
                Apply
              </Button>
            </form>
          </Section>
            </>
          ) : null}
        </>
      )}
    </div>
  );
}

/**
 * One coefficient, with the two numbers it came out of.
 *
 * The counts are printed under every figure and are not decoration: "68%" over
 * four bookings and "68%" over four hundred are different facts, and a tile
 * showing only the percentage cannot tell them apart. It is the same argument
 * the no-show rate already makes for never appearing without its coverage.
 *
 * A null value prints as a dash rather than as zero. There is no self-service
 * rate for a period with no bookings, and reporting 0% would be a confident
 * statement about nothing.
 */
function CoefficientTile({ coefficient }: { coefficient: Coefficient }) {
  const { value, unit } = coefficient;

  const shown =
    value === null
      ? "—"
      : unit === "percent"
        ? `${value}%`
        : unit === "ratio"
          ? `${value}×`
          : unit === "hours"
            ? `${value} h`
            : String(value);

  return (
    <div className="rounded-control border border-line bg-surface-muted p-4">
      <p className="text-sm font-medium text-ink-muted">{coefficient.label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums text-ink">{shown}</p>
      <p className="mt-1 text-sm tabular-nums text-ink-subtle">
        {coefficient.part.toLocaleString()} {coefficient.partLabel} · {coefficient.whole.toLocaleString()}{" "}
        {coefficient.wholeLabel}
      </p>
      <p className="mt-2 text-sm text-ink-subtle">{coefficient.hint}</p>
    </div>
  );
}

/**
 * One evening, opened from a chart.
 *
 * ## Why the numbers are already here
 *
 * Folded on the server with everything else rather than fetched on the click.
 * A month is a few dozen rows and the bookings are already in memory; a round
 * trip per click would make a chart feel like a page, and the whole point of
 * clicking a bar is that it answers immediately.
 *
 * ## It only opens where a bar *is* an evening
 *
 * Weekly and monthly buckets have no drill-down at all. Clicking a week would
 * otherwise open whichever day happened to name the bucket, which is a worse
 * answer than not opening anything.
 *
 * ## The no-show count keeps its denominator
 *
 * `docs/service-tracking.md` §7: a night nobody marked is not a night without
 * no-shows. So the figure is always shown as "2 of 14 recorded" rather than as
 * a rate, and an evening with nothing recorded says so instead of showing zero.
 */
function EveningPanel({ evening, onClose }: { evening: EveningLine; onClose: () => void }) {
  const figures: { label: string; value: string; hint?: string }[] = [
    { label: "Covers", value: String(evening.covers), hint: `of ${evening.capacity} seats` },
    { label: "Occupancy", value: evening.occupancy === null ? "—" : `${evening.occupancy}%` },
    {
      label: "Bookings",
      value: String(evening.bookings),
      hint: evening.cancelled > 0 ? `${evening.cancelled} cancelled` : undefined,
    },
    {
      label: "Booked by guests",
      value: evening.bookings > 0 ? `${Math.round((evening.byGuest / evening.bookings) * 100)}%` : "—",
      hint: `${evening.byGuest} of ${evening.bookings}`,
    },
    {
      label: "No-shows",
      value: evening.attendanceRecorded > 0 ? String(evening.noShows) : "—",
      hint:
        evening.attendanceRecorded > 0
          ? `of ${evening.attendanceRecorded} recorded`
          : "nothing was recorded that evening",
    },
  ];

  return (
    <Card as="section" className="border-accent p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="eyebrow">The evening</p>
          <h2 className="mt-1 text-lg font-semibold text-ink">
            <time dateTime={evening.date}>{formatLongDate(evening.date)}</time>
          </h2>
          <p className="mt-0.5 text-sm text-ink-muted">
            {evening.isOpen ? "Open" : "Closed"}
            {evening.premium ? " · invitation only" : ""}
            {evening.promotionRevenue > 0 ? " · promotions taken" : ""}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2" data-print="hide">
          {/* Straight to the board for that date, which is the screen somebody
              actually wants after asking why an evening looks odd. */}
          <ButtonLink href={`/admin/service?date=${evening.date}`}>Open the service board</ButtonLink>
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>

      <dl className="mt-4 grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {figures.map((figure) => (
          <div key={figure.label} className="rounded-control border border-line bg-surface-muted p-3">
            <dt className="text-xs font-medium text-ink-muted">{figure.label}</dt>
            <dd className="mt-0.5 text-xl font-semibold tabular-nums text-ink">{figure.value}</dd>
            {figure.hint ? <p className="mt-0.5 text-xs text-ink-subtle">{figure.hint}</p> : null}
          </div>
        ))}
      </dl>
    </Card>
  );
}
