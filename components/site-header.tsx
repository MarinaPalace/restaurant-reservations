import Link from "next/link";
import { ThemeToggle } from "@/components/theme-toggle";
import { cx } from "@/components/ui/utils";

/**
 * A slim bar above every page: the restaurant's mark on the left, the theme
 * control on the right. Deliberately quiet — it should read as the header of a
 * menu card, not as application chrome.
 */
export function SiteHeader({ href = "/booking", className }: { href?: string; className?: string }) {
  return (
    <header
      data-print="hide"
      className={cx("mx-auto flex w-full items-center justify-between gap-4 px-4 pt-5 sm:pt-6", className)}
    >
      <Link href={href} className="group inline-flex items-center gap-3">
        <span
          aria-hidden="true"
          className="flex size-9 items-center justify-center rounded-full border border-gold/50 text-[13px] font-medium text-accent"
          style={{ fontFamily: "var(--font-display)" }}
        >
          ALC
        </span>
        <span className="leading-tight">
          <span className="block text-[13px] font-medium tracking-[0.18em] text-ink transition-colors group-hover:text-accent">
            À LA CARTE
          </span>
          <span className="block text-[10px] uppercase tracking-[0.22em] text-ink-subtle">Restaurant</span>
        </span>
      </Link>

      <ThemeToggle />
    </header>
  );
}
