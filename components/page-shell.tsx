import type { ReactNode } from "react";
import { cx } from "@/components/ui/utils";

/**
 * Standard page frame: centres content, keeps a consistent gutter on small
 * screens, and provides the `#main` landmark the skip link targets.
 */
export function PageShell({
  children,
  width = "md",
  className,
}: {
  children: ReactNode;
  width?: "sm" | "md" | "lg" | "xl";
  className?: string;
}) {
  const widths = {
    sm: "max-w-md",
    md: "max-w-2xl",
    lg: "max-w-4xl",
    xl: "max-w-6xl",
  } as const;

  return (
    <main id="main" className="flex flex-1 flex-col px-4 py-6 sm:py-10">
      <div className={cx("mx-auto w-full", widths[width], className)}>{children}</div>
    </main>
  );
}
