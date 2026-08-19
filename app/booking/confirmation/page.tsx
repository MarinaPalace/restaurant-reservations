"use client";

import { BrandMark } from "@/components/brand";
import { PageShell } from "@/components/page-shell";
import { Card, CardHeader } from "@/components/ui/card";
import { Button, ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/feedback";
import { useBookingSession, useConfirmation, storeConfirmation } from "@/hooks/use-booking-session";
import { useEffect, useState } from "react";
import { useI18n } from "@/components/i18n-provider";
import { format, localeOf } from "@/lib/i18n";
import { manageHref } from "@/lib/pass-key-links";
import { buildGoogleCalendarUrl, buildIcsFile, describeReservationTime } from "@/lib/calendar";
import { formatContact, MESSAGING_APP_LABELS } from "@/lib/contact";
import { formatLongDate } from "@/lib/date";
import type { MenuCourse, ReservationRecord } from "@/types/booking";

/**
 * The reservation is read through the session store rather than during render:
 * the previous version called sessionStorage from a useMemo, so the server
 * rendered "no reservation found" while the client rendered the confirmation —
 * a hydration mismatch.
 */
export default function ConfirmationPage() {
  const reservation = useConfirmation();
  // The key they booked with, so changing it later needs no typing.
  const session = useBookingSession();
  const { t, language } = useI18n();
  const locale = localeOf(language);
  const [addOnCourses, setAddOnCourses] = useState<MenuCourse[]>([]);
  const [selectedAddOns, setSelectedAddOns] = useState<Record<string, string>>({});
  const [savingAddOns, setSavingAddOns] = useState(false);
  const [addOnNotice, setAddOnNotice] = useState("");
  const [changedAddOns, setChangedAddOns] = useState(false);

  useEffect(() => {
    if (!reservation) {
      return;
    }

    fetch("/api/menu?addOns=true")
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => setAddOnCourses(Array.isArray(data) ? data.filter((course: MenuCourse) => course.addOn) : []))
      .catch(() => setAddOnCourses([]));
  }, [reservation]);

  const displayedAddOns = changedAddOns
    ? selectedAddOns
    : Object.fromEntries((reservation?.addOns ?? []).map((addOn) => [addOn.courseId, addOn.optionId]));

  const saveAddOns = async (nextAddOns = displayedAddOns) => {
    if (!reservation || savingAddOns) {
      return;
    }

    setSavingAddOns(true);
    setAddOnNotice("");
    try {
      const response = await fetch("/api/booking/add-ons", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          passKey: session.passKey,
          reservationNumber: reservation.reservationNumber,
          addOns: Object.entries(nextAddOns)
            .filter(([, optionId]) => optionId)
            .map(([courseId, optionId]) => ({ courseId, optionId })),
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setAddOnNotice(data.error ?? "Unable to save product choices.");
        return;
      }

      storeConfirmation(data.reservation as ReservationRecord);
      setAddOnNotice("Product choices saved.");
    } catch {
      setAddOnNotice("Unable to save product choices.");
    } finally {
      setSavingAddOns(false);
    }
  };

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
        <Card className="p-6 sm:p-8">
          <EmptyState
            title={t.confirmation.missingTitle}
            description={t.confirmation.missingDescription}
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
      {/* The moment worth marking, so this is the one card that also sheens. */}
      <Card elevated className="aurora sheen p-6 sm:p-8">
        <BrandMark className="mx-auto size-12 text-accent" />

        <div className="mt-5 text-center">
          <div
            aria-hidden="true"
            className="pulse-gold mx-auto mb-4 flex size-14 items-center justify-center rounded-full bg-success-soft text-3xl text-success"
          >
            ✓
          </div>
          <CardHeader
            as="h1"
            align="center"
            flourish
            title={t.confirmation.title}
            description={t.confirmation.description}
          />
        </div>

        <div className="mt-6 rounded-control border border-line bg-surface-muted p-4 text-center">
          <p className="eyebrow">{t.confirmation.number}</p>
          <p className="mt-2 font-mono text-3xl font-semibold tracking-[0.2em] text-ink">
            {reservation.reservationNumber}
          </p>
        </div>

        <dl className="mt-5 space-y-3 rounded-control bg-surface-muted p-4 text-sm">
          <div className="flex justify-between gap-3">
            <dt className="text-ink-subtle">{t.common.room}</dt>
            <dd className="font-semibold text-ink">{reservation.roomNumber}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-ink-subtle">{t.common.date}</dt>
            <dd className="font-semibold text-ink">
              <time dateTime={reservation.date}>{formatLongDate(reservation.date, locale)}</time>
            </dd>
          </div>
          {reservation.time ? (
            <div className="flex justify-between gap-3">
              <dt className="text-ink-subtle">{t.confirmation.arrivalTime}</dt>
              <dd className="font-semibold text-ink">{reservation.time}</dd>
            </div>
          ) : null}
          <div className="flex justify-between gap-3">
            <dt className="text-ink-subtle">{t.common.guests}</dt>
            <dd className="font-semibold text-ink">{reservation.guestCount}</dd>
          </div>
          {reservation.contact ? (
            <div className="flex justify-between gap-3">
              <dt className="text-ink-subtle">{t.confirmation.contactOn}</dt>
              <dd className="text-right font-semibold text-ink">
                {formatContact(reservation.contact)}
                {reservation.contact.method === "phone" && reservation.contact.messagingApp ? (
                  <span className="block text-xs font-normal text-ink-muted">
                    {format(t.confirmation.viaApp, {
                      app:
                        reservation.contact.messagingApp === "phone"
                          ? t.contact.phoneOrSms
                          : MESSAGING_APP_LABELS[reservation.contact.messagingApp],
                    })}
                  </span>
                ) : null}
              </dd>
            </div>
          ) : null}
        </dl>

        {reservation.tableGroupId ? (
          <p className="mt-4 rounded-control border border-success/30 bg-success-soft p-3 text-sm font-medium text-success">
            {format(t.confirmation.sharedTable, { number: reservation.tableGroupId })}
          </p>
        ) : (
          <p className="mt-4 rounded-control border border-line bg-surface-muted p-3 text-sm text-ink-muted">
            {t.confirmation.shareInvite}
          </p>
        )}

        <div className="mt-5 rounded-control border border-line bg-surface-muted p-4" data-print="hide">
          <p className="text-sm font-medium text-ink">{t.confirmation.addReminder}</p>
          <p className="mt-1 text-sm text-ink-muted">
            {describeReservationTime(reservation.date, reservation.time, reservation.endTime, locale)}
          </p>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            <a
              href={buildGoogleCalendarUrl(reservation)}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-control bg-primary px-4 text-sm font-semibold text-primary-fg transition-colors hover:bg-primary-hover"
            >
              {t.confirmation.googleCalendar}
              <span className="sr-only">{t.confirmation.newTab}</span>
            </a>
            <Button variant="secondary" className="flex-1" onClick={downloadIcs}>
              {t.confirmation.otherCalendar}
            </Button>
          </div>
        </div>

        {addOnCourses.length > 0 ? (
          <section className="mt-5 rounded-control border border-accent/40 bg-accent-soft p-4" data-print="hide">
            <p className="eyebrow">Make your dinner yours</p>
            <h2 className="mt-1 text-lg font-semibold text-ink">Add a drink or extra</h2>
            <p className="mt-1 text-sm text-ink-muted">Choose any extras you would like prepared for your table.</p>
            <div className="mt-4 space-y-3">
              {addOnCourses.map((course) => (
                <fieldset key={course.id}>
                  <legend className="text-sm font-semibold text-ink">{course.name}</legend>
                  <div className="mt-2 grid gap-2 sm:grid-cols-2">
                    <label className="flex min-h-11 items-center gap-3 rounded-control border border-line bg-surface px-3 py-2 text-sm">
                      <input
                        type="radio"
                        name={`add-on-${course.id}`}
                        checked={!displayedAddOns[course.id]}
                        onChange={() => {
                          setChangedAddOns(true);
                          const next = { ...displayedAddOns };
                          delete next[course.id];
                          setSelectedAddOns((current) => {
                            const next = { ...current };
                            delete next[course.id];
                            return next;
                          });
                          void saveAddOns(next);
                        }}
                        className="size-4 accent-[var(--primary)]"
                      />
                      <span className="font-medium text-ink">No extra</span>
                    </label>
                    {course.options.map((option) => {
                      const price = Number(option.price ?? 0);
                      const discount = Number(option.discountPercent ?? 0);
                      const finalPrice = Math.round(price * (1 - discount / 100) * 100) / 100;
                      return (
                        <label key={option.id} className="flex min-h-11 items-center gap-3 rounded-control border border-line bg-surface px-3 py-2 text-sm">
                          <input
                            type="radio"
                            name={`add-on-${course.id}`}
                            checked={displayedAddOns[course.id] === option.id}
                            onChange={() => {
                              setChangedAddOns(true);
                              const next = { ...displayedAddOns, [course.id]: option.id };
                              setSelectedAddOns(next);
                              void saveAddOns(next);
                            }}
                            className="size-4 accent-[var(--primary)]"
                          />
                          <span className="flex-1 font-medium text-ink">{option.name}</span>
                          <span className="text-right text-xs text-ink-muted">
                            {discount > 0 ? <><s>{price.toFixed(2)}</s>{" "}</> : null}
                            {finalPrice.toFixed(2)}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </fieldset>
              ))}
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <Button variant="secondary" onClick={() => void saveAddOns()} loading={savingAddOns} loadingLabel="Saving…">
                Save product choices
              </Button>
              {addOnNotice ? <span className="text-sm text-ink-muted" role="status">{addOnNotice}</span> : null}
            </div>
          </section>
        ) : null}

        <div className="mt-5 space-y-3">
          {guestGroups.map(({ guestIndex, entries }) =>
            entries.length === 0 ? null : (
              <section key={guestIndex} className="rounded-control border border-line bg-surface-muted p-3">
                <h2 className="eyebrow">{format(t.common.guestNumber, { number: guestIndex + 1 })}</h2>
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

        {/* No "book another" action: a guest may reserve dinner once per
            stay, so offering it would invite a booking we would refuse. */}
        <div className="mt-6 flex flex-col gap-3 sm:flex-row" data-print="hide">
          <Button variant="secondary" size="lg" className="flex-1" onClick={() => window.print()}>
            {t.confirmation.print}
          </Button>
          <ButtonLink href={manageHref(session.passKey)} size="lg" className="flex-1">
            {t.confirmation.changeOrCancel}
          </ButtonLink>
        </div>

        <p className="mt-3 text-center text-xs text-ink-subtle" data-print="hide">
          {t.confirmation.keepKey}
        </p>
      </Card>
    </PageShell>
  );
}
