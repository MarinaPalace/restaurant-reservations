import Image from "next/image";
import { cx } from "@/components/ui/utils";

/**
 * Dish photography arrives from two places, and they want opposite treatment.
 *
 * Uploads are stored on the record and served from `/api/menu/images/…` — our
 * own origin, our own bytes, a content hash in the URL. Those go through
 * `next/image`, which re-encodes them to AVIF or WebP at the width the device
 * actually paints and caches the result at the edge. A 500 KB JPEG that every
 * phone downloaded at full desktop size becomes a fraction of that.
 *
 * Everything else — an address typed by staff, a `data:` preview in the editor
 * before anything is saved — cannot be optimised without allow-listing hosts
 * we do not control, and stays a plain `img`. That was the original reasoning
 * here and it still holds; it was only ever wrong about the uploads.
 */
/* eslint-disable @next/next/no-img-element */

const STORED_IMAGE_PREFIX = "/api/menu/images/";

/**
 * Our own images are the ones we may re-encode. Checked by prefix rather than
 * by "not a data URL", so a future external host cannot fall through into the
 * optimiser by accident.
 */
function isOptimisable(src: string) {
  return src.startsWith(STORED_IMAGE_PREFIX);
}

export function DishImage({
  src,
  alt,
  className,
  width,
  height,
  priority = false,
  sizes,
}: {
  src?: string;
  alt: string;
  className?: string;
  width: number;
  height: number;
  /**
   * Set on the photographs already on screen when the page opens. It drops the
   * lazy flag, asks for high priority, and preloads the source — a lazy image
   * is invisible to the browser's preload scanner, so the one picture the
   * guest is actually waiting for was the last one to be requested.
   *
   * Worth setting on at most the first course or two: made eager, every photo
   * competes with every other and none of them arrive sooner.
   */
  priority?: boolean;
  /**
   * What width this will actually be painted at, for images that stretch —
   * a full-bleed hero has no fixed width for the optimiser to reason from.
   *
   * Leave it unset for a fixed-size thumbnail. `next/image` then offers just
   * that width and its retina double, which is the whole point: the editor's
   * 64px thumbnail should fetch 64px, not the 500 KB the photograph started
   * as. Passing a viewport-relative value here would undo exactly that.
   */
  sizes?: string;
}) {
  if (!src) {
    return (
      <div
        aria-hidden="true"
        className={cx(
          "flex items-center justify-center rounded-control border border-line bg-surface-sunken text-2xl",
          className,
        )}
      >
        🍽
      </div>
    );
  }

  const classes = cx("rounded-control border border-line object-cover", className);

  if (isOptimisable(src)) {
    return (
      <Image
        src={src}
        // Decorative when it merely repeats the dish name next to it.
        alt={alt}
        width={width}
        height={height}
        sizes={sizes}
        priority={priority}
        className={classes}
      />
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      width={width}
      height={height}
      loading={priority ? "eager" : "lazy"}
      fetchPriority={priority ? "high" : "auto"}
      decoding="async"
      className={classes}
    />
  );
}
