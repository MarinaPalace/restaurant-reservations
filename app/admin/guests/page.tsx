import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { PageShell } from "@/components/page-shell";
import { ButtonLink } from "@/components/ui/button";
import { GuestFinder } from "@/app/admin/guests/guest-finder";
import { getCurrentStaffUser } from "@/lib/auth/guard";

export const metadata: Metadata = { title: "Find a guest" };

/**
 * The desk lookup.
 *
 * Everything below the search happens in the browser — the answer depends on
 * what was just scanned, and nothing can be rendered before it. So this page is
 * a shell whose only job is the authorisation, which is checked here rather
 * than relied upon from the proxy redirect in front of it (rule 2.5).
 *
 * Open to any signed-in staff member, matching the dashboard: it shows rooms,
 * parties and reservation numbers, which is what the day's list beside it
 * already shows. The route behind it checks the same thing again.
 */
export default async function AdminGuestsPage() {
  const user = await getCurrentStaffUser();

  if (!user) {
    redirect("/admin/login");
  }

  return (
    <PageShell width="lg" headerHref="/admin" showLanguage={false}>
      <div className="mb-4" data-print="hide">
        <ButtonLink href="/admin" variant="secondary">
          Back to dashboard
        </ButtonLink>
      </div>

      <GuestFinder />
    </PageShell>
  );
}
