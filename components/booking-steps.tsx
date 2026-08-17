import Link from "next/link";
import { cx } from "@/components/ui/utils";

export const BOOKING_STEPS = [
  { id: "room", label: "Your stay", href: "/booking" },
  { id: "guests", label: "Guests", href: "/booking/guests" },
  { id: "date", label: "Date", href: "/booking/date" },
  { id: "menu", label: "Menu", href: "/booking/menu" },
  { id: "summary", label: "Confirm", href: "/booking/summary" },
] as const;

export type BookingStepId = (typeof BOOKING_STEPS)[number]["id"];

/**
 * Where the guest is in the booking flow, and a way back to anything finished.
 *
 * Drawn as a rail with the progress filled in gold, rather than five separate
 * pills: a single continuous line reads as one journey with an end in sight,
 * which five chips never quite do. The fill animates its width, so arriving at
 * a step shows the line advancing rather than simply appearing further along.
 *
 * Steps ahead of the current one are inert, because the data they depend on
 * does not exist yet.
 */
export function BookingSteps({ current }: { current: BookingStepId }) {
  const currentIndex = BOOKING_STEPS.findIndex((step) => step.id === current);
  const progress = (currentIndex / (BOOKING_STEPS.length - 1)) * 100;

  return (
    <nav aria-label="Booking progress" className="mb-8">
      {/* Named for a screen reader; the rail itself is decorative. */}
      <p className="sr-only">
        Step {currentIndex + 1} of {BOOKING_STEPS.length}: {BOOKING_STEPS[currentIndex]?.label}
      </p>

      <div className="relative">
        {/* The rail, and the gold that has been earned so far. */}
        <div
          aria-hidden="true"
          className="absolute left-0 right-0 top-[0.6875rem] h-px overflow-hidden rounded-full bg-line"
        >
          <div
            className="h-full rounded-full bg-gradient-to-r from-accent to-gold"
            style={{
              width: `${progress}%`,
              transition: "width var(--motion-hero) var(--ease-settle)",
            }}
          />
        </div>

        <ol className="relative flex items-start justify-between">
          {BOOKING_STEPS.map((step, index) => {
            const isComplete = index < currentIndex;
            const isCurrent = index === currentIndex;

            const marker = (
              <span
                className={cx(
                  "relative flex size-[1.375rem] items-center justify-center rounded-full border text-[0.625rem] font-semibold",
                  "transition-[transform,background-color,border-color,box-shadow] duration-[--motion-element] ease-[--ease-settle]",
                  isCurrent && "border-accent bg-primary text-primary-fg",
                  isComplete && "border-gold bg-gold text-primary-fg",
                  !isCurrent && !isComplete && "border-line bg-canvas text-ink-subtle",
                )}
                style={
                  // The current step sits slightly forward of the rail; the
                  // rest lie flat on it.
                  isCurrent
                    ? {
                        transform: "perspective(var(--depth-perspective)) translateZ(10px) scale(1.14)",
                        boxShadow: "var(--lift-resting)",
                      }
                    : undefined
                }
              >
                {isComplete ? (
                  <svg viewBox="0 0 12 12" className="size-2.5" aria-hidden="true">
                    <path
                      d="M1.5 6.5 4.5 9.5 10.5 2.5"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.75"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                ) : (
                  index + 1
                )}
              </span>
            );

            const label = (
              <span
                className={cx(
                  "mt-2 hidden text-[0.6875rem] font-medium tracking-[0.14em] uppercase sm:block",
                  "transition-colors duration-[--motion-element]",
                  isCurrent ? "text-ink" : isComplete ? "text-ink-muted" : "text-ink-subtle",
                )}
              >
                {step.label}
              </span>
            );

            return (
              <li key={step.id} className="flex flex-col items-center">
                {isComplete ? (
                  <Link
                    href={step.href}
                    className="group flex flex-col items-center rounded-control px-1 focus-visible:outline-2"
                  >
                    <span className="transition-transform duration-[--motion-micro] group-hover:-translate-y-0.5">
                      {marker}
                    </span>
                    {label}
                  </Link>
                ) : (
                  <span
                    aria-current={isCurrent ? "step" : undefined}
                    className="flex flex-col items-center px-1"
                  >
                    {marker}
                    {label}
                  </span>
                )}
              </li>
            );
          })}
        </ol>
      </div>
    </nav>
  );
}
