"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PageShell } from "@/components/page-shell";
import { BookingSteps } from "@/components/booking-steps";
import { Card, CardHeader } from "@/components/ui/card";
import { Button, ButtonLink } from "@/components/ui/button";
import { Alert } from "@/components/ui/feedback";
import { useBookingGuard, writeBookingSession } from "@/hooks/use-booking-session";
import { pruneSelectionsToGuestCount } from "@/lib/booking-session";
import { MAX_GUESTS_PER_RESERVATION } from "@/lib/validation/booking";
import { cx } from "@/components/ui/utils";

const GUEST_OPTIONS = Array.from({ length: MAX_GUESTS_PER_RESERVATION }, (_, index) => index + 1);

export default function GuestsPage() {
  const router = useRouter();
  const { session, ready } = useBookingGuard(["room"]);
  const [choice, setChoice] = useState<number | null>(null);
  const [error, setError] = useState("");

  const selected = choice ?? (session.guestCount > 0 ? session.guestCount : null);

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();

    if (!selected) {
      setError("Please choose how many guests will be dining.");
      return;
    }

    // Reducing the party size must drop the menu choices of guests who are no
    // longer coming, or the summary would submit stale selections.
    writeBookingSession({
      guestCount: selected,
      selections: pruneSelectionsToGuestCount(session.selections, selected),
    });
    router.push("/booking/date");
  };

  return (
    <PageShell width="sm">
      <BookingSteps current="guests" />
      <Card className="p-6 sm:p-8">
        <CardHeader
          as="h1"
          align="center"
          flourish
          eyebrow={ready && session.roomNumber ? `Room ${session.roomNumber}` : "Room"}
          title="How many guests?"
          description="Every guest chooses their own menu on the next step."
        />

        <form onSubmit={handleSubmit} className="mt-6">
          <fieldset>
            <legend className="sr-only">Number of guests</legend>
            <div role="radiogroup" aria-label="Number of guests" className="grid grid-cols-3 gap-3">
              {GUEST_OPTIONS.map((option) => {
                const isSelected = selected === option;

                return (
                  <button
                    key={option}
                    type="button"
                    role="radio"
                    aria-checked={isSelected}
                    onClick={() => {
                      setChoice(option);
                      setError("");
                    }}
                    className={cx(
                      "rounded-control border px-4 py-5 text-center text-2xl font-semibold transition-colors",
                      isSelected
                        ? "border-primary bg-primary text-primary-fg"
                        : "border-line-strong bg-surface text-ink hover:border-accent",
                    )}
                  >
                    {option}
                    <span className="sr-only"> {option === 1 ? "guest" : "guests"}</span>
                  </button>
                );
              })}
            </div>
          </fieldset>

          {error ? (
            <Alert tone="danger" className="mt-4">
              {error}
            </Alert>
          ) : null}

          <div className="mt-6 flex flex-col gap-3 sm:flex-row">
            <ButtonLink href="/booking" size="lg" className="flex-1">
              Back
            </ButtonLink>
            <Button type="submit" size="lg" disabled={!selected} className="flex-1">
              Continue
            </Button>
          </div>
        </form>
      </Card>
    </PageShell>
  );
}
