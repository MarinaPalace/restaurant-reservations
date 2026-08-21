import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { PageShell } from "@/components/page-shell";
import { ServiceBoard } from "@/app/admin/service/service-board";
import { getCurrentStaffUser } from "@/lib/auth/guard";
import { hasPermission } from "@/lib/auth/permissions";
import { getReservationsList } from "@/lib/services/reservations";
import { getFullMenuCatalog } from "@/lib/services/restaurant";
import { buildBoard } from "@/lib/service-board";
import { isValidDateKey, todayKey } from "@/lib/date";
import { menuKindOf } from "@/types/booking";

export const metadata: Metadata = { title: "Service board" };

// The board is the live state of an evening; nothing here may be prerendered.
export const dynamic = "force-dynamic";

/**
 * The service board, at `/admin/service`.
 *
 * Its own route rather than a layout on the dashboard, because it runs on a
 * tablet at the pass: a calendar, a date editor and a print button are noise
 * around the one control being used, and every one of them is a mis-tap that
 * navigates away mid-service. See `docs/service-tracking.md` §3.
 *
 * The board is rebuilt here on every refresh, which is what the client's poll
 * calls — one aggregation, no second endpoint.
 */
export default async function ServicePage({ searchParams }: PageProps<"/admin/service">) {
  const user = await getCurrentStaffUser();

  if (!user) {
    redirect("/admin/login");
  }

  /**
   * Reading the board needs only a signed-in account — anyone on the floor may
   * look. *Marking* it needs `service:record`, which the route enforces
   * (rule 2.5); the flag below only avoids offering a control that would fail.
   */
  const canRecord = hasPermission(user, "service:record");

  const params = await searchParams;
  const requested = typeof params.date === "string" && isValidDateKey(params.date) ? params.date : null;
  const date = requested ?? todayKey();

  const [reservations, menu] = await Promise.all([getReservationsList(), getFullMenuCatalog()]);

  /**
   * Dishes are named from the everyday catalogue unless this evening is served
   * from the premium one — the same rule the sheet follows, and the reason
   * `menuKindOf` returns null for promotions: a bottle of wine is not a course
   * to be served off this board.
   */
  const evening = reservations.filter((reservation) => reservation.date === date);
  const kind = evening.some((reservation) => reservation.kind === "premium") ? "premium" : "standard";
  const courses = menu.filter((course) => menuKindOf(course) === kind);

  return (
    <PageShell width="xl" headerHref="/admin" showLanguage={false}>
      <ServiceBoard
        initialTables={buildBoard(evening, courses)}
        date={date}
        isToday={date === todayKey()}
        canRecord={canRecord}
      />
    </PageShell>
  );
}
