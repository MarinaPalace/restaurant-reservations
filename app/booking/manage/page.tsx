import type { Metadata } from "next";
import { Suspense } from "react";
import { PageShell } from "@/components/page-shell";
import { ManageReservation } from "@/app/booking/manage/manage-reservation";
import { getMenuCatalog, getPromoCatalog } from "@/lib/services/restaurant";
import { getCurrency } from "@/lib/services/settings";

export const metadata: Metadata = { title: "Manage your reservation" };

export const dynamic = "force-dynamic";

export default async function ManageReservationPage() {
  // The menu is needed to let a guest swap a dish, and it is the same
  // catalogue the booking flow uses. The currency is for reading promotions
  // back — the promotions catalogue itself is not needed here, because nothing
  // on this screen offers one: what a booking already holds is stored on the
  // booking, priced as it was agreed.
  /**
   * The promotions catalogue is here so a guest can *swap* what they already
   * took. Nothing on this screen can add one — the route refuses a group the
   * booking does not hold — so sending the whole catalogue is safe: the
   * component only ever offers the groups already on the booking.
   */
  const [menu, promoGroups, currency] = await Promise.all([
    getMenuCatalog(),
    getPromoCatalog(),
    getCurrency(),
  ]);

  return (
    <PageShell width="md">
      {/* The key can arrive in the address, which useSearchParams reads. */}
      <Suspense fallback={null}>
        <ManageReservation menu={menu} promoGroups={promoGroups} currency={currency} />
      </Suspense>
    </PageShell>
  );
}
