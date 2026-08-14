import Link from "next/link";
import { cx } from "@/components/ui/utils";

export const BOOKING_STEPS = [
  { id: "room", label: "Room", href: "/booking" },
  { id: "guests", label: "Guests", href: "/booking/guests" },
  { id: "date", label: "Date", href: "/booking/date" },
  { id: "menu", label: "Menu", href: "/booking/menu" },
  { id: "summary", label: "Confirm", href: "/booking/summary" },
] as const;

export type BookingStepId = (typeof BOOKING_STEPS)[number]["id"];

/**
 * Shows where the guest is in the booking flow and lets them jump back to a
 * completed step. Steps ahead of the current one are inert, because the data
 * they depend on does not exist yet.
 */
export function BookingSteps({ current }: { current: BookingStepId }) {
  const currentIndex = BOOKING_STEPS.findIndex((step) => step.id === current);

  return (
    <nav aria-label="Booking progress" className="mb-6">
      <ol className="flex flex-wrap items-center justify-center gap-x-2 gap-y-2">
        {BOOKING_STEPS.map((step, index) => {
          const isComplete = index < currentIndex;
          const isCurrent = index === currentIndex;

          const content = (
            <span
              className={cx(
                "flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors",
                isCurrent && "border-primary bg-primary text-primary-fg",
                isComplete && "border-line-strong bg-surface text-ink hover:border-accent",
                !isCurrent && !isComplete && "border-line bg-surface-muted text-ink-subtle",
              )}
            >
              <span
                aria-hidden="true"
                className={cx(
                  "flex size-5 items-center justify-center rounded-full text-[10px]",
                  isCurrent ? "bg-primary-fg/20" : "bg-surface-sunken",
                )}
              >
                {isComplete ? "✓" : index + 1}
              </span>
              {step.label}
            </span>
          );

          return (
            <li key={step.id} className="flex items-center gap-2">
              {isComplete ? (
                <Link href={step.href} aria-current={undefined}>
                  {content}
                </Link>
              ) : (
                <span aria-current={isCurrent ? "step" : undefined}>
                  {content}
                  {isCurrent ? <span className="sr-only"> (current step)</span> : null}
                </span>
              )}
              {index < BOOKING_STEPS.length - 1 ? (
                <span aria-hidden="true" className="hidden text-ink-subtle sm:inline">
                  ·
                </span>
              ) : null}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
