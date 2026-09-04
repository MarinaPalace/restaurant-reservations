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
import { takeSeatHold } from "@/hooks/use-seat-hold";
import { useI18n } from "@/components/i18n-provider";
import { translateApiError } from "@/lib/i18n/errors";
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
  const [holding, setHolding] = useState(false);

  const guestCount = Math.max(session.guestCount, 1);
  const selectedDate = choice ?? (session.date || null);

  const findDate = useCallback((dateKey: string) => dates.find((entry) => entry.date === dateKey) ?? null, [dates]);

  /**
   * Seats this guest is already holding, on the evening they are holding them.
   *
   * The server counts held seats as gone, which is right for everybody except
   * the person holding them. Without this, a party of four who took the last
   * four seats on Friday and then came back to the calendar would find Friday
   * marked full — by their own hold — with no way to go forward again. Adding
   * them back here is what makes going back and forth free.
   */
  const heldHere = useCallback(
    (dateKey: string) => (session.holdDate === dateKey ? session.holdGuests : 0),
    [session.holdDate, session.holdGuests],
  );

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

      const remaining = entry.remainingSeats + heldHere(dateKey);

      if (remaining <= 0) {
        return { disabled: true, hint: t.dateStep.day.fullHint, status: t.dateStep.day.full };
      }

      if (remaining < guestCount) {
        return {
          disabled: true,
          hint: format(t.dateStep.day.leftHint, { count: remaining }),
          status: format(t.dateStep.day.notEnough, { count: remaining, guests: guestCount }),
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
        hint: format(t.dateStep.day.leftHint, { count: remaining }),
        status: format(t.dateStep.day.available, { count: remaining }),
        tone: "positive",
      };
    },
    [findDate, guestCount, heldHere, session.passKeyExpiresOn, t],
  );

  /**
   * Chooses the evening, and takes the seats for it.
   *
   * This is where the seats stop being a promise. Everything after it — the
   * table, six courses for four people, the contact details — is spent on seats
   * that are already out of the room, which is the difference between finishing
   * a booking and finding out at the end that somebody else finished first.
   *
   * A refusal is shown **here**, on the calendar, with the reason. That is the
   * point of asking now: the evening filling up is heard by a guest who has
   * chosen nothing yet, in the one place where choosing again is the obvious
   * next thing to do.
   */
  const handleContinue = async () => {
    if (holding) {
      return;
    }

    if (!selectedDate || getDayState(selectedDate).disabled) {
      setError(t.dateStep.chooseAvailable);
      return;
    }

    /**
     * A different evening is a different room, so a table picked for the old
     * one cannot come along. Cleared here rather than on the table step,
     * because going *back* and changing the date is exactly when it would
     * otherwise survive unnoticed into the booking.
     *
     * Written before the seats are asked for, so that the hold and the session
     * agree about which evening they are for whichever way the request goes.
     */
    writeBookingSession({ date: selectedDate, tableId: "" });

    setHolding(true);
    setError("");

    const held = await takeSeatHold({
      passKey: session.passKey,
      date: selectedDate,
      guestCount,
      // Moves the hold rather than taking a second one, so a guest who tries
      // three evenings does not end up holding all three.
      previousHoldId: session.holdId,
    });

    if (!held.ok) {
      setHolding(false);
      setError(
        held.code === "CONNECTION"
          ? t.common.connectionProblem
          : (translateApiError(t, held) ?? t.seatHold.couldNotHold),
      );

      /**
       * The calendar is drawn on the server, so the numbers on it are as old as
       * the page. Redrawing turns "we could not hold seats for that evening"
       * into an evening the guest can see is full, which is the explanation and
       * the way forward in one.
       */
      router.refresh();
      return;
    }

    /**
     * Straight past the table step unless this evening offers the choice. The
     * switch is resolved by the server and arrives on the date
     * (`docs/evening-features.md` §7), so no second request is needed to find
     * out — and the step itself checks again, for anybody who links to it.
     */
    const evening = findDate(selectedDate);
    const choosing = evening?.features?.tableSelection && evening.features.tableSelection !== "off";

    router.push(choosing ? "/booking/table" : "/booking/menu");
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
              {(() => {
                if (!selectedEntry) return t.dateStep.notOpen;
                if (!selectedEntry.isOpen) return t.dateStep.closed;

                // The guest's own held seats count for them here too, or the
                // evening they are holding would read as full underneath the
                // day they have just tapped.
                const remaining = selectedEntry.remainingSeats + heldHere(selectedEntry.date);

                if (remaining <= 0) return t.dateStep.full;
                if (remaining < guestCount) {
                  return format(t.dateStep.notEnoughSeats, { count: remaining, guests: guestCount });
                }
                return format(t.dateStep.seatsRemaining, { count: remaining });
              })()}
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
          loading={holding}
          loadingLabel={t.dateStep.holdingSeats}
        >
          {t.common.continue}
        </Button>
      </div>
    </Card>
  );
}
