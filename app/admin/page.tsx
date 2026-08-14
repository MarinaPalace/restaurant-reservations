import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { PageShell } from "@/components/page-shell";
import { AdminDateManager } from "@/app/admin/date-manager";
import { Card, CardHeader } from "@/components/ui/card";
import { ButtonLink } from "@/components/ui/button";
import { isAdminAuthenticated } from "@/lib/auth/session";
import { getReservationsList } from "@/lib/services/reservations";
import { getFullMenuCatalog, getRestaurantDates } from "@/lib/services/restaurant";
import { todayKey } from "@/lib/date";

export const metadata: Metadata = { title: "Staff dashboard" };

export default async function AdminPage() {
  // Authoritative check — the proxy redirect in front of this is only a
  // convenience and must never be the sole gate.
  if (!(await isAdminAuthenticated())) {
    redirect("/admin/login");
  }

  const [reservations, restaurantDates, menu] = await Promise.all([
    getReservationsList(),
    getRestaurantDates(),
    getFullMenuCatalog(),
  ]);

  const today = todayKey();
  const upcoming = reservations.filter((reservation) => reservation.date >= today && reservation.status === "confirmed");
  const guestsTonight = reservations
    .filter((reservation) => reservation.date === today && reservation.status === "confirmed")
    .reduce((total, reservation) => total + reservation.guestCount, 0);
  const openDates = restaurantDates.filter((date) => date.isOpen && date.date >= today).length;

  const stats = [
    { label: "Guests tonight", value: guestsTonight },
    { label: "Upcoming reservations", value: upcoming.length },
    { label: "Open evenings ahead", value: openDates },
  ];

  return (
    <PageShell width="xl" headerHref="/admin">
      <Card className="p-5 sm:p-6">
        <CardHeader
          as="h1"
          eyebrow="Vista Del Mar"
          title="Staff dashboard"
          actions={
            <div className="flex flex-wrap items-center gap-3" data-print="hide">
              <ButtonLink href="/admin/reservation/new" variant="primary">
                New reservation
              </ButtonLink>
              <ButtonLink href="/admin/menu">Menu editor</ButtonLink>
              <form action="/api/admin/logout" method="POST">
                <button
                  type="submit"
                  className="inline-flex min-h-11 items-center justify-center rounded-control border border-line-strong bg-surface px-4 py-2.5 text-sm font-semibold text-ink transition-colors hover:border-accent"
                >
                  Log out
                </button>
              </form>
            </div>
          }
        />

        <dl className="mt-6 grid gap-4 sm:grid-cols-3">
          {stats.map((stat) => (
            <div key={stat.label} className="rounded-control border border-line bg-surface-muted p-4">
              <dt className="text-sm font-medium text-ink-muted">{stat.label}</dt>
              <dd className="mt-1 text-3xl font-semibold tabular-nums text-ink">{stat.value}</dd>
            </div>
          ))}
        </dl>
      </Card>

      <AdminDateManager initialDates={restaurantDates} initialReservations={reservations} menu={menu} />
    </PageShell>
  );
}
