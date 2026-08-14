"use client";

import { useRouter } from "next/navigation";
import { PageShell } from "@/components/page-shell";
import { Card, CardHeader } from "@/components/ui/card";
import { Button, ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/feedback";
import { clearBookingSession, useConfirmation } from "@/hooks/use-booking-session";
import { buildGoogleCalendarUrl, buildIcsFile, describeReservationTime } from "@/lib/calendar";
import { formatContact, MESSAGING_APP_LABELS } from "@/lib/contact";
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

  /** Hands the guest an .ics file for any calendar that is not Google. */
  const downloadIcs = () => {
    if (!reservation) {
      return;
    }

    const blob = new Blob([buildIcsFile(reservation)], { type: "text/calendar;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = url;
    link.download = `reservation-${reservation.reservationNumber}.ics`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

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
          {reservation.time ? (
            <div className="flex justify-between gap-3">
              <dt className="text-ink-subtle">Arrival time</dt>
              <dd className="font-semibold text-ink">{reservation.time}</dd>
            </div>
          ) : null}
          <div className="flex justify-between gap-3">
            <dt className="text-ink-subtle">Guests</dt>
            <dd className="font-semibold text-ink">{reservation.guestCount}</dd>
          </div>
          {reservation.contact ? (
            <div className="flex justify-between gap-3">
              <dt className="text-ink-subtle">We will contact you on</dt>
              <dd className="text-right font-semibold text-ink">
                {formatContact(reservation.contact)}
                {reservation.contact.method === "phone" && reservation.contact.messagingApp ? (
                  <span className="block text-xs font-normal text-ink-muted">
                    via {MESSAGING_APP_LABELS[reservation.contact.messagingApp]}
                  </span>
                ) : null}
              </dd>
            </div>
          ) : null}
        </dl>

        {reservation.tableGroupId ? (
          <p className="mt-4 rounded-control border border-success/30 bg-success-soft p-3 text-sm font-medium text-success">
            You are seated with the other rooms in booking {reservation.tableGroupId}.
          </p>
        ) : (
          <p className="mt-4 rounded-control border border-line bg-surface-muted p-3 text-sm text-ink-muted">
            Dining with another room? Give them your reservation number and they can ask to share your table.
          </p>
        )}

        <div className="mt-5 rounded-control border border-line bg-surface-muted p-4" data-print="hide">
          <p className="text-sm font-medium text-ink">Add a reminder</p>
          <p className="mt-1 text-sm text-ink-muted">{describeReservationTime(reservation.date, reservation.time)}</p>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            <a
              href={buildGoogleCalendarUrl(reservation)}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-control bg-primary px-4 text-sm font-semibold text-primary-fg transition-colors hover:bg-primary-hover"
            >
              Google Calendar
              <span className="sr-only">(opens in a new tab)</span>
            </a>
            <Button variant="secondary" className="flex-1" onClick={downloadIcs}>
              Apple or Outlook
            </Button>
          </div>
        </div>

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
