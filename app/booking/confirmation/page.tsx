"use client";

import { useRouter } from "next/navigation";
import { PageShell } from "@/components/page-shell";
import { Card, CardHeader } from "@/components/ui/card";
import { Button, ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/feedback";
import { clearBookingSession, useConfirmation } from "@/hooks/use-booking-session";
import { formatLongDate } from "@/lib/date";

/**
 * The reservation is read through the session store rather than during render:
 * the previous version called sessionStorage from a useMemo, so the server
 * rendered "no reservation found" while the client rendered the confirmation —
 * a hydration mismatch.
 */
export default function ConfirmationPage() {
  const router = useRouter();
  const reservation = useConfirmation();

  if (!reservation) {
    return (
      <PageShell width="sm">
        <Card className="p-6">
          <EmptyState
            title="No reservation found"
            description="This confirmation is only available in the browser tab where the booking was made."
            action={<ButtonLink href="/booking">Start a new reservation</ButtonLink>}
          />
        </Card>
      </PageShell>
    );
  }

  const guestGroups = Array.from({ length: Math.max(reservation.guestCount, 1) }, (_, guestIndex) => ({
    guestIndex,
    entries: reservation.selections.filter((entry) => (entry.guestIndex ?? 0) === guestIndex),
  }));

  return (
    <PageShell width="sm">
      <Card className="p-6">
        <div className="text-center">
          <div
            aria-hidden="true"
            className="mx-auto mb-4 flex size-14 items-center justify-center rounded-full bg-success-soft text-3xl text-success"
          >
            ✓
          </div>
          <CardHeader
            as="h1"
            align="center"
            title="Reservation confirmed"
            description="We look forward to welcoming you. Please arrive a few minutes early."
          />
        </div>

        <div className="mt-6 rounded-control border border-line bg-surface-muted p-4 text-center">
          <p className="eyebrow">Reservation number</p>
          <p className="mt-1 font-mono text-2xl font-semibold tracking-[0.18em] text-ink">
            {reservation.reservationNumber}
          </p>
        </div>

        <dl className="mt-5 space-y-3 rounded-control bg-surface-muted p-4 text-sm">
          <div className="flex justify-between gap-3">
            <dt className="text-ink-subtle">Room</dt>
            <dd className="font-semibold text-ink">{reservation.roomNumber}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-ink-subtle">Date</dt>
            <dd className="font-semibold text-ink">
              <time dateTime={reservation.date}>{formatLongDate(reservation.date)}</time>
            </dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-ink-subtle">Guests</dt>
            <dd className="font-semibold text-ink">{reservation.guestCount}</dd>
          </div>
        </dl>

        <div className="mt-5 space-y-3">
          {guestGroups.map(({ guestIndex, entries }) =>
            entries.length === 0 ? null : (
              <section key={guestIndex} className="rounded-control border border-line bg-surface-muted p-3">
                <h2 className="eyebrow">Guest {guestIndex + 1}</h2>
                <ul className="mt-2 space-y-2">
                  {entries.map((entry) => (
                    <li key={`${guestIndex}-${entry.courseId}`}>
                      <p className="text-xs font-medium uppercase tracking-wide text-ink-subtle">{entry.courseName}</p>
                      <p className="text-base font-semibold text-ink">{entry.optionName}</p>
                    </li>
                  ))}
                </ul>
              </section>
            ),
          )}
        </div>

        <div className="mt-6 flex flex-col gap-3 sm:flex-row" data-print="hide">
          <Button variant="secondary" size="lg" className="flex-1" onClick={() => window.print()}>
            Print
          </Button>
          <Button
            size="lg"
            className="flex-1"
            onClick={() => {
              clearBookingSession();
              router.push("/booking");
            }}
          >
            New reservation
          </Button>
        </div>
      </Card>
    </PageShell>
  );
}
