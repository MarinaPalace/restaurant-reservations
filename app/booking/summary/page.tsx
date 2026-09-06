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
import { releaseSeatHold } from "@/hooks/use-seat-hold";
import { SeatHoldBanner } from "@/components/seat-hold-banner";
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
  /**
   * Where this booking failed, when the answer is somewhere else in the flow.
   *
   * The screen used to navigate the moment the server said no, and a guest who
   * lost the last seats simply found themselves back on the calendar with
   * nothing said. Now the reason goes on the summary and the way out is a
   * button underneath it, so leaving this page is always something the guest
   * did rather than something that happened to them.
   */
  const [failureRoute, setFailureRoute] = useState<{ href: string; label: string } | null>(null);
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
    setFailureRoute(null);

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
          /**
           * Answered on the table step when guests choose their own table, and
           * here when they do not. Whichever asked it, exactly one answer is
           * sent — the session's wins, because that is the one the table was
           * decided from, and asking again after the fact is what let a booking
           * be marked as sharing a table while holding a different one.
           */
          joinReservationNumber:
            session.joinNumber ||
            (shareTable && joinNumber.trim() ? joinNumber.trim().toUpperCase() : undefined),
          // Empty means "any table", which the route reads as no claim at all.
          tableId: session.tableId || undefined,
          /**
           * The seats this booking is spending. Sent only when the hold is for
           * this evening and this party — a hold left over from a date the
           * guest changed their mind about would be refused, and refused is the
           * one thing this page must not be when it can help it.
           */
          holdId:
            session.holdId && session.holdDate === session.date && session.holdGuests >= guestCount
              ? session.holdId
              : undefined,
        }),
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        setSubmitting(false);
        setError(translateApiError(t, data) ?? t.summary.failed);

        /**
         * Nothing below navigates. Every one of these used to, and the two that
         * did it silently — a full evening and a taken table — are the whole
         * reason this feature exists: a guest who had done everything right was
         * put back on the calendar with no message at all, and had no way to
         * know whether they had lost the seats, mistyped something, or broken
         * the app.
         *
         * So the failure is said on this page, in the guest's own language, and
         * the step that can fix it is offered as a button. The guest reads the
         * reason, then decides to go.
         */

        // The seats were let go before the booking arrived. The evening itself
        // may well still have room, so the calendar is the place to go.
        if (data.code === "HOLD_EXPIRED") {
          // Already gone on the server; clearing it stops the calendar trying
          // to move a hold that is not there.
          releaseSeatHold(session.holdId);
          setFailureRoute({ href: "/booking/date", label: t.seatHold.chooseAgain });
          return;
        }

        /**
         * They already have a dinner on this evening. Almost always a guest who
         * tapped back and started again rather than one who wants a second
         * table — so the way out is the calendar, and the booking they already
         * have is named in the message.
         */
        if (data.code === "ALREADY_BOOKED") {
          setFailureRoute({ href: "/booking/date", label: t.summary.chooseAnotherDate });
          return;
        }

        // The evening filled up or closed. With seats held from the calendar
        // onwards this should now be unreachable through the flow — it is left
        // in for a booking made without a hold, and for the day somebody finds
        // a way to it that nobody thought of.
        if (data.code === "DATE_UNAVAILABLE") {
          setFailureRoute({ href: "/booking/date", label: t.summary.chooseAnotherDate });
          return;
        }

        /**
         * Somebody took the table between the room being drawn and this
         * submission. The plan reloads with the table visibly taken, which is
         * the explanation as well as the fix — but the guest is told first, and
         * goes when they choose to.
         */
        if (data.code === "TABLE_TAKEN") {
          setFailureRoute({ href: "/booking/table", label: t.summary.chooseAnotherTable });
          return;
        }

        // The party they tried to join, or the key itself, is the problem
        // rather than the booking. Both are fixed on this page or the first
        // one, and neither is worth moving the guest for.
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
      {/* How long the seats are held, and what happened if they no longer are. */}
      <SeatHoldBanner step="summary" />
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

          {session.joinNumber ? (
            // Already settled, before the table was chosen. Shown rather than
            // asked again: two controls for one question is how the two answers
            // came to disagree.
            <div className="rounded-control border border-line bg-surface-muted p-4 text-sm text-ink">
              Sitting with reservation{" "}
              <span className="font-semibold">{session.joinNumber}</span>.
            </div>
          ) : (
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
          )}

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

        {/*
          The way out of whatever went wrong, offered rather than taken. Under
          the message, so it is read as the answer to it.
        */}
        {failureRoute ? (
          <ButtonLink href={failureRoute.href} variant="primary" size="lg" className="mt-4 w-full">
            {failureRoute.label}
          </ButtonLink>
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
