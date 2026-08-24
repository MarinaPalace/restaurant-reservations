/**
 * Reading an image *address*, with nothing else attached.
 *
 * This lives apart from `menu-images.ts` for one reason: that module hashes,
 * so it imports `crypto`, and the uploader in the menu editor is a client
 * component. Importing the pair of them together drags a browser build of
 * `crypto` into the bundle to answer a question a regular expression answers.
 *
 * `menu-images.ts` re-exports this, so server code has one place to import
 * from and does not have to know the split exists.
 */

/**
 * The id is read from the path and the query is ignored on purpose: `?v=` is a
 * cache token, and a stale one still names the right record.
 */
const STORED_IMAGE_ROUTE = /^\/api\/menu\/images\/([^/?#]+)/;

/**
 * The record an image URL points at, or null if it points anywhere else.
 *
 * This is what lets a screen hold a photograph without holding its bytes. The
 * editor is handed `/api/menu/images/<id>?v=…` like everybody else, and when it
 * sends that back it is saying "the picture is the one already stored under
 * this id" rather than shipping half a megabyte of base64 back to prove it.
 */
export function storedImageIdFrom(imageUrl: string | undefined): string | null {
  if (!imageUrl) {
    return null;
  }

  const match = STORED_IMAGE_ROUTE.exec(imageUrl);
  return match ? decodeURIComponent(match[1]) : null;
}
