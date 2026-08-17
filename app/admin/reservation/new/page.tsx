import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { PageShell } from "@/components/page-shell";
import { ReservationForm } from "@/app/admin/reservation/reservation-form";
import { getCurrentStaffUser } from "@/lib/auth/guard";
import { hasPermission } from "@/lib/auth/permissions";
import { getMenuCatalog, getRestaurantDates } from "@/lib/services/restaurant";
import { todayKey } from "@/lib/date";

export const metadata: Metadata = { title: "New reservation" };

export const dynamic = "force-dynamic";

export default async function NewReservationPage() {
  const user = await getCurrentStaffUser();

  if (!user) {
    redirect("/admin/login");
  }

  // The API refuses the booking regardless; this only avoids offering a form
  // whose submit could never succeed.
  if (!hasPermission(user, "reservations:create")) {
    redirect("/admin");
  }

  const [menu, dates] = await Promise.all([getMenuCatalog(), getRestaurantDates()]);
  const today = todayKey();

  return (
    <PageShell width="lg" headerHref="/admin" showLanguage={false}>
      <ReservationForm menu={menu} dates={dates.filter((entry) => entry.date >= today)} />
    </PageShell>
  );
}
