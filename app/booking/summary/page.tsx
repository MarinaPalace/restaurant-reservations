"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { PageShell } from "@/components/page-shell";
import { BookingSteps } from "@/components/booking-steps";
import { Card, CardHeader } from "@/components/ui/card";
import { Button, ButtonLink } from "@/components/ui/button";
import { Alert } from "@/components/ui/feedback";
import { ContactFields } from "@/components/contact-fields";
import { useBookingGuard, storeConfirmation } from "@/hooks/use-booking-session";
import { describeContactProblem, normalizeContact } from "@/lib/contact";
import { formatLongDate } from "@/lib/date";
import type { ReservationContact } from "@/types/booking";

export default function SummaryPage() {
  const router = useRouter();
  const { session, ready } = useBookingGuard(["room", "guests", "date", "selections"]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [contact, setContact] = useState<ReservationContact>({ method: "email", email: "", messagingApp: "phone" });
  const [contactError, setContactError] = useState("");

  const guestCount = Math.max(session.guestCount, 1);

  const groupedSelections = useMemo(
    () =>
      Array.from({ length: guestCount }, (_, guestIndex) => ({
        guestIndex,
        entries: session.selections.filter((entry) => (entry.guestIndex ?? 0) === guestIndex),
      })),
    [guestCount, session.selections],
  );

  const handleConfirm = async () => {
    // Guards against a double tap creating two reservations.
    if (submitting) {
      return;
    }

    const contactProblem = describeContactProblem(contact);
    if (contactProblem) {
      setContactError(contactProblem);
      return;
    }

    setSubmitting(true);
    setError("");
    setContactError("");

    try {
      const response = await fetch("/api/reservations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          roomNumber: Number(session.roomNumber),
          guestCount,
          date: session.date,
          selections: session.selections,
          contact: normalizeContact(contact),
        }),
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        // The server tells us whether the date is the problem, instead of the
        // client guessing from the wording of the message.
        if (data.code === "DATE_UNAVAILABLE") {
          router.push("/booking/date");
          return;
        }

        setError(data.error || "Something went wrong while creating your reservation. Please try again.");
        setSubmitting(false);
        return;
      }

      storeConfirmation(data.reservation);
      router.push("/booking/confirmation");
    } catch {
      setError("We could not reach the restaurant. Please check your connection and try again.");
      setSubmitting(false);
    }
  };

  return (
    <PageShell width="md">
      <BookingSteps current="summary" />
      <Card className="p-5 sm:p-6">
        <CardHeader as="h1" align="center" eyebrow="À la carte restaurant" title="Review your reservation" />

        <dl className="mt-6 grid grid-cols-2 gap-4 rounded-control bg-surface-muted p-4">
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-ink-subtle">Room</dt>
            <dd className="mt-1 text-lg font-semibold text-ink">{session.roomNumber || "—"}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-ink-subtle">Guests</dt>
            <dd className="mt-1 text-lg font-semibold text-ink">{guestCount}</dd>
          </div>
          <div className="col-span-2">
            <dt className="text-xs font-medium uppercase tracking-wide text-ink-subtle">Date</dt>
            <dd className="mt-1 text-lg font-semibold text-ink">
              {session.date ? <time dateTime={session.date}>{formatLongDate(session.date)}</time> : "—"}
            </dd>
          </div>
        </dl>

        <div className="mt-6 space-y-4">
          {groupedSelections.map(({ guestIndex, entries }) => (
            <section key={guestIndex} className="rounded-control border border-line bg-surface-muted p-4">
              <h2 className="eyebrow">Guest {guestIndex + 1}</h2>
              {entries.length === 0 ? (
                <p className="mt-2 text-sm text-ink-muted">No menu choices selected yet.</p>
              ) : (
                <ul className="mt-3 space-y-2">
                  {entries.map((entry) => (
                    <li
                      key={`${guestIndex}-${entry.courseId}`}
                      className="rounded-control border border-line bg-surface px-3 py-2"
                    >
                      <p className="eyebrow">{entry.courseName}</p>
                      <p className="mt-1 text-base font-semibold text-ink">{entry.optionName}</p>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ))}
        </div>

        <div className="mt-6">
          <ContactFields
            contact={contact}
            onChange={(next) => {
              setContact(next);
              setContactError("");
            }}
            error={contactError}
          />
        </div>

        {error ? (
          <Alert tone="danger" className="mt-5">
            {error}
          </Alert>
        ) : null}

        <div className="mt-6 flex flex-col gap-3 sm:flex-row">
          <ButtonLink href="/booking/menu" size="lg" className="flex-1">
            Back
          </ButtonLink>
          <Button
            size="lg"
            className="flex-1"
            onClick={handleConfirm}
            disabled={!ready}
            loading={submitting}
            loadingLabel="Confirming…"
          >
            Confirm reservation
          </Button>
        </div>
      </Card>
    </PageShell>
  );
}
