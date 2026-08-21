import type { Metadata } from "next";
import { ConfirmationView } from "@/app/booking/confirmation/confirmation-view";
import { getPromoCatalog } from "@/lib/services/restaurant";
import { getCurrency } from "@/lib/services/settings";

export const metadata: Metadata = { title: "Reservation confirmed" };

// Staff can change the promotions at any time, so never serve a prerendered copy.
export const dynamic = "force-dynamic";

/**
 * The booking itself lives in sessionStorage and is read in the browser, so
 * the screen below is a client component. What is *offered* on it is not: the
 * promotions catalogue and the currency it is quoted in are fetched here and
 * handed down, which is the same shape the menu step uses.
 *
 * The alternative — the client fetching them after it mounts — costs a round
 * trip on the one screen a guest is most likely to close within seconds, and
 * makes the offer arrive after the confirmation it is attached to.
 *
 * The catalogue is sent untranslated and localized in the browser, so
 * switching language is instant rather than a round trip per change.
 */
export default async function ConfirmationPage() {
  const [promoGroups, currency] = await Promise.all([getPromoCatalog(), getCurrency()]);

  return <ConfirmationView promoGroups={promoGroups} currency={currency} />;
}
