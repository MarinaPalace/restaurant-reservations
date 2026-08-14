import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { PageShell } from "@/components/page-shell";
import { ReservationForm } from "@/app/admin/reservation/reservation-form";
import { isAdminAuthenticated } from "@/lib/auth/session";
import { getMenuCatalog, getRestaurantDates } from "@/lib/services/restaurant";
import { todayKey } from "@/lib/date";

export const metadata: Metadata = { title: "New reservation" };

export const dynamic = "force-dynamic";

export default async function NewReservationPage() {
  if (!(await isAdminAuthenticated())) {
    redirect("/admin/login");
  }

  const [menu, dates] = await Promise.all([getMenuCatalog(), getRestaurantDates()]);
  const today = todayKey();

  return (
    <PageShell width="lg" headerHref="/admin">
      <ReservationForm menu={menu} dates={dates.filter((entry) => entry.date >= today)} />
    </PageShell>
  );
}
