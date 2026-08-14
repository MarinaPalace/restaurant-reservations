import Link from "next/link";
import { Brand } from "@/components/brand";
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
      <Link href={href} className="group rounded-control">
        <Brand className="transition-opacity group-hover:opacity-80" />
      </Link>

      <ThemeToggle />
    </header>
  );
}
