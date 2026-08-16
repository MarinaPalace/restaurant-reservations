import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { PageShell } from "@/components/page-shell";
import { PassKeyManager } from "@/app/admin/pass-keys/pass-key-manager";
import { getCurrentStaffUser } from "@/lib/auth/guard";
import { hasPermission } from "@/lib/auth/permissions";
import { listPassKeys } from "@/lib/services/pass-keys";

export const metadata: Metadata = { title: "Pass-keys" };

export const dynamic = "force-dynamic";

export default async function AdminPassKeysPage() {
  const user = await getCurrentStaffUser();

  if (!user) {
    redirect("/admin/login");
  }

  if (!hasPermission(user, "passkeys:issue")) {
    redirect("/admin");
  }

  /**
   * The address printed on the guest's slip is derived from the request, so
   * the slip is right on whatever host the hotel actually runs this on rather
   * than a hard-coded domain that goes stale.
   */
  const headerList = await headers();
  const host = headerList.get("x-forwarded-host") ?? headerList.get("host") ?? "";

  const passKeys = await listPassKeys();

  return (
    <PageShell width="xl" headerHref="/admin">
      <PassKeyManager initialPassKeys={passKeys} bookingUrl={`${host}/booking`} />
    </PageShell>
  );
}
