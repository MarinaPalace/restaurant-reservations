import type { Metadata } from "next";
import { PageShell } from "@/components/page-shell";
import { BookingSteps } from "@/components/booking-steps";
import { MenuChooser } from "@/app/booking/menu/menu-chooser";
import { SeatHoldBanner } from "@/components/seat-hold-banner";
import { getCachedMenuCatalog } from "@/lib/services/menu-cache";

export const metadata: Metadata = { title: "Choose your menu" };

/**
 * This page is rendered per request, and cannot be otherwise: the root layout
 * settles the language from a cookie, which makes every route in the app
 * dynamic no matter what is configured here. `force-dynamic` used to say so
 * explicitly; removing it changes nothing about that, and saying `revalidate`
 * here would only promise a prerender that Next will never produce.
 *
 * What was actually costing the guest is gone instead. The catalogue is held
 * between requests by `getCachedMenuCatalog` and dropped when staff publish, so
 * a render no longer waits on the database; and the photographs, which are the
 * overwhelming majority of the bytes, are cached at the edge and re-encoded
 * per device rather than fetched whole, per guest, from a function.
 */

export default async function MenuPage() {
  /**
   * The untranslated catalogue is sent once and localized in the browser, so
   * switching language is instant instead of a round trip per change.
   */
  const courses = await getCachedMenuCatalog();

  return (
    <PageShell width="lg">
      <BookingSteps current="menu" />
      {/* The menu is the longest step, so it is the one that most needs to say
          how long the seats are held. */}
      <SeatHoldBanner />
      <MenuChooser courses={courses} />
    </PageShell>
  );
}
