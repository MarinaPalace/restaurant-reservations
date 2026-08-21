"use client";

import { useMemo, useState } from "react";
import { MonthCalendar, type DayState } from "@/components/month-calendar";
import { Card, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert, Badge, EmptyState } from "@/components/ui/feedback";
import { Field, Input } from "@/components/ui/field";
import { KitchenReport } from "@/app/admin/kitchen-report";
import { formatLongDate, isPastDateKey, isValidDateKey, startOfMonth, todayKey } from "@/lib/date";
import { canGuestBookDate, getBookingDeadline } from "@/lib/reservation-policy";
import { toRestaurantDatePayload } from "@/lib/restaurant-date-form";
import { compareRoomNumbers } from "@/lib/room";
import {
  menuKindOf,
  withRemainingSeats,
  type MenuCourse,
  type ReservationRecord,
  type RestaurantDateAvailability,
  type StaffPermission,
} from "@/types/booking";
import { TIME_ZONES, cityOf, shortTimeZoneLabel, utcOffsetLabel, type TimeZone } from "@/lib/timezone";

/**
 * What a cutoff actually means for this evening, spelled out.
 *
 * "4 hours before the sitting" is a rule; "guests may book until 15:00, then
 * reception only" is what somebody at the desk needs to know. The second is
 * derived from the first and the arrival time, so it cannot drift out of step
 * with it.
 */
function describeCutoff(entry: RestaurantDateAvailability) {
  const hours = Math.max(0, Number(entry.bookingCutoffHours ?? 0));
  const deadline = getBookingDeadline(entry);
  const clock = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false }).format(deadline);
  const closes = hours === 0 ? "the sitting starts" : clock;

  return `Guests may book until ${closes}. Reception can always add a booking, whatever this says.`;
}

