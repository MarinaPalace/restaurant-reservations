import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { PageShell } from "@/components/page-shell";
import { AnalyticsView } from "@/app/admin/analytics/analytics-view";
import { getCurrentStaffUser } from "@/lib/auth/guard";
import { hasPermission } from "@/lib/auth/permissions";
import { getReservationsList } from "@/lib/services/reservations";
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
  buildTotals,
  cancellationLines,
  capacityTrend,
  coversTrend,
  dishPopularity,
  partySizes,
  passKeyFunnel,
  promotionLines,
  reservationsIn,
  datesIn,
} from "@/lib/analytics/metrics";
import { isValidDateKey } from "@/lib/date";

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

  const [reservations, dates, menu, passKeys, currency, timeZone] = await Promise.all([
    getReservationsList(),
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
  };

  return (
    <PageShell width="xl" headerHref="/admin" showLanguage={false}>
      <AnalyticsView data={data} preset={preset} isCustom={Boolean(custom)} currency={currency} timeZone={timeZone} />
    </PageShell>
  );
}
