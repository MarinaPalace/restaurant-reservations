"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import { manageHref } from "@/lib/pass-key-links";
import { useRouter } from "next/navigation";
import { MonthCalendar, type DayState } from "@/components/month-calendar";
import { Card, CardHeader } from "@/components/ui/card";
import { Button, ButtonLink } from "@/components/ui/button";
import { Alert } from "@/components/ui/feedback";
import { useBookingGuard, writeBookingSession } from "@/hooks/use-booking-session";
import { useI18n } from "@/components/i18n-provider";
import { format, localeOf, plural } from "@/lib/i18n";
import { formatLongDate, isPastDateKey, startOfMonth } from "@/lib/date";
import { canGuestBookDate } from "@/lib/reservation-policy";
import type { RestaurantDateAvailability } from "@/types/booking";

/**
 * Availability is fetched on the server and handed down as a prop, so there is
 * no loading spinner, no request waterfall, and nothing to go wrong offline.
 */
export function DatePicker({ dates }: { dates: RestaurantDateAvailability[] }) {
  const router = useRouter();
  const { session, ready } = useBookingGuard(["room", "guests"]);
  const { t, language } = useI18n();
  const locale = localeOf(language);

  const [month, setMonth] = useState(() => startOfMonth(new Date()));
  const [choice, setChoice] = useState<string | null>(null);
  const [error, setError] = useState("");

  const guestCount = Math.max(session.guestCount, 1);
  const selectedDate = choice ?? (session.date || null);

  const findDate = useCallback((dateKey: string) => dates.find((entry) => entry.date === dateKey) ?? null, [dates]);

  const getDayState = useCallback(
    (dateKey: string): DayState => {
      const entry = findDate(dateKey);

      if (isPastDateKey(dateKey)) {
        return { disabled: true, status: t.dateStep.day.past };
      }

      if (!entry) {
        return { disabled: true, hint: "—", status: t.dateStep.day.notOpen };
      }

      if (!entry.isOpen) {
        return { disabled: true, hint: t.dateStep.day.closedHint, status: t.dateStep.day.closed };
      }

      /**
       * Bookings close a set number of hours before the sitting, chosen per
       * evening by staff. Shown here so the guest sees it on the calendar
       * rather than picking the date and being refused at the end — the route
       * refuses it either way (rule 2.5).
       *
       * This is also what closes tonight's dinner once it has started. Before
       * this existed only *past* dates were blocked, so today's evening stayed
       * bookable at midnight.
       */
      if (!canGuestBookDate(entry).allowed) {
        return {
          disabled: true,
          hint: t.dateStep.day.closedForBookingHint,
          status: t.dateStep.day.closedForBooking,
        };
      }

      if (entry.remainingSeats <= 0) {
        return { disabled: true, hint: t.dateStep.day.fullHint, status: t.dateStep.day.full };
      }

      if (entry.remainingSeats < guestCount) {
        return {
          disabled: true,
          hint: format(t.dateStep.day.leftHint, { count: entry.remainingSeats }),
          status: format(t.dateStep.day.notEnough, { count: entry.remainingSeats, guests: guestCount }),
        };
      }

      /**
       * The pass-key stops working at check-out, so an evening after that is
       * not bookable however many seats it has. Blocking it here means the
       * guest sees the limit of their stay on the calendar instead of picking
       * a date and being refused at the end.
       */
      if (session.passKeyExpiresOn && dateKey > session.passKeyExpiresOn) {
        return { disabled: true, hint: t.dateStep.day.afterStayHint, status: t.dateStep.day.afterStay };
      }

      return {
        hint: format(t.dateStep.day.leftHint, { count: entry.remainingSeats }),
        status: format(t.dateStep.day.available, { count: entry.remainingSeats }),
        tone: "positive",
      };
    },
    [findDate, guestCount, session.passKeyExpiresOn, t],
  );

  const handleContinue = () => {
    if (!selectedDate || getDayState(selectedDate).disabled) {
      setError(t.dateStep.chooseAvailable);
      return;
    }

    writeBookingSession({ date: selectedDate });
    router.push("/booking/menu");
  };

  const selectedEntry = selectedDate ? findDate(selectedDate) : null;

  return (
    <Card elevated className="aurora p-4 sm:p-6">
      <CardHeader
        as="h1"
        flourish
        eyebrow={t.common.date}
        title={t.dateStep.title}
        description={
          ready
            ? format(t.dateStep.description, { guests: plural(language, guestCount, t.common.guestCount) })
            : undefined
        }
      />

      {/*
        Allowed, but almost always a mistake: the guest meant to change the
        booking they already have on this evening.
      */}
      {ready && selectedDate && session.passKeyBookedDates.includes(selectedDate) ? (
        <Alert tone="warning" className="mt-4">
          {(() => {
            const [before, after] = t.dateStep.alreadyBooked.split("{link}");
            return (
              <>
                {before}
                <Link href={manageHref(session.passKey)} className="font-semibold underline underline-offset-2">
                  {t.entry.alreadyBookedLink}
                </Link>
                {after}
              </>
            );
          })()}
        </Alert>
      ) : null}

      {ready && session.passKeyExpiresOn ? (
        <Alert tone="info" className="mt-4">
          {format(t.dateStep.keyExpires, { date: formatLongDate(session.passKeyExpiresOn, locale) })}
        </Alert>
      ) : null}

      <div className="mt-6">
        {dates.length === 0 ? (
          <Alert tone="info">{t.dateStep.noDates}</Alert>
        ) : (
          <MonthCalendar
            label={t.dateStep.calendarLabel}
            month={month}
            onMonthChange={setMonth}
            selectedDate={selectedDate}
            onSelect={(dateKey) => {
              setChoice(dateKey);
              setError("");
            }}
            getDayState={getDayState}
            minMonth={startOfMonth(new Date())}
            locale={locale}
            previousMonthLabel={t.dateStep.previousMonth}
            nextMonthLabel={t.dateStep.nextMonth}
          />
        )}
      </div>

      <div className="mt-5 rounded-control border border-line bg-surface-muted p-4 text-sm text-ink-muted">
        {selectedDate ? (
          <>
            <p className="font-semibold text-ink">
              <time dateTime={selectedDate}>{formatLongDate(selectedDate, locale)}</time>
            </p>
            {selectedEntry?.serviceTime ? (
              <p className="mt-1 font-medium text-accent-ink">
                {format(t.dateStep.seatedAt, { time: selectedEntry.serviceTime })}
              </p>
            ) : null}
            <p className="mt-1">
              {!selectedEntry
                ? t.dateStep.notOpen
                : !selectedEntry.isOpen
                  ? t.dateStep.closed
                  : selectedEntry.remainingSeats <= 0
                    ? t.dateStep.full
                    : selectedEntry.remainingSeats < guestCount
                      ? format(t.dateStep.notEnoughSeats, {
                          count: selectedEntry.remainingSeats,
                          guests: guestCount,
                        })
                      : format(t.dateStep.seatsRemaining, { count: selectedEntry.remainingSeats })}
            </p>
          </>
        ) : (
          <p>{t.dateStep.selectToContinue}</p>
        )}
      </div>

      {error ? (
        <Alert tone="danger" className="mt-4">
          {error}
        </Alert>
      ) : null}

      <div className="mt-6 flex flex-col gap-3 sm:flex-row">
        <ButtonLink href="/booking/guests" size="lg" className="flex-1">
          {t.common.back}
        </ButtonLink>
        <Button
          size="lg"
          className="flex-1"
          onClick={handleContinue}
          disabled={!selectedDate || Boolean(getDayState(selectedDate).disabled)}
        >
          {t.common.continue}
        </Button>
      </div>
    </Card>
  );
}
