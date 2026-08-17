import Link from "next/link";
import { Brand } from "@/components/brand";
import { ThemeToggle } from "@/components/theme-toggle";
import { LanguageSwitcher } from "@/components/language-switcher";
import { cx } from "@/components/ui/utils";

/**
 * A slim bar above every page: the restaurant's mark on the left, the guest's
 * controls on the right. Deliberately quiet — it should read as the header of a
 * menu card, not as application chrome.
 *
 * The language control is shown on guest screens only. Staff work in English,
 * and a language picker in a working tool is one more thing to knock by
 * accident on a busy evening.
 */
export function SiteHeader({
  href = "/booking",
  className,
  showLanguage = true,
}: {
  href?: string;
  className?: string;
  showLanguage?: boolean;
}) {
  return (
    <header
      data-print="hide"
      className={cx("mx-auto flex w-full items-center justify-between gap-3 px-4 pt-5 sm:pt-6", className)}
    >
      <Link href={href} className="group rounded-control">
        <Brand className="transition-opacity group-hover:opacity-80" />
      </Link>

      <div className="flex items-center gap-2">
        {showLanguage ? <LanguageSwitcher /> : null}
        <ThemeToggle />
      </div>
    </header>
  );
}
