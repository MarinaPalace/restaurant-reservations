import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { PageShell } from "@/components/page-shell";
import { AdminDateManager } from "@/app/admin/date-manager";
import { Card, CardHeader } from "@/components/ui/card";
import { ButtonLink } from "@/components/ui/button";
import { getCurrentStaffUser } from "@/lib/auth/guard";
import { hasPermission, permissionsOf } from "@/lib/auth/permissions";
import { getReservationsList } from "@/lib/services/reservations";
import { getFullMenuCatalog, getRestaurantDates } from "@/lib/services/restaurant";
import { todayKey } from "@/lib/date";
import { getTimeZone } from "@/lib/services/settings";
import { describeClockMismatch } from "@/lib/timezone";

export const metadata: Metadata = { title: "Staff dashboard" };

export default async function AdminPage() {
  // Authoritative check — the proxy redirect in front of this is only a
  // convenience and must never be the sole gate.
  const user = await getCurrentStaffUser();

  if (!user) {
    redirect("/admin/login");
  }

  const [reservations, restaurantDates, menu, timeZone] = await Promise.all([
    getReservationsList(),
    getRestaurantDates(),
    getFullMenuCatalog(),
    getTimeZone(),
  ]);

  /**
   * Worked out on the server, because that is the clock every time in this app
   * is computed against. Asking the browser would answer for the machine the
   * receptionist happens to be sitting at, which is not the one that matters.
   */
  const clockMismatch = describeClockMismatch(timeZone);

  const permissions = permissionsOf(user);

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

  /**
   * Links are hidden when the account cannot use them. This is presentation
   * only — every page and route behind these also checks the permission
   * itself, because hiding something is not access control.
   */
  const links = [
    { href: "/admin/reservation/new", label: "New reservation", permission: "reservations:create" as const, primary: true },
    { href: "/admin/pass-keys", label: "Pass-keys", permission: "passkeys:issue" as const },
    { href: "/admin/menu", label: "Menu editor", permission: "menu:edit" as const },
    { href: "/admin/menu?menu=premium", label: "Premium menu", permission: "menu:edit" as const },
    { href: "/admin/menu?menu=promo", label: "Promotions", permission: "menu:edit" as const },
    { href: "/admin/users", label: "Staff accounts", permission: "users:manage" as const },
  ].filter((link) => hasPermission(user, link.permission));

  return (
    <PageShell width="xl" headerHref="/admin" showLanguage={false}>
      <Card className="p-5 sm:p-6">
        <CardHeader
          as="h1"
          eyebrow={`Signed in as ${user.name}`}
          title="Staff dashboard"
          actions={
            <div className="flex flex-wrap items-center gap-3" data-print="hide">
              {links.map((link) => (
                <ButtonLink key={link.href} href={link.href} variant={link.primary ? "primary" : "secondary"}>
                  {link.label}
                </ButtonLink>
              ))}
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

      <AdminDateManager
        initialDates={restaurantDates}
        initialReservations={reservations}
        menu={menu}
        permissions={permissions}
        initialTimeZone={timeZone}
        clockMismatch={clockMismatch}
      />
    </PageShell>
  );
}
