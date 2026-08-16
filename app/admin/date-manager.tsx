"use client";

import { useMemo, useState } from "react";
import { MonthCalendar, type DayState } from "@/components/month-calendar";
import { Card, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert, Badge, EmptyState } from "@/components/ui/feedback";
import { Field, Input } from "@/components/ui/field";
import { KitchenReport } from "@/app/admin/kitchen-report";
import { formatLongDate, isValidDateKey, startOfMonth, todayKey } from "@/lib/date";
import { compareRoomNumbers } from "@/lib/room";
import {
  withRemainingSeats,
  type MenuCourse,
  type ReservationRecord,
  type RestaurantDateAvailability,
  type StaffPermission,
} from "@/types/booking";

export function AdminDateManager({
  initialDates,
  initialReservations,
  menu,
  permissions,
}: {
  initialDates: RestaurantDateAvailability[];
  initialReservations: ReservationRecord[];
  menu: MenuCourse[];
  /** What the signed-in account may do; the API enforces the same list. */
  permissions: StaffPermission[];
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
        .sort((a, b) => compareRoomNumbers(a.roomNumber, b.roomNumber)),
    [reservations, selectedDate],
  );

  const getDayState = (dateKey: string): DayState => {
    const entry = dates.find((item) => item.date === dateKey);

    if (!entry) {
      return { hint: "—", status: "not configured" };
    }

    if (!entry.isOpen) {
      return { hint: "Closed", status: "closed", premium: entry.premium };
    }

    return {
      hint: `${entry.remainingSeats} free`,
      status: `${entry.remainingSeats} of ${entry.capacity} seats free${entry.premium ? ", invitation only" : ""}`,
      tone: entry.remainingSeats > 0 ? "positive" : "default",
      premium: entry.premium,
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
          serviceEndTime: selectedEntry.serviceEndTime || undefined,
          premium: Boolean(selectedEntry.premium),
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

  /** Removes a booking for good, releasing its seats. */
  const deleteReservation = async (reservationNumber: string) => {
    const confirmed = window.confirm(
      `Delete reservation ${reservationNumber} permanently? Cancel it instead if you want to keep it on the night's record.`,
    );
    if (!confirmed) {
      return;
    }

    setBusyNumber(reservationNumber);
    setError("");
    setNotice("");

    try {
      const response = await fetch(`/api/admin/reservations/${encodeURIComponent(reservationNumber)}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        throw new Error("Unable to delete this reservation.");
      }

      const { reservation: removed }: { reservation: ReservationRecord } = await response.json();

      setReservations((current) =>
        current.filter((reservation) => reservation.reservationNumber !== reservationNumber),
      );

      if (removed.status === "confirmed") {
        setDates((current) =>
          current.map((entry) =>
            entry.date === removed.date
              ? withRemainingSeats({
                  ...entry,
                  reservedSeats: Math.max(entry.reservedSeats - removed.guestCount, 0),
                })
              : entry,
          ),
        );
      }

      setNotice(`Reservation ${reservationNumber} deleted.`);
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Unable to delete this reservation.");
    } finally {
      setBusyNumber(null);
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

  /**
   * Undoes a cancellation.
   *
   * This can fail for a real reason — the seats went back into the pool when
   * the booking was cancelled and somebody else may have taken them — so the
   * server's message is shown rather than a generic one.
   */
  const restoreReservation = async (reservationNumber: string) => {
    setBusyNumber(reservationNumber);
    setError("");
    setNotice("");

    try {
      const response = await fetch(`/api/admin/reservations/${encodeURIComponent(reservationNumber)}/restore`, {
        method: "POST",
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(data.error ?? "Unable to restore this reservation.");
      }

      const restored: ReservationRecord = data.reservation;

      setReservations((current) =>
        current.map((reservation) =>
          reservation.reservationNumber === reservationNumber ? restored : reservation,
        ),
      );

      // The seats are held again, so the evening's count has to follow.
      setDates((current) =>
        current.map((entry) =>
          entry.date === restored.date
            ? withRemainingSeats({ ...entry, reservedSeats: entry.reservedSeats + restored.guestCount })
            : entry,
        ),
      );

      setNotice(`Reservation ${reservationNumber} restored.`);
    } catch (restoreError) {
      setError(restoreError instanceof Error ? restoreError.message : "Unable to restore this reservation.");
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
          <div>
            <MonthCalendar
              label="Restaurant availability"
              month={month}
              onMonthChange={setMonth}
              selectedDate={selectedDate}
              onSelect={setSelectedDate}
              getDayState={getDayState}
            />

            <p className="mt-3 flex items-center gap-2 text-xs text-ink-muted">
              <span className="inline-flex items-center gap-1 rounded-full border border-gold bg-accent-soft px-2 py-0.5 font-medium text-accent-ink">
                <svg aria-hidden="true" viewBox="0 0 24 24" fill="currentColor" className="size-3 text-gold">
                  <path d="M12 2.6l2.7 5.9 6.4.7-4.8 4.3 1.3 6.3L12 16.7 6.4 19.8l1.3-6.3L2.9 9.2l6.4-.7z" />
                </svg>
                Invitation only
              </span>
              Bookable at /premium, hidden from hotel guests.
            </p>
          </div>

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

                  {/* A premium evening leaves the everyday flow entirely and
                      becomes selectable only from the invitation link. */}
                  <label className="flex min-h-11 items-center justify-between gap-4 rounded-control border border-gold/60 bg-accent-soft px-4 py-3 text-sm font-medium text-accent-ink">
                    <span className="flex items-center gap-2">
                      <svg aria-hidden="true" viewBox="0 0 24 24" fill="currentColor" className="size-4 text-gold">
                        <path d="M12 2.6l2.7 5.9 6.4.7-4.8 4.3 1.3 6.3L12 16.7 6.4 19.8l1.3-6.3L2.9 9.2l6.4-.7z" />
                      </svg>
                      Invitation only (premium menu)
                    </span>
                    <input
                      type="checkbox"
                      className="size-5 accent-[var(--primary)]"
                      checked={Boolean(selectedEntry.premium)}
                      onChange={(event) => patchSelected({ premium: event.target.checked })}
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

                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="Arrival time" hint="Everyone is seated at this time.">
                      {(fieldProps) => (
                        <Input
                          {...fieldProps}
                          type="time"
                          value={selectedEntry.serviceTime ?? ""}
                          onChange={(event) => patchSelected({ serviceTime: event.target.value })}
                        />
                      )}
                    </Field>
                    <Field label="Service ends" hint="Used for the calendar reminder.">
                      {(fieldProps) => (
                        <Input
                          {...fieldProps}
                          type="time"
                          value={selectedEntry.serviceEndTime ?? ""}
                          onChange={(event) => patchSelected({ serviceEndTime: event.target.value })}
                        />
                      )}
                    </Field>
                  </div>

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
        onRestore={restoreReservation}
        onDelete={deleteReservation}
        busyReservationNumber={busyNumber}
        permissions={permissions}
      />
    </div>
  );
}
