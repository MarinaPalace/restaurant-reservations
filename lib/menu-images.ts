import { createHash } from "crypto";

/**
 * Uploaded dish photos are stored on the record as data URLs. Sending those
 * inline in the menu response would mean every guest re-downloads every photo
 * on every page load, because a data URL cannot be cached separately.
 *
 * Instead the guest-facing menu carries a short URL pointing at
 * /api/menu/images/<id>, which is served with immutable cache headers. The
 * content hash in the query string changes whenever staff replace a photo, so
 * the new picture appears immediately despite the long cache lifetime.
 */

const DATA_URL_PATTERN = /^data:(image\/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=\s]+)$/;

export function isStoredImage(imageUrl: string | undefined): boolean {
  return Boolean(imageUrl && imageUrl.startsWith("data:"));
}

export function decodeStoredImage(imageUrl: string): { contentType: string; body: Buffer } | null {
  const match = DATA_URL_PATTERN.exec(imageUrl);
  if (!match) {
    return null;
  }

  try {
    return { contentType: match[1], body: Buffer.from(match[2], "base64") };
  } catch {
    return null;
  }
}

export function imageVersion(imageUrl: string) {
  return createHash("sha1").update(imageUrl).digest("hex").slice(0, 12);
}

/**
 * Rewrites a stored image to a cacheable URL. External addresses typed by
 * staff are passed through untouched.
 */
export function toPublicImageUrl(id: string, imageUrl: string | undefined): string {
  if (!imageUrl) {
    return "";
  }

  if (!isStoredImage(imageUrl)) {
    return imageUrl;
  }

  return `/api/menu/images/${encodeURIComponent(id)}?v=${imageVersion(imageUrl)}`;
}
