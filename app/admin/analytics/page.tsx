import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { PageShell } from "@/components/page-shell";
import { AnalyticsView } from "@/app/admin/analytics/analytics-view";
import { getCurrentStaffUser } from "@/lib/auth/guard";
import { hasPermission } from "@/lib/auth/permissions";
import { getReservationsBetween } from "@/lib/services/reservations";
import { getFullMenuCatalog, getRestaurantDates } from "@/lib/services/restaurant";
import { listPassKeys } from "@/lib/services/pass-keys";
import { getCurrency, getTimeZone } from "@/lib/services/settings";
import { getReservationWindow } from "@/lib/calendar";
import {
  bucketFor,
  isRangePreset,
  isValidRange,
  previousRange,
  resolvePreset,
  type DateRange,
} from "@/lib/analytics/range";
import {
  DEFAULT_MINUTES_PER_MANUAL_BOOKING,
  buildTotals,
  cancellationLines,
  coefficients,
  capacityTrend,
  coversTrend,
  dishPopularity,
  partySizes,
  passKeyFunnel,
  promotionLines,
  reservationsIn,
  datesIn,
} from "@/lib/analytics/metrics";
import { isValidDateKey, todayKey } from "@/lib/date";

export const metadata: Metadata = { title: "Analytics" };

// Every booking changes these numbers, so nothing here may be prerendered.
export const dynamic = "force-dynamic";

/**
 * The analytics page.
 *
 * Everything is aggregated **on read** — see `lib/analytics/metrics.ts` for why
 * a rollup table would be the wrong trade at this size. The folding happens on
 * the server so the browser is handed numbers rather than a few thousand
 * reservations to reduce itself.
 *
 * Authorisation is checked here, not only by hiding the dashboard link
 * (rule 2.5).
 */
export default async function AnalyticsPage({ searchParams }: PageProps<"/admin/analytics">) {
  const user = await getCurrentStaffUser();

  if (!user) {
    redirect("/admin/login");
  }

  if (!hasPermission(user, "analytics:view")) {
    redirect("/admin");
  }

  const params = await searchParams;
  const preset = isRangePreset(params.range) ? params.range : "this-month";

  /**
   * A custom pair beats the preset when both ends are real dates the right way
   * round. Anything else falls back rather than erroring: a mistyped address
   * should show this month, not a stack trace.
   */
  const custom: DateRange | null =
    typeof params.from === "string" && typeof params.to === "string" && isValidDateKey(params.from) && isValidDateKey(params.to)
      ? { from: params.from, to: params.to }
      : null;

  const range = custom && isValidRange(custom) ? custom : resolvePreset(preset);
  const comparison = previousRange(range);

  /**
   * The one assumption behind the "desk time not spent" figure, and the only
   * input on this page that is not a measurement.
   *
   * It lives in the address rather than in the settings store, like the date
   * range does, because it is a what-if rather than a policy: a manager tries
   * four minutes and then eight to see how much the answer moves, and a
   * particular reading can be sent to somebody else and come back saying the
   * same thing. Anything unparseable falls back to the default rather than
   * erroring, for the same reason a mistyped range shows this month.
   */
  const requestedMinutes = Number(params.minutes);
  const minutesPerManualBooking =
    Number.isFinite(requestedMinutes) && requestedMinutes >= 0 && requestedMinutes <= 120
      ? Math.round(requestedMinutes)
      : DEFAULT_MINUTES_PER_MANUAL_BOOKING;

  /**
   * Everything on this page is folded from reservations inside the range or its
   * comparison period — anything outside is discarded by `reservationsIn`. So
   * load only that window (the `date` index carries it) rather than the whole
   * collection. `comparison` always precedes `range`, but the union is taken
   * explicitly so a future range shape cannot quietly drop rows.
   * See docs/performance.md §3.1.
   */
  const windowFrom = comparison.from < range.from ? comparison.from : range.from;
  const windowTo = comparison.to > range.to ? comparison.to : range.to;

  const [reservations, dates, menu, passKeys, currency, timeZone] = await Promise.all([
    getReservationsBetween(windowFrom, windowTo),
    getRestaurantDates(),
    getFullMenuCatalog("standard"),
    listPassKeys(),
    getCurrency(),
    getTimeZone(),
  ]);

  /**
   * A booking's sitting as an instant, for lead time and cancellation notice.
   *
   * Built from the evening's own arrival time where there is one. This reads
   * the server clock (`docs/timezones.md`), which is correct as long as the
   * deployment runs in the restaurant's zone — the same assumption every
   * deadline in this app already makes.
   */
  const sittingOf = (reservation: { date: string; time?: string; endTime?: string }) =>
    getReservationWindow(reservation.date, reservation.time, reservation.endTime).start;

  const inRange = reservationsIn(reservations, range);
  const inComparison = reservationsIn(reservations, comparison);
  const bucket = bucketFor(range);

  const data = {
    range,
    comparison,
    bucket,
    totals: buildTotals(inRange, datesIn(dates, range), sittingOf),
    previousTotals: buildTotals(inComparison, datesIn(dates, comparison), sittingOf),
    covers: coversTrend(inRange, range, bucket),
    capacity: capacityTrend(datesIn(dates, range), range, bucket),
    ...dishPopularity(inRange, menu),
    promotions: promotionLines(inRange),
    parties: partySizes(inRange),
    cancellations: cancellationLines(inRange, sittingOf),
    funnel: passKeyFunnel(passKeys, range),
    /**
     * `today` is passed in rather than read inside, because whether a key has
     * lapsed is a question about the restaurant's calendar day (rule 2.1) and
     * the metrics module is deliberately free of any clock of its own.
     */
    coefficients: coefficients(inRange, passKeys, range, {
      today: todayKey(),
      minutesPerManualBooking,
    }).coefficients,
    minutesPerManualBooking,
  };

  return (
    <PageShell width="xl" headerHref="/admin" showLanguage={false}>
      <AnalyticsView data={data} preset={preset} isCustom={Boolean(custom)} currency={currency} timeZone={timeZone} />
    </PageShell>
  );
}
