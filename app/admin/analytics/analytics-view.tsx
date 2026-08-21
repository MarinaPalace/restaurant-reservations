"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Card, CardHeader } from "@/components/ui/card";
import { Button, ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/feedback";
import { Field, Input } from "@/components/ui/field";
import { BarList, ColumnChart, Funnel, Meter, StatTile } from "@/components/charts";
import { cx } from "@/components/ui/utils";
import { formatPrice, type Currency } from "@/lib/money";
import { shortTimeZoneLabel } from "@/lib/timezone";
import { formatBookedAt } from "@/lib/reservation-order";
import { formatLongDate } from "@/lib/date";
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
  FunnelStage,
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
};

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
          {/* The one hero figure, then the supporting tiles. */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
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
              hint={`${totals.covers} of ${totals.seatsOffered} seats over ${totals.eveningsOpen} evenings`}
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
                ? "Guests served each evening, against the seats offered."
                : `Guests served per ${data.bucket}, against the seats offered.`
            }
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

            <div className="space-y-5">
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

              <Section
                title="Pass-keys"
                description="One cohort: keys issued in this period, and what became of them."
              >
                <Funnel stages={data.funnel} />
              </Section>
            </div>
          </div>

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
      )}
    </div>
  );
}
