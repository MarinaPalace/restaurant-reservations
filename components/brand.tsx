import { RESTAURANT_NAME, RESTAURANT_TAGLINE } from "@/lib/brand";
import { cx } from "@/components/ui/utils";

/**
 * The house mark: a sea view seen through an arched window.
 *
 * "Vista Del Mar" is a view of the sea, so the emblem is exactly that — an
 * arch, a sun low over the horizon, and water beneath it. Drawn as strokes in
 * `currentColor` so it inherits the brass accent in both themes, stays crisp
 * at favicon size, and prints as clean line art rather than a grey block.
 */
export function BrandMark({ className, title }: { className?: string; title?: string }) {
  return (
    <svg
      viewBox="0 0 48 48"
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : "true"}
      aria-label={title}
      className={cx("size-10", className)}
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
    >
      {/* The arch the view is framed by. */}
      <path d="M9.5 41.5V21a14.5 14.5 0 0 1 29 0v20.5" strokeWidth="1.6" />

      {/* Sun sitting on the horizon; the lower half is hidden by the water. */}
      <path d="M18.4 26.5a5.6 5.6 0 0 1 11.2 0" strokeWidth="1.6" />

      {/* The horizon itself, held just inside the arch. */}
      <path d="M11.6 26.5h24.8" strokeWidth="1.4" opacity="0.85" />

      {/* Two swells, the lower one wider as the eye comes closer to shore. */}
      <path d="M12.6 32.4c2.4 0 2.4 2 4.8 2s2.4-2 4.8-2 2.4 2 4.8 2 2.4-2 4.8-2 2.4 2 4.8 2" strokeWidth="1.5" />
      <path d="M11.2 37.6c2.6 0 2.6 2 5.2 2s2.6-2 5.2-2 2.6 2 5.2 2 2.6-2 5.2-2" strokeWidth="1.5" opacity="0.75" />

      {/* The sill the arch stands on. */}
      <path d="M6.5 41.5h35" strokeWidth="1.6" />
    </svg>
  );
}

/**
 * The mark with the name set beside it. `stacked` is the guest-facing lockup;
 * the compact form is for the header bar.
 */
export function Brand({
  className,
  stacked = false,
  tagline = RESTAURANT_TAGLINE,
}: {
  className?: string;
  stacked?: boolean;
  tagline?: string;
}) {
  if (stacked) {
    return (
      <span className={cx("flex flex-col items-center text-center", className)}>
        <BrandMark className="size-14 text-accent" />
        <span className="display mt-3 text-2xl tracking-[0.12em] text-ink">{RESTAURANT_NAME.toUpperCase()}</span>
        <span className="mt-1 text-[10px] uppercase tracking-[0.3em] text-ink-subtle">{tagline}</span>
      </span>
    );
  }

  return (
    <span className={cx("inline-flex items-center gap-3", className)}>
      <BrandMark className="size-9 shrink-0 text-accent" />
      <span className="leading-tight">
        <span className="display block text-lg tracking-[0.1em] text-ink">{RESTAURANT_NAME}</span>
        <span className="block text-[10px] uppercase tracking-[0.26em] text-ink-subtle">{tagline}</span>
      </span>
    </span>
  );
}
