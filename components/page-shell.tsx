import type { ReactNode } from "react";
import { SiteHeader } from "@/components/site-header";
import { cx } from "@/components/ui/utils";

const WIDTHS = {
  sm: "max-w-md",
  md: "max-w-2xl",
  lg: "max-w-4xl",
  xl: "max-w-6xl",
} as const;

/**
 * Standard page frame: the restaurant's header bar, then centred content with
 * a consistent gutter, and the `#main` landmark the skip link targets.
 */
export function PageShell({
  children,
  width = "md",
  className,
  headerHref,
  showLanguage = true,
}: {
  children: ReactNode;
  width?: keyof typeof WIDTHS;
  className?: string;
  /** Where the wordmark links to — the admin area points back at itself. */
  headerHref?: string;
  /** Staff screens are English, so they do not carry the language control. */
  showLanguage?: boolean;
}) {
  return (
    <>
      <SiteHeader href={headerHref} className={WIDTHS[width]} showLanguage={showLanguage} />
      <main id="main" className="flex flex-1 flex-col px-4 py-6 sm:py-8">
        <div className={cx("mx-auto w-full", WIDTHS[width], className)}>{children}</div>
      </main>
    </>
  );
}
