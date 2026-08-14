import type { Metadata } from "next";
import { PageShell } from "@/components/page-shell";
import { BookingSteps } from "@/components/booking-steps";
import { MenuChooser } from "@/app/booking/menu/menu-chooser";
import { getMenuCatalog } from "@/lib/services/restaurant";

export const metadata: Metadata = { title: "Choose your menu" };

// Staff can republish the menu at any time, so never serve a prerendered copy.
export const dynamic = "force-dynamic";

export default async function MenuPage() {
  /**
   * The untranslated catalogue is sent once and localized in the browser, so
   * switching language is instant instead of a round trip per change.
   */
  const courses = await getMenuCatalog();

  return (
    <PageShell width="lg">
      <BookingSteps current="menu" />
      <MenuChooser courses={courses} />
    </PageShell>
  );
}
