import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageShell } from "@/components/page-shell";
import { PremiumBooking } from "@/app/premium/premium-booking";
import { getMenuCatalog, getRestaurantDates } from "@/lib/services/restaurant";
import { getPassKeyByCode, isPassKeyUsable } from "@/lib/services/pass-keys";
import { isValidPassKeyFormat, normalizePassKey } from "@/lib/pass-key";
import { todayKey } from "@/lib/date";

export const metadata: Metadata = {
  title: "An invitation",
  // Never indexed: the address contains a credential.
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

/**
 * An invitation opened straight from its link.
 *
 * The key is in the address so a guest can go from the email to the booking in
 * one tap, without copying a code across. That is a deliberate trade: it puts
 * the credential in browser history and in any Referer the page sends, which
 * is acceptable for a single-dinner invitation and would not be for anything
 * carrying money or personal data. The page is marked no-index, and the key is
 * still checked and spent server-side — this only saves the typing.
 */
export default async function PremiumInvitationPage({
  params,
}: {
  params: Promise<{ passKey: string }>;
}) {
  const { passKey: raw } = await params;
  const code = normalizePassKey(decodeURIComponent(raw));

  if (!isValidPassKeyFormat(code)) {
    notFound();
  }

  const passKey = await getPassKeyByCode(code);

  /**
   * A key that is not an invitation key, or is spent, expired or withdrawn,
   * gets the same 404 as one that never existed — so the address cannot be
   * used to work out which keys are real.
   */
  if (!passKey || passKey.kind !== "premium" || !isPassKeyUsable(passKey)) {
    notFound();
  }

  const [menu, dates] = await Promise.all([getMenuCatalog("en", "premium"), getRestaurantDates()]);
  const today = todayKey();

  const available = dates.filter(
    (entry) =>
      entry.premium &&
      entry.isOpen &&
      entry.date >= today &&
      (!passKey.expiresOn || entry.date <= passKey.expiresOn),
  );

  return (
    <PageShell width="lg">
      <PremiumBooking menu={menu} dates={available} initialPassKey={code} />
    </PageShell>
  );
}
