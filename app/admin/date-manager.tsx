"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { MonthCalendar, type DayState } from "@/components/month-calendar";
import { Card, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert, Badge, EmptyState } from "@/components/ui/feedback";
import { Field, Input } from "@/components/ui/field";
import { ContactLink } from "@/components/contact-link";
import { formatLongDate, isValidDateKey, startOfMonth, todayKey } from "@/lib/date";
import { withRemainingSeats, type ReservationRecord, type RestaurantDateAvailability } from "@/types/booking";

export function AdminDateManager({
  initialDates,
  initialReservations,
}: {
  initialDates: RestaurantDateAvailability[];
  initialReservations: ReservationRecord[];
}) {
  const [dates, setDates] = useState(initialDates);
  const [reservations, setReservations] = useState(initialReservations);
  const [selectedDate, setSelectedDate] = useState(initialDates[0]?.date ?? todayKey());
  const [month, setMonth] = useState(() => startOfMonth(new Date()));
  const [newDate, setNewDate] = useState("");
  const [saving, setSaving] = useState(false);
  const [cancellingNumber, setCancellingNumber] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const selectedEntry = dates.find((entry) => entry.date === selectedDate) ?? null;

  const selectedDayReservations = useMemo(
    () =>
      reservations
        .filter((reservation) => reservation.date === selectedDate)
        .sort((a, b) => a.roomNumber - b.roomNumber),
    [reservations, selectedDate],
  );

  const expectedCovers = selectedDayReservations
    .filter((reservation) => reservation.status === "confirmed")
    .reduce((total, reservation) => total + reservation.guestCount, 0);

  const getDayState = (dateKey: string): DayState => {
    const entry = dates.find((item) => item.date === dateKey);

    if (!entry) {
      return { hint: "—", status: "not configured" };
    }

    if (!entry.isOpen) {
      return { hint: "Closed", status: "closed" };
    }

    return {
      hint: `${entry.remainingSeats} free`,
      status: `${entry.remainingSeats} of ${entry.capacity} seats free`,
      tone: entry.remainingSeats > 0 ? "positive" : "default",
    };
  };

  const patchSelected = (patch: Partial<RestaurantDateAvailability>) => {
    setDates((current) =>
      current.map((entry) =>
        entry.date === selectedDate ? withRemainingSeats({ ...entry, ...patch }) : entry,
      ),
    );
    setNotice("");
  };

  const addDate = () => {
    if (!isValidDateKey(newDate)) {
      setError("Choose a valid date to add.");
      return;
    }

    if (dates.some((entry) => entry.date === newDate)) {
      setError("That date is already in the availability list.");
      setSelectedDate(newDate);
      return;
    }

    setDates((current) =>
      [...current, withRemainingSeats({ date: newDate, isOpen: true, capacity: 40, reservedSeats: 0 })].sort((a, b) =>
        a.date.localeCompare(b.date),
      ),
    );
    setSelectedDate(newDate);
    setMonth(startOfMonth(new Date(`${newDate}T12:00:00`)));
    setNewDate("");
    setError("");
    setNotice("Date added. Remember to save it.");
  };

  const saveDate = async () => {
    if (!selectedEntry || saving) {
      return;
    }

    if (selectedEntry.capacity < selectedEntry.reservedSeats) {
      setError(
        `Capacity cannot be lower than the ${selectedEntry.reservedSeats} seats already reserved for this date.`,
      );
      return;
    }

    setSaving(true);
    setError("");
    setNotice("");

    try {
      const response = await fetch("/api/admin/dates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date: selectedEntry.date,
          isOpen: selectedEntry.isOpen,
          capacity: Number(selectedEntry.capacity),
        }),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error ?? "Unable to save.");
      }

      const updated: RestaurantDateAvailability = await response.json();
      setDates((current) => current.map((entry) => (entry.date === updated.date ? updated : entry)));
      setNotice(`Saved availability for ${formatLongDate(updated.date)}.`);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Unable to save the availability for this date.");
    } finally {
      setSaving(false);
    }
  };

  /** Cancelling from the dashboard also returns the seats to the date. */
  const cancelReservation = async (reservationNumber: string) => {
    setCancellingNumber(reservationNumber);
    setError("");
    setNotice("");

    try {
      const response = await fetch(`/api/admin/reservations/${encodeURIComponent(reservationNumber)}/cancel`, {
        method: "POST",
      });

      if (!response.ok) {
        throw new Error("Unable to cancel this reservation.");
      }

      const cancelled: ReservationRecord = await response.json();

      setReservations((current) =>
        current.map((reservation) =>
          reservation.reservationNumber === reservationNumber
            ? { ...reservation, status: "cancelled" }
            : reservation,
        ),
      );

      setDates((current) =>
        current.map((entry) =>
          entry.date === cancelled.date
            ? withRemainingSeats({
                ...entry,
                reservedSeats: Math.max(entry.reservedSeats - cancelled.guestCount, 0),
              })
            : entry,
        ),
      );

      setNotice(`Reservation ${reservationNumber} cancelled.`);
    } catch (cancelError) {
      setError(cancelError instanceof Error ? cancelError.message : "Unable to cancel this reservation.");
    } finally {
      setCancellingNumber(null);
    }
  };

  return (
    <div className="mt-6 space-y-6">
      <Card className="p-5 sm:p-6" as="section">
        <CardHeader
          eyebrow="Availability"
          title="Restaurant calendar"
          actions={
            <div className="flex flex-wrap items-end gap-3" data-print="hide">
              <Field label="Add a date">
                {(fieldProps) => (
                  <Input
                    {...fieldProps}
                    type="date"
                    value={newDate}
                    onChange={(event) => setNewDate(event.target.value)}
                    className="sm:w-48"
                  />
                )}
              </Field>
              <Button variant="secondary" onClick={addDate}>
                Add date
              </Button>
            </div>
          }
        />

        {error ? (
          <Alert tone="danger" className="mt-4">
            {error}
          </Alert>
        ) : null}
        {notice ? (
          <Alert tone="success" className="mt-4">
            {notice}
          </Alert>
        ) : null}

        <div className="mt-6 grid gap-6 xl:grid-cols-[1.4fr_1fr]">
          <MonthCalendar
            label="Restaurant availability"
            month={month}
            onMonthChange={setMonth}
            selectedDate={selectedDate}
            onSelect={setSelectedDate}
            getDayState={getDayState}
          />

          <div className="rounded-control border border-line bg-surface-muted p-4" data-print="hide">
            {selectedEntry ? (
              <>
                <p className="eyebrow">Selected date</p>
                <h3 className="mt-2 text-xl font-semibold text-ink">
                  <time dateTime={selectedEntry.date}>{formatLongDate(selectedEntry.date)}</time>
                </h3>

                <div className="mt-5 space-y-4">
                  <label className="flex min-h-11 items-center justify-between gap-4 rounded-control border border-line-strong bg-surface px-4 py-3 text-sm font-medium text-ink">
                    <span>Open for reservations</span>
                    <input
                      type="checkbox"
                      className="size-5 accent-[var(--primary)]"
                      checked={selectedEntry.isOpen}
                      onChange={(event) => patchSelected({ isOpen: event.target.checked })}
                    />
                  </label>

                  <Field
                    label="Total seats"
                    hint={`${selectedEntry.reservedSeats} already reserved`}
                    error={
                      selectedEntry.capacity < selectedEntry.reservedSeats
                        ? "Below the number of seats already reserved."
                        : undefined
                    }
                  >
                    {(fieldProps) => (
                      <Input
                        {...fieldProps}
                        type="number"
                        min={0}
                        inputMode="numeric"
                        value={selectedEntry.capacity}
                        onChange={(event) => patchSelected({ capacity: Number(event.target.value || 0) })}
                      />
                    )}
                  </Field>

                  <div className="flex flex-wrap gap-2">
                    <Badge tone={selectedEntry.isOpen ? "success" : "info"}>
                      {selectedEntry.isOpen ? `${selectedEntry.remainingSeats} free seats` : "Closed"}
                    </Badge>
                    <Badge tone="info">{selectedEntry.reservedSeats} reserved</Badge>
                  </div>

                  <Button className="w-full" onClick={saveDate} loading={saving} loadingLabel="Saving…">
                    Save this date
                  </Button>
                </div>
              </>
            ) : (
              <EmptyState
                title="Date not configured"
                description="This evening is not in the availability list yet. Add it with the field above to open it for reservations."
                action={
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setNewDate(selectedDate);
                      setError("");
                    }}
                  >
                    Use {selectedDate}
                  </Button>
                }
              />
            )}
          </div>
        </div>
      </Card>

      <Card className="p-5 sm:p-6" as="section">
        <CardHeader
          eyebrow="Kitchen report"
          title={`Reservations for ${formatLongDate(selectedDate)}`}
          description={`${expectedCovers} ${expectedCovers === 1 ? "cover" : "covers"} expected.`}
          actions={
            <div data-print="hide">
              <Button variant="secondary" onClick={() => window.print()}>
                Print report
              </Button>
            </div>
          }
        />

        <div className="mt-5">
          {selectedDayReservations.length === 0 ? (
            <EmptyState title="No reservations yet" description="Nothing has been booked for this evening." />
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <caption className="sr-only">
                  Reservations for {formatLongDate(selectedDate)}, grouped by room number
                </caption>
                <thead className="bg-surface-sunken text-ink-muted">
                  <tr>
                    <th scope="col" className="px-4 py-3 font-semibold">
                      Reservation
                    </th>
                    <th scope="col" className="px-4 py-3 font-semibold">
                      Room
                    </th>
                    <th scope="col" className="px-4 py-3 font-semibold">
                      Guests
                    </th>
                    <th scope="col" className="px-4 py-3 font-semibold">
                      Contact
                    </th>
                    <th scope="col" className="px-4 py-3 font-semibold">
                      Choices
                    </th>
                    <th scope="col" className="px-4 py-3 font-semibold">
                      Status
                    </th>
                    <th scope="col" className="px-4 py-3 font-semibold" data-print="hide">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {selectedDayReservations.map((reservation) => {
                    const byGuest = new Map<number, typeof reservation.selections>();
                    for (const selection of reservation.selections) {
                      const guestIndex = selection.guestIndex ?? 0;
                      byGuest.set(guestIndex, [...(byGuest.get(guestIndex) ?? []), selection]);
                    }

                    return (
                      <tr key={reservation.reservationNumber} className="border-t border-line align-top">
                        <th scope="row" className="px-4 py-3 text-left font-medium text-ink">
                          <Link
                            href={`/admin/reservation/${reservation.reservationNumber}`}
                            className="underline underline-offset-2 hover:text-accent"
                          >
                            {reservation.reservationNumber}
                          </Link>
                        </th>
                        <td className="px-4 py-3 tabular-nums">{reservation.roomNumber}</td>
                        <td className="px-4 py-3 tabular-nums">{reservation.guestCount}</td>
                        <td className="px-4 py-3">
                          <ContactLink contact={reservation.contact} />
                        </td>
                        <td className="px-4 py-3">
                          {reservation.selections.length === 0 ? (
                            <span className="text-ink-muted">No menu selections</span>
                          ) : (
                            <div className="space-y-2">
                              {[...byGuest.entries()]
                                .sort(([a], [b]) => a - b)
                                .map(([guestIndex, entries]) => (
                                  <div key={guestIndex} className="rounded-control bg-surface-muted p-2">
                                    <p className="text-xs font-semibold uppercase tracking-wide text-ink-subtle">
                                      Guest {guestIndex + 1}
                                    </p>
                                    <ul className="mt-1 space-y-0.5">
                                      {entries.map((entry, index) => (
                                        <li key={`${entry.courseId}-${index}`}>
                                          <span className="font-medium text-ink">{entry.courseName}:</span>{" "}
                                          <span className="text-ink-muted">{entry.optionName}</span>
                                        </li>
                                      ))}
                                    </ul>
                                  </div>
                                ))}
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <Badge tone={reservation.status === "confirmed" ? "success" : "info"}>
                            {reservation.status}
                          </Badge>
                        </td>
                        <td className="px-4 py-3" data-print="hide">
                          {reservation.status === "confirmed" ? (
                            <Button
                              variant="danger"
                              onClick={() => cancelReservation(reservation.reservationNumber)}
                              loading={cancellingNumber === reservation.reservationNumber}
                              loadingLabel="Cancelling…"
                            >
                              Cancel
                            </Button>
                          ) : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}
