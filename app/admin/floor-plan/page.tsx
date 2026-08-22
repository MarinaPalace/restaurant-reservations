import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { PageShell } from "@/components/page-shell";
import { FloorPlanDesigner } from "@/app/admin/floor-plan/floor-plan-designer";
import { getCurrentStaffUser } from "@/lib/auth/guard";
import { hasPermission } from "@/lib/auth/permissions";
import { getFloorPlan } from "@/lib/services/settings";

export const metadata: Metadata = { title: "Floor plan" };

/**
 * The restaurant designer — `docs/floor-plan.md` §5, and step 1 of §9.
 *
 * Staff draw the room; nothing reads it yet. Deliberately so: the plan changes
 * the unit of availability once bookings use it, which is the most delicate
 * code in the app (§2), and a drawn room is worth having before any of that.
 */
export const dynamic = "force-dynamic";

export default async function FloorPlanPage() {
  const user = await getCurrentStaffUser();

  if (!user) {
    redirect("/admin/login");
  }

  /**
   * Reading the room is open to any signed-in account — it says nothing about
   * any guest, and whoever is running service may want to look at it. Changing
   * it needs `floorplan:edit`, which the route enforces (rule 2.5); the flag
   * below only avoids offering controls that would be refused.
   */
  const canEdit = hasPermission(user, "floorplan:edit");

  return (
    <PageShell width="xl" headerHref="/admin" showLanguage={false}>
      <FloorPlanDesigner initialPlan={await getFloorPlan()} canEdit={canEdit} />
    </PageShell>
  );
}
