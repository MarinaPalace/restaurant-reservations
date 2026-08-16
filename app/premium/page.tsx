import type { Metadata } from "next";
import { PageShell } from "@/components/page-shell";
import { PremiumBooking } from "@/app/premium/premium-booking";
import { getMenuCatalog, getRestaurantDates } from "@/lib/services/restaurant";
import { todayKey } from "@/lib/date";

export const metadata: Metadata = {
  title: "An invitation",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function PremiumPage() {
  const [menu, dates] = await Promise.all([getMenuCatalog("en", "premium"), getRestaurantDates()]);
  const today = todayKey();

  /**
   * Only evenings the restaurant has opened for invited guests. Everything
   * else stays locked, which is the point: these guests are choosing months
   * ahead, from a fixed set of dates.
   */
  const available = dates.filter((entry) => entry.premium && entry.isOpen && entry.date >= today);

  return (
    <PageShell width="lg">
      <PremiumBooking menu={menu} dates={available} />
    </PageShell>
  );
}
