import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { PageShell } from "@/components/page-shell";
import { ReservationForm } from "@/app/admin/reservation/reservation-form";
import { getCurrentStaffUser } from "@/lib/auth/guard";
import { hasPermission } from "@/lib/auth/permissions";
import { getReservationByNumber } from "@/lib/services/reservations";
import { getMenuCatalog, getRestaurantDates } from "@/lib/services/restaurant";

export const metadata: Metadata = { title: "Edit reservation" };

export const dynamic = "force-dynamic";

export default async function EditReservationPage({
  params,
}: {
  params: Promise<{ reservationNumber: string }>;
}) {
  const user = await getCurrentStaffUser();

  if (!user) {
    redirect("/admin/login");
  }

  if (!hasPermission(user, "reservations:edit")) {
    redirect("/admin");
  }

  const { reservationNumber } = await params;
  const [reservation, menu, dates] = await Promise.all([
    getReservationByNumber(reservationNumber),
    getMenuCatalog(),
    getRestaurantDates(),
  ]);

  if (!reservation) {
    notFound();
  }

  /**
   * Past dates stay in the list while editing: a booking may already sit on
   * one, and removing it from the options would silently move the guest.
   */
  return (
    <PageShell width="lg" headerHref="/admin" showLanguage={false}>
      <ReservationForm menu={menu} dates={dates} reservation={reservation} />
    </PageShell>
  );
}
