import type { ReactNode } from "react";
import { cx } from "@/components/ui/utils";

export function Card({
  children,
  className,
  as: Component = "div",
}: {
  children: ReactNode;
  className?: string;
  as?: "div" | "section" | "article";
}) {
  return (
    <Component className={cx("rounded-card border border-line bg-surface shadow-card", className)}>
      {children}
    </Component>
  );
}

export function CardHeader({
  eyebrow,
  title,
  description,
  align = "left",
  actions,
  titleId,
  as: Heading = "h2",
}: {
  eyebrow?: string;
  title: string;
  description?: ReactNode;
  align?: "left" | "center";
  actions?: ReactNode;
  titleId?: string;
  as?: "h1" | "h2" | "h3";
}) {
  return (
    <div
      className={cx(
        "flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between",
        align === "center" && "sm:flex-col sm:items-center",
      )}
    >
      <div className={cx("min-w-0", align === "center" && "text-center")}>
        {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
        <Heading
          id={titleId}
          className={cx(
            "mt-2 font-semibold tracking-tight text-balance text-ink",
            Heading === "h1" ? "text-3xl sm:text-4xl" : "text-2xl sm:text-3xl",
          )}
        >
          {title}
        </Heading>
        {description ? <div className="mt-2 text-pretty text-ink-muted">{description}</div> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-3">{actions}</div> : null}
    </div>
  );
}
