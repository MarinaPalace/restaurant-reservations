import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { PageShell } from "@/components/page-shell";
import { ReservationForm } from "@/app/admin/reservation/reservation-form";
import { isAdminAuthenticated } from "@/lib/auth/session";
import { getReservationByNumber } from "@/lib/services/reservations";
import { getMenuCatalog, getRestaurantDates } from "@/lib/services/restaurant";

export const metadata: Metadata = { title: "Edit reservation" };

export const dynamic = "force-dynamic";

export default async function EditReservationPage({
  params,
}: {
  params: Promise<{ reservationNumber: string }>;
}) {
  if (!(await isAdminAuthenticated())) {
    redirect("/admin/login");
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
    <PageShell width="lg" headerHref="/admin">
      <ReservationForm menu={menu} dates={dates} reservation={reservation} />
    </PageShell>
  );
}
