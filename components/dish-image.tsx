import { cx } from "@/components/ui/utils";

/**
 * Dish photography comes from arbitrary URLs typed by staff and from base64
 * uploads stored on the course itself, so `next/image` cannot optimise it
 * without allow-listing every possible host. A plain lazy-loaded img with
 * fixed dimensions is the honest choice here.
 */
/* eslint-disable @next/next/no-img-element */
export function DishImage({
  src,
  alt,
  className,
  width,
  height,
}: {
  src?: string;
  alt: string;
  className?: string;
  width: number;
  height: number;
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

  return (
    <img
      src={src}
      // Decorative when it merely repeats the dish name next to it.
      alt={alt}
      width={width}
      height={height}
      loading="lazy"
      decoding="async"
      className={cx("rounded-control border border-line object-cover", className)}
    />
  );
}
