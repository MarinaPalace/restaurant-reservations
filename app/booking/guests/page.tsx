"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PageShell } from "@/components/page-shell";
import { BookingSteps } from "@/components/booking-steps";
import { Card, CardHeader } from "@/components/ui/card";
import { Button, ButtonLink } from "@/components/ui/button";
import { Alert, Skeleton } from "@/components/ui/feedback";
import { useBookingGuard, writeBookingSession } from "@/hooks/use-booking-session";
import { useI18n } from "@/components/i18n-provider";
import { format, plural } from "@/lib/i18n";
import { allowedGuestCount, pruneSelectionsToGuestCount } from "@/lib/booking-session";
import { cx } from "@/components/ui/utils";

export default function GuestsPage() {
  const router = useRouter();
  const { session, ready } = useBookingGuard(["room"]);
  const { t, language } = useI18n();
  const [choice, setChoice] = useState<number | null>(null);
  const [error, setError] = useState("");

  /**
   * The party size on the hotel booking, which reception recorded on the key.
   * Fewer is fine — people drop out of dinner — but more was never held for
   * them, so the larger numbers are simply not offered. The server refuses
   * them regardless; this only stops the guest choosing something that would
   * be rejected at the end.
   */
  const allowed = allowedGuestCount(session);
  const guestOptions = Array.from({ length: allowed }, (_, index) => index + 1);

  // A party size left over from a previous key could exceed this one.
  const stored = session.guestCount > 0 && session.guestCount <= allowed ? session.guestCount : null;
  const selected = choice ?? stored;

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();

    if (!selected) {
      setError(t.guests.choose);
      return;
    }

    /**
     * Checked again here, not just when the buttons were drawn. Before the
     * session has loaded the limit is unknown, and a choice made in that
     * moment must not survive into the booking.
     */
    if (selected > allowed) {
      setChoice(null);
      setError(plural(language, allowed, t.guests.tooMany));
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
      <Card elevated className="p-6 sm:p-8">
        <CardHeader
          as="h1"
          align="center"
          flourish
          eyebrow={
            ready && session.roomNumber
              ? format(t.guests.roomEyebrow, { room: session.roomNumber })
              : t.common.room
          }
          title={t.guests.title}
          description={t.guests.description}
        />

        {ready && session.passKeyMaxGuests > 0 ? (
          <p className="mt-4 rounded-control border border-line bg-surface-muted p-3 text-center text-sm text-ink-muted">
            {format(t.guests.bookingIsFor, {
              guests: plural(language, session.passKeyMaxGuests, t.common.guestCount),
            })}
          </p>
        ) : null}

        {/*
          The picker waits for the session. Rendering the full six and shrinking
          them a moment later both looks wrong and, for the fastest tapper,
          offers a number the key does not allow.
        */}
        {!ready ? (
          <div className="mt-6 grid grid-cols-3 gap-3" aria-hidden="true">
            {[0, 1, 2, 3, 4, 5].map((placeholder) => (
              <Skeleton key={placeholder} className="h-[4.75rem]" />
            ))}
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="mt-6">
            <fieldset>
              <legend className="sr-only">{t.guests.legend}</legend>
              <div
                role="radiogroup"
                aria-label={t.guests.legend}
                className={cx("grid gap-3", guestOptions.length <= 2 ? "grid-cols-2" : "grid-cols-3")}
              >
                {guestOptions.map((option) => {
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
                        // A physical chip. The chosen one lifts toward the
                        // reader on a pointer device only — see `.chosen-chip`
                        // in globals.css. It used to do so on a phone too,
                        // remounting to replay the animation, which moved the
                        // buttons around the finger that had just pressed one.
                        "lift chosen-chip rounded-control border px-4 py-5 text-center text-2xl font-semibold",
                        isSelected
                          ? "border-accent bg-primary text-primary-fg"
                          : "border-line-strong bg-surface text-ink hover:border-accent",
                      )}
                    >
                      {option}
                      <span className="sr-only"> {plural(language, option, t.common.guestWord)}</span>
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
                {t.common.back}
              </ButtonLink>
              <Button type="submit" size="lg" disabled={!selected} className="flex-1">
                {t.common.continue}
              </Button>
            </div>
          </form>
        )}
      </Card>
    </PageShell>
  );
}
