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
import { formatLongDate, isPastDateKey, startOfMonth } from "@/lib/date";
import type { RestaurantDateAvailability } from "@/types/booking";

/**
 * Availability is fetched on the server and handed down as a prop, so there is
 * no loading spinner, no request waterfall, and nothing to go wrong offline.
 */
export function DatePicker({ dates }: { dates: RestaurantDateAvailability[] }) {
  const router = useRouter();
  const { session, ready } = useBookingGuard(["room", "guests"]);

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
        return { disabled: true, status: "in the past" };
      }

      if (!entry) {
        return { disabled: true, hint: "—", status: "not open for reservations" };
      }

      if (!entry.isOpen) {
        return { disabled: true, hint: "Closed", status: "restaurant closed" };
      }

      if (entry.remainingSeats <= 0) {
        return { disabled: true, hint: "Full", status: "fully booked" };
      }

      if (entry.remainingSeats < guestCount) {
        return {
          disabled: true,
          hint: `${entry.remainingSeats} left`,
          status: `only ${entry.remainingSeats} seats left, not enough for ${guestCount} guests`,
        };
      }

      /**
       * The pass-key stops working at check-out, so an evening after that is
       * not bookable however many seats it has. Blocking it here means the
       * guest sees the limit of their stay on the calendar instead of picking
       * a date and being refused at the end.
       */
      if (session.passKeyExpiresOn && dateKey > session.passKeyExpiresOn) {
        return { disabled: true, hint: "After your stay", status: "after your stay ends" };
      }

      return {
        hint: `${entry.remainingSeats} left`,
        status: `${entry.remainingSeats} seats available`,
        tone: "positive",
      };
    },
    [findDate, guestCount, session.passKeyExpiresOn],
  );

  const handleContinue = () => {
    if (!selectedDate || getDayState(selectedDate).disabled) {
      setError("Please choose an available date.");
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
        eyebrow="Date"
        title="Select a dinner date"
        description={
          ready ? `Showing evenings with room for ${guestCount} ${guestCount === 1 ? "guest" : "guests"}.` : undefined
        }
      />

      {/*
        Allowed, but almost always a mistake: the guest meant to change the
        booking they already have on this evening.
      */}
      {ready && selectedDate && session.passKeyBookedDates.includes(selectedDate) ? (
        <Alert tone="warning" className="mt-4">
          You already have a reservation on this evening. To change it,{" "}
          <Link href={manageHref(session.passKey)} className="font-semibold underline underline-offset-2">
            manage your reservation
          </Link>{" "}
          instead — carry on only if you are booking a second table, for another room.
        </Alert>
      ) : null}

      {ready && session.passKeyExpiresOn ? (
        <Alert tone="info" className="mt-4">
          Your pass-key books dinner up to {formatLongDate(session.passKeyExpiresOn)}, the day you check out.
          Evenings after that are not available.
        </Alert>
      ) : null}

      <div className="mt-6">
        {dates.length === 0 ? (
          <Alert tone="info">No dinner dates are open for reservations yet. Please contact guest services.</Alert>
        ) : (
          <MonthCalendar
            label="Dinner dates"
            month={month}
            onMonthChange={setMonth}
            selectedDate={selectedDate}
            onSelect={(dateKey) => {
              setChoice(dateKey);
              setError("");
            }}
            getDayState={getDayState}
            minMonth={startOfMonth(new Date())}
          />
        )}
      </div>

      <div className="mt-5 rounded-control border border-line bg-surface-muted p-4 text-sm text-ink-muted">
        {selectedDate ? (
          <>
            <p className="font-semibold text-ink">
              <time dateTime={selectedDate}>{formatLongDate(selectedDate)}</time>
            </p>
            {selectedEntry?.serviceTime ? (
              <p className="mt-1 font-medium text-accent-ink">
                Everyone is seated at {selectedEntry.serviceTime}. Please arrive on time.
              </p>
            ) : null}
            <p className="mt-1">
              {!selectedEntry
                ? "This date is not open for reservations."
                : !selectedEntry.isOpen
                  ? "The restaurant is closed on this date."
                  : selectedEntry.remainingSeats <= 0
                    ? "Fully booked — please choose another evening."
                    : selectedEntry.remainingSeats < guestCount
                      ? `Only ${selectedEntry.remainingSeats} seats remain, and you need ${guestCount}.`
                      : `${selectedEntry.remainingSeats} seats remaining.`}
            </p>
          </>
        ) : (
          <p>Select a date to continue.</p>
        )}
      </div>

      {error ? (
        <Alert tone="danger" className="mt-4">
          {error}
        </Alert>
      ) : null}

      <div className="mt-6 flex flex-col gap-3 sm:flex-row">
        <ButtonLink href="/booking/guests" size="lg" className="flex-1">
          Back
        </ButtonLink>
        <Button
          size="lg"
          className="flex-1"
          onClick={handleContinue}
          disabled={!selectedDate || Boolean(getDayState(selectedDate).disabled)}
        >
          Continue
        </Button>
      </div>
    </Card>
  );
}
