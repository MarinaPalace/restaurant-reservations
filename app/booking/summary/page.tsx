"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { PageShell } from "@/components/page-shell";
import { BookingSteps } from "@/components/booking-steps";
import { Card, CardHeader } from "@/components/ui/card";
import { Button, ButtonLink } from "@/components/ui/button";
import { Alert } from "@/components/ui/feedback";
import { Field, Input, Textarea } from "@/components/ui/field";
import { ContactFields } from "@/components/contact-fields";
import { useBookingGuard, storeConfirmation } from "@/hooks/use-booking-session";
import { useI18n } from "@/components/i18n-provider";
import { format, localeOf } from "@/lib/i18n";
import { translateApiError } from "@/lib/i18n/errors";
import { contactProblemOf, normalizeContact } from "@/lib/contact";
import { formatLongDate } from "@/lib/date";
import type { ReservationContact } from "@/types/booking";

export default function SummaryPage() {
  const router = useRouter();
  const { session, ready } = useBookingGuard(["room", "guests", "date", "selections"]);
  const { t, language } = useI18n();
  const locale = localeOf(language);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [contact, setContact] = useState<ReservationContact>({ method: "email", email: "", messagingApp: "phone" });
  const [contactError, setContactError] = useState("");
  const [notes, setNotes] = useState("");
  const [shareTable, setShareTable] = useState(false);
  const [joinNumber, setJoinNumber] = useState("");

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

    const contactProblem = contactProblemOf(contact);
    if (contactProblem) {
      setContactError(t.contact.problems[contactProblem]);
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
          // Proof that this is a guest of the hotel. Checked server-side; the
          // booking is refused outright without a live key.
          passKey: session.passKey,
          roomNumber: session.roomNumber,
          guestCount,
          date: session.date,
          selections: session.selections,
          contact: normalizeContact(contact),
          notes: notes.trim() || undefined,
          joinReservationNumber: shareTable && joinNumber.trim() ? joinNumber.trim().toUpperCase() : undefined,
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

        // The party they tried to join is the problem, not the booking.
        if (data.code === "TABLE_JOIN_FAILED") {
          setError(translateApiError(t, data) ?? t.errors.tableJoinFailed);
          setSubmitting(false);
          return;
        }

        // Something is wrong with the key itself, so send them back to the
        // step where they can correct it rather than leaving them stuck on a
        // summary they cannot submit.
        if (typeof data.code === "string" && data.code.startsWith("PASS_KEY_")) {
          setError(translateApiError(t, data) ?? t.errors.passKeyInvalid);
          setSubmitting(false);
          return;
        }

        setError(translateApiError(t, data) ?? t.summary.failed);
        setSubmitting(false);
        return;
      }

      storeConfirmation(data.reservation);
      router.push("/booking/confirmation");
    } catch {
      setError(t.common.connectionProblem);
      setSubmitting(false);
    }
  };

  return (
    <PageShell width="md">
      <BookingSteps current="summary" />
      <Card elevated className="aurora p-5 sm:p-8">
        <CardHeader as="h1" align="center" flourish eyebrow={t.summary.eyebrow} title={t.summary.title} />

        <dl className="mt-6 grid grid-cols-2 gap-4 rounded-control bg-surface-muted p-4">
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-ink-subtle">{t.common.room}</dt>
            <dd className="mt-1 text-lg font-semibold text-ink">{session.roomNumber || "—"}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-ink-subtle">{t.common.guests}</dt>
            <dd className="mt-1 text-lg font-semibold text-ink">{guestCount}</dd>
          </div>
          <div className="col-span-2">
            <dt className="text-xs font-medium uppercase tracking-wide text-ink-subtle">{t.common.date}</dt>
            <dd className="mt-1 text-lg font-semibold text-ink">
              {session.date ? <time dateTime={session.date}>{formatLongDate(session.date, locale)}</time> : "—"}
            </dd>
          </div>
        </dl>

        <div className="mt-6 space-y-4">
          {groupedSelections.map(({ guestIndex, entries }) => (
            <section key={guestIndex} className="rounded-control border border-line bg-surface-muted p-4">
              <h2 className="eyebrow">{format(t.common.guestNumber, { number: guestIndex + 1 })}</h2>
              {entries.length === 0 ? (
                <p className="mt-2 text-sm text-ink-muted">{t.summary.noChoices}</p>
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

        <div className="mt-6 space-y-4">
          <Field label={t.summary.notesLabel} hint={t.summary.notesHint}>
            {(fieldProps) => (
              <Textarea
                {...fieldProps}
                maxLength={500}
                placeholder={t.summary.notesPlaceholder}
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
              />
            )}
          </Field>

          <div className="rounded-control border border-line bg-surface-muted p-4">
            <label className="flex min-h-11 items-center gap-3 text-sm font-medium text-ink">
              <input
                type="checkbox"
                className="size-4 accent-[var(--primary)]"
                checked={shareTable}
                onChange={(event) => setShareTable(event.target.checked)}
              />
              {t.summary.shareTable}
            </label>

            {shareTable ? (
              <div className="mt-3">
                <Field label={t.summary.joinLabel} hint={t.summary.joinHint}>
                  {(fieldProps) => (
                    <Input
                      {...fieldProps}
                      value={joinNumber}
                      placeholder={t.summary.joinPlaceholder}
                      autoCapitalize="characters"
                      onChange={(event) => setJoinNumber(event.target.value.toUpperCase())}
                    />
                  )}
                </Field>
              </div>
            ) : null}
          </div>

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
            {t.common.back}
          </ButtonLink>
          <Button
            size="lg"
            className="flex-1"
            onClick={handleConfirm}
            disabled={!ready}
            loading={submitting}
            loadingLabel={t.summary.confirming}
          >
            {t.summary.confirm}
          </Button>
        </div>
      </Card>
    </PageShell>
  );
}
