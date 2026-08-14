import type { ReactNode } from "react";
import { cx } from "@/components/ui/utils";

type Tone = "danger" | "success" | "info" | "warning";

const tones: Record<Tone, string> = {
  danger: "border-danger/30 bg-danger-soft text-danger",
  success: "border-success/30 bg-success-soft text-success",
  info: "border-line bg-surface-muted text-ink-muted",
  warning: "border-warning/30 bg-warning-soft text-warning",
};

/**
 * Errors are announced assertively so a guest using a screen reader hears why
 * their booking was refused; quieter tones use a polite live region.
 */
export function Alert({ tone = "info", children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return (
    <p
      role={tone === "danger" ? "alert" : "status"}
      className={cx("rounded-control border p-3 text-sm font-medium", tones[tone], className)}
    >
      {children}
    </p>
  );
}

export function Badge({ tone = "info", children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span className={cx("inline-flex rounded-full border px-3 py-1 text-xs font-semibold", tones[tone])}>
      {children}
    </span>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden="true" className={cx("animate-pulse rounded-control bg-surface-sunken", className)} />;
}

export function EmptyState({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="rounded-control border border-dashed border-line-strong bg-surface-muted p-6 text-center">
      <p className="font-semibold text-ink">{title}</p>
      {description ? <p className="mt-2 text-sm text-ink-muted">{description}</p> : null}
      {action ? <div className="mt-4 flex justify-center">{action}</div> : null}
    </div>
  );
}
