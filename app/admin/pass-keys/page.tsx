import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { PageShell } from "@/components/page-shell";
import { PassKeyManager } from "@/app/admin/pass-keys/pass-key-manager";
import { getCurrentStaffUser } from "@/lib/auth/guard";
import { hasPermission } from "@/lib/auth/permissions";
import { listPassKeys } from "@/lib/services/pass-keys";
import { RESTAURANT_NAME } from "@/lib/brand";
import { absoluteUrl, passKeyTargetUrl } from "@/lib/pass-key-links";
import { qrDataUris } from "@/lib/qr";

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

  const bookingUrl = `${host}/booking`;
  const invitationUrl = `${host}/premium`;

  /**
   * Drawn here, on the server, and handed to the cards already encoded. The
   * browser never has to fetch or generate one, which is what kept leaving an
   * empty square on the printed card.
   */
  const initialQrCodes = await qrDataUris(
    passKeys.map((key) => ({
      id: key.id,
      value: absoluteUrl(passKeyTargetUrl(key, { bookingUrl, invitationUrl })),
    })),
  );

  return (
    <PageShell width="xl" headerHref="/admin">
      <PassKeyManager
        initialPassKeys={passKeys}
        initialQrCodes={initialQrCodes}
        canDelete={hasPermission(user, "reservations:delete")}
        restaurantName={RESTAURANT_NAME}
      />
    </PageShell>
  );
}
