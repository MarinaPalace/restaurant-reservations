import type { Metadata } from "next";
import { Suspense } from "react";
import { PageShell } from "@/components/page-shell";
import { ManageReservation } from "@/app/booking/manage/manage-reservation";
import { getMenuCatalog } from "@/lib/services/restaurant";

export const metadata: Metadata = { title: "Manage your reservation" };

export const dynamic = "force-dynamic";

export default async function ManageReservationPage() {
  // The menu is needed to let a guest swap a dish, and it is the same
  // catalogue the booking flow uses.
  const menu = await getMenuCatalog();

  return (
    <PageShell width="md">
      {/* The key can arrive in the address, which useSearchParams reads. */}
      <Suspense fallback={null}>
        <ManageReservation menu={menu} />
      </Suspense>
    </PageShell>
  );
}
