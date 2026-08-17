import { formatPassKey } from "@/lib/pass-key";
import type { PassKeyRecord } from "@/types/booking";

/**
 * Where a card's QR code and printed address point.
 *
 * Shared by the page that lists existing keys and the route that issues new
 * ones, so a reprinted card and a freshly printed one always carry the same
 * address. When these were worked out in two places they drifted.
 */
export function passKeyTargetUrl(
  key: Pick<PassKeyRecord, "code" | "kind">,
  urls: { bookingUrl: string; invitationUrl: string },
) {
  const code = formatPassKey(key.code);

  return key.kind === "premium"
    ? `${urls.invitationUrl}/${code}`
    : // The key travels in the link, so scanning lands on the entry step with
      // it already filled in and only the room left to confirm.
      `${urls.bookingUrl}?k=${code}`;
}

/**
 * The link to self-service, carrying the key when we have one.
 *
 * The key travels in the address here — unlike everywhere else, where it is
 * kept out of URLs — because a guest who has just scanned their card and taps
 * "change or cancel" has nothing in the session yet: the key is only stored
 * once it has been checked. Without this they would be asked to type by hand
 * the code they just scanned.
 */
export function manageHref(code?: string | null) {
  const normalized = code ? formatPassKey(code) : "";

  return normalized ? `/booking/manage?k=${encodeURIComponent(normalized)}` : "/booking/manage";
}

/** The same address, absolute, which is what a QR code has to encode. */
export function absoluteUrl(url: string) {
  return url.startsWith("http://") || url.startsWith("https://") ? url : `https://${url}`;
}