export function AdminDateManager({
  initialDates,
  initialReservations,
  menu,
  permissions,
  /** Which clock every time on these screens is quoted on. */
  initialTimeZone,
  /**
   * Set when the configured zone disagrees with the server's own clock, which
   * would mislabel every time by the difference. Worked out on the server,
   * because the server's clock is the one the app computes against.
   */
  clockMismatch,
}: {
  initialDates: RestaurantDateAvailability[];
  initialReservations: ReservationRecord[];
  menu: MenuCourse[];
  /** What the signed-in account may do; the API enforces the same list. */
  permissions: StaffPermission[];
  initialTimeZone: TimeZone;
  clockMismatch: string | null;
}) {
  const [timeZone, setTimeZone] = useState<TimeZone>(initialTimeZone);
  const [savingTimeZone, setSavingTimeZone] = useState(false);
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

  /**
   * The catalogue this evening is actually served from.
   *
   * The dashboard is handed both menus, because it has to be able to show any
   * evening — but the sheet must only column up one of them. The premium menu
   * starts life as a copy of the everyday one, so passing both gave every dish
   * a *second* column, headed the same and permanently empty: the premium
   * copies, which nobody on an everyday evening can order. It was reported as a
   * duplicate column, and that is exactly what it was.
   *
   * Dishes from the other menu are not lost either way: `buildOptionColumns`
   * adds a column for any option a booking actually chose.
   */
  const eveningMenu = useMemo(() => {
    const kind = selectedEntry?.premium ? "premium" : "standard";
    return menu.filter((course) => menuKindOf(course) === kind);
  }, [menu, selectedEntry?.premium]);

  const getDayState = (dateKey: string): DayState => {
    const entry = dates.find((item) => item.date === dateKey);

    /**
     * An evening that has been and gone.
     *
     * It used to read "39 free", which is true and useless: seats on a dinner
     * that already happened are not seats anybody can sell, and a month of
     * them looked identical to a month of open evenings. Staff scanning the
     * calendar for where to put a walk-in were reading last week as if it were
     * next week.
     *
     * Still selectable, and deliberately so — reception looks at last night's
     * sheet all the time — but it says what it is, and it is not styled as
     * availability.
     */
    if (isPastDateKey(dateKey)) {
      return {
        past: true,
        hint: entry ? "Past" : "—",
        status: entry
          ? `in the past · ${entry.capacity - entry.remainingSeats} of ${entry.capacity} seats taken`
          : "in the past",
        tone: "muted",
        premium: entry?.premium,
      };
    }

    if (!entry) {
      return { hint: "—", status: "not configured" };
    }

    if (!entry.isOpen) {
      return { hint: "Closed", status: "closed", premium: entry.premium };
    }

    /**
     * Open, with seats, but guests can no longer take them: the cutoff has
     * passed. Staff still can, which is why this is a note rather than a
     * disabled cell.
     */
    if (!canGuestBookDate(entry).allowed) {
      return {
        hint: `${entry.remainingSeats} · desk`,
        status:
          `${entry.remainingSeats} of ${entry.capacity} seats free, guest bookings closed — ` +
          "reception only" + (entry.premium ? ", invitation only" : ""),
        tone: "default",
        premium: entry.premium,
      };
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

  /**
   * Saved on change, through the settings endpoint.
   *
   * It is a label, not a conversion: nothing in this app converts between
   * zones, and every time is worked out from the server's clock. What this
   * changes is what those times are *called* on a guest's screen — which is
   * why the mismatch warning below matters more than the select does.
   */
  const saveTimeZone = async (next: TimeZone) => {
    const previous = timeZone;
    setTimeZone(next);
    setSavingTimeZone(true);
    setError("");
    setNotice("");

    try {
      const response = await fetch("/api/admin/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ timeZone: next }),
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(data.error ?? "Unable to save the time zone.");
      }

      setNotice(`Times are now shown as ${shortTimeZoneLabel(next)}. Reload to update the warning, if any.`);
    } catch (saveError) {
      // Put it back, so the select never shows a zone that was not stored.
      setTimeZone(previous);
      setError(saveError instanceof Error ? saveError.message : "Unable to save the time zone.");
    } finally {
      setSavingTimeZone(false);
    }
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
        // Built by `toRestaurantDatePayload`, not listed here: a field added
        // to the type later must not be silently dropped on the way out, which
        // is exactly how the booking cutoff came to save as 0 every time.
        body: JSON.stringify(toRestaurantDatePayload(selectedEntry)),
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

              <div>
                <label htmlFor="restaurant-time-zone" className="text-sm font-medium text-ink">
                  Times are
                </label>
                <select
                  id="restaurant-time-zone"
                  value={timeZone}
                  disabled={savingTimeZone}
                  onChange={(event) => void saveTimeZone(event.target.value as TimeZone)}
                  className="mt-2 block min-h-11 rounded-control border border-line-strong bg-surface px-3 text-sm font-medium text-ink"
                >
                  {TIME_ZONES.map((zone) => (
                    <option key={zone} value={zone}>
                      {zone === "UTC" ? "UTC" : `${cityOf(zone)} — ${utcOffsetLabel(zone)}`}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          }
        />

        {/*
          Loud on purpose. Every time this app prints is computed from the
          server's clock, so a zone that disagrees with it does not shift the
          times — it mislabels them, confidently, by the difference. A guest
          told "19:00 Sofia time" for a sitting the server thinks is 19:00 UTC
          arrives two hours late, and nothing else on any screen would hint at
          it.
        */}
        {clockMismatch ? (
          <Alert tone="danger" className="mt-4">
            <span className="font-semibold">The server clock and the time zone setting disagree.</span>{" "}
            {clockMismatch}
          </Alert>
        ) : null}

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

                  {/*
                    Per evening, because it is not one number: a quiet Tuesday
                    can take a booking an hour before service and a full
                    Saturday cannot. Reception is never bound by it, and the
                    hint says so — otherwise the first thing anyone does with a
                    cutoff is worry they have locked themselves out.
                  */}
                  <Field
                    label="Guest bookings close"
                    hint={describeCutoff(selectedEntry)}
                  >
                    {(fieldProps) => (
                      <div className="flex items-center gap-2">
                        <Input
                          {...fieldProps}
                          type="number"
                          min={0}
                          max={240}
                          step={1}
                          inputMode="numeric"
                          className="w-28"
                          value={selectedEntry.bookingCutoffHours ?? 0}
                          onChange={(event) =>
                            patchSelected({
                              bookingCutoffHours: Math.max(
                                0,
                                Math.min(240, Math.round(Number(event.target.value) || 0)),
                              ),
                            })
                          }
                        />
                        <span className="text-sm text-ink-muted">hours before the sitting</span>
                      </div>
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
        menu={eveningMenu}
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
