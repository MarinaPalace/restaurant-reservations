"use client";

import { useMemo, useState } from "react";
import { MonthCalendar, type DayState } from "@/components/month-calendar";
import { Card, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert, Badge, EmptyState } from "@/components/ui/feedback";
import { Field, Input } from "@/components/ui/field";
import { KitchenReport } from "@/app/admin/kitchen-report";
import { formatLongDate, isValidDateKey, startOfMonth, todayKey } from "@/lib/date";
import {
  withRemainingSeats,
  type MenuCourse,
  type ReservationRecord,
  type RestaurantDateAvailability,
} from "@/types/booking";

export function AdminDateManager({
  initialDates,
  initialReservations,
  menu,
}: {
  initialDates: RestaurantDateAvailability[];
  initialReservations: ReservationRecord[];
  menu: MenuCourse[];
}) {
  const [dates, setDates] = useState(initialDates);
  const [reservations, setReservations] = useState(initialReservations);
  const [selectedDate, setSelectedDate] = useState(initialDates[0]?.date ?? todayKey());
  const [month, setMonth] = useState(() => startOfMonth(new Date()));
  const [newDate, setNewDate] = useState("");
  const [saving, setSaving] = useState(false);
  const [busyNumber, setBusyNumber] = useState<string | null>(null);
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
          serviceTime: selectedEntry.serviceTime || undefined,
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

  /** Table numbers apply to every room sharing that table. */
  const assignTable = async (reservationNumber: string, tableNumber: string) => {
    setBusyNumber(reservationNumber);
    setError("");

    try {
      const response = await fetch(
        `/api/admin/reservations/${encodeURIComponent(reservationNumber)}/table`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tableNumber }),
        },
      );

      if (!response.ok) {
        throw new Error("Unable to save the table number.");
      }

      const { reservations: updated }: { reservations: ReservationRecord[] } = await response.json();
      const byNumber = new Map(updated.map((entry) => [entry.reservationNumber, entry]));

      setReservations((current) =>
        current.map((reservation) => byNumber.get(reservation.reservationNumber) ?? reservation),
      );
    } catch (tableError) {
      setError(tableError instanceof Error ? tableError.message : "Unable to save the table number.");
    } finally {
      setBusyNumber(null);
    }
  };

  /** Cancelling from the dashboard also returns the seats to the date. */
  const cancelReservation = async (reservationNumber: string) => {
    setBusyNumber(reservationNumber);
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
      setBusyNumber(null);
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

                  <Field
                    label="Arrival time"
                    hint="Everyone is seated at this time. Shown to guests and used for calendar reminders."
                  >
                    {(fieldProps) => (
                      <Input
                        {...fieldProps}
                        type="time"
                        value={selectedEntry.serviceTime ?? ""}
                        onChange={(event) => patchSelected({ serviceTime: event.target.value })}
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

      <KitchenReport
        date={selectedDate}
        serviceTime={selectedEntry?.serviceTime}
        reservations={selectedDayReservations}
        menu={menu}
        onAssignTable={assignTable}
        onCancel={cancelReservation}
        busyReservationNumber={busyNumber}
      />
    </div>
  );
}
