"use client";

import { useMemo, useState } from "react";
import { MonthCalendar, type DayState } from "@/components/month-calendar";
import { Card, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert, Badge, EmptyState } from "@/components/ui/feedback";
import { Field, Input, Select } from "@/components/ui/field";
import { InfoTip } from "@/components/ui/tooltip";
import { cx } from "@/components/ui/utils";
import { KitchenReport } from "@/app/admin/kitchen-report";
import { formatLongDate, isPastDateKey, isValidDateKey, startOfMonth } from "@/lib/date";
import { canGuestBookDate, getBookingDeadline } from "@/lib/reservation-policy";
import { toRestaurantDatePayload } from "@/lib/restaurant-date-form";
import {
  EVENING_FEATURES,
  EVENING_FEATURE_DESCRIPTIONS,
  EVENING_FEATURE_LABELS,
  hasOverrides,
  type EveningDefaults,
  type EveningFeature,
} from "@/lib/evening-features";
import { EVENING_FEATURE_PERMISSIONS } from "@/lib/auth/permissions";
import { FLOOR_PLAN_MODES, FLOOR_PLAN_MODE_LABELS, type FloorPlanMode } from "@/lib/floor-plan";
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
  /**
   * The evening the page was rendered for. Its bookings arrived with the page;
   * every other evening is fetched when it is first selected.
   */
  initialSelectedDate,
  menu,
  permissions,
  /** Which clock every time on these screens is quoted on. */
  initialTimeZone,
  initialEveningDefaults,
  /**
   * Set when the configured zone disagrees with the server's own clock, which
   * would mislabel every time by the difference. Worked out on the server,
   * because the server's clock is the one the app computes against.
   */
  clockMismatch,
}: {
  initialDates: RestaurantDateAvailability[];
  initialReservations: ReservationRecord[];
  initialSelectedDate: string;
  menu: MenuCourse[];
  /** What the signed-in account may do; the API enforces the same list. */
  permissions: StaffPermission[];
  initialTimeZone: TimeZone;
  /** What the restaurant does on an evening that does not say otherwise. */
  initialEveningDefaults: EveningDefaults;
  clockMismatch: string | null;
}) {
  const [timeZone, setTimeZone] = useState<TimeZone>(initialTimeZone);
  const [savingTimeZone, setSavingTimeZone] = useState(false);
  const [dates, setDates] = useState(initialDates);
  const [reservations, setReservations] = useState(initialReservations);
  const [selectedDate, setSelectedDate] = useState(initialSelectedDate);
  /**
   * Which evenings are already in `reservations`.
   *
   * The dashboard holds the days it has been shown, not the whole book. An
   * evening with no bookings still belongs here once it has been fetched —
   * otherwise an empty day would be requested again every time it is selected.
   */
  const [loadedDates, setLoadedDates] = useState<ReadonlySet<string>>(
    () => new Set([initialSelectedDate]),
  );
  const [loadingDay, setLoadingDay] = useState(false);
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
   * Fetches an evening unless it is already held.
   *
   * Days are kept once loaded, so moving back and forth across the calendar
   * costs one request per distinct evening and the edits already made on
   * screen are not thrown away by a reload. Rows already in hand win the
   * merge: one of them may have been changed since the request went out.
   *
   * Selecting a third evening while two are still in flight is harmless — the
   * merge is keyed by reservation number and only the selected day is
   * rendered, so a late answer for a day nobody is looking at cannot disturb
   * the one they are.
   */
  const ensureDayLoaded = async (date: string) => {
    if (loadedDates.has(date)) {
      return;
    }

    setLoadingDay(true);

    try {
      const response = await fetch(`/api/admin/reservations?date=${encodeURIComponent(date)}`);

      if (!response.ok) {
        throw new Error("Unable to load this evening's reservations.");
      }

      const { reservations: loaded } = (await response.json()) as {
        reservations: ReservationRecord[];
      };

      setReservations((current) => {
        const held = new Set(current.map((entry) => entry.reservationNumber));
        return [...current, ...loaded.filter((entry) => !held.has(entry.reservationNumber))];
      });
      setLoadedDates((current) => new Set(current).add(date));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load this evening.");
    } finally {
      setLoadingDay(false);
    }
  };

  /** Every route to a different evening goes through here, so none can skip the fetch. */
  const selectDate = (date: string) => {
    setSelectedDate(date);
    void ensureDayLoaded(date);
  };

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

  const can = (permission: StaffPermission) => permissions.includes(permission);

  /**
   * The restaurant-wide half, held here so the per-evening controls can say
   * what "Follow the restaurant" currently means. Saved on its own, the moment
   * it is changed — a half-edited evening should not have to be saved to change
   * what the restaurant normally does.
   */
  const [eveningDefaults, setEveningDefaults] = useState(initialEveningDefaults);
  const [savingDefaults, setSavingDefaults] = useState(false);

  const saveEveningDefault = async (patch: Partial<EveningDefaults>) => {
    const previous = eveningDefaults;
    setEveningDefaults({ ...previous, ...patch });
    setSavingDefaults(true);

    try {
      const response = await fetch("/api/admin/evening-defaults", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const body = await response.json().catch(() => null);

      if (!response.ok) {
        // Put the previous answer back, so the control never shows a policy
        // that was not stored.
        setEveningDefaults(previous);
        setError(body?.error ?? "Unable to save the setting.");
        return;
      }

      setEveningDefaults(body);
      setError("");
    } catch {
      setEveningDefaults(previous);
      setError("Unable to save the setting.");
    } finally {
      setSavingDefaults(false);
    }
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
      selectDate(newDate);
      return;
    }

    setDates((current) =>
      [...current, withRemainingSeats({ date: newDate, isOpen: true, capacity: 40, reservedSeats: 0 })].sort((a, b) =>
        a.date.localeCompare(b.date),
      ),
    );
    selectDate(newDate);
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
              onSelect={selectDate}
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
                <div className="flex items-baseline justify-between gap-2">
                  <h3 className="text-base font-semibold text-ink">
                    <time dateTime={selectedEntry.date}>{formatLongDate(selectedEntry.date)}</time>
                  </h3>
                  <span className="text-xs text-ink-subtle">
                    {selectedEntry.reservedSeats}/{selectedEntry.capacity} seats
                  </span>
                </div>

                <div className="mt-3 space-y-2.5">
                  {/*
                    The two switches that decide whether the evening exists at
                    all, side by side. Compact rows rather than full-width
                    cards: they are read at a glance far more often than they
                    are changed.
                  */}
                  <div className="grid gap-2 sm:grid-cols-2">
                    <label className="flex min-h-9 cursor-pointer items-center justify-between gap-2 rounded-control border border-line-strong bg-surface px-2.5 py-1.5">
                      <span className="flex items-center gap-1.5 text-sm font-medium text-ink">
                        Open
                        <InfoTip label="About open for reservations">
                          Closed keeps the evening on the calendar and takes it out of the booking flow. Bookings
                          already taken are untouched.
                        </InfoTip>
                      </span>
                      <input
                        type="checkbox"
                        className="size-4 accent-[var(--primary)]"
                        checked={selectedEntry.isOpen}
                        onChange={(event) => patchSelected({ isOpen: event.target.checked })}
                      />
                    </label>

                    <label className="flex min-h-9 cursor-pointer items-center justify-between gap-2 rounded-control border border-gold/60 bg-accent-soft px-2.5 py-1.5">
                      <span className="flex items-center gap-1.5 text-sm font-medium text-accent-ink">
                        <svg aria-hidden="true" viewBox="0 0 24 24" fill="currentColor" className="size-3.5 text-gold">
                          <path d="M12 2.6l2.7 5.9 6.4.7-4.8 4.3 1.3 6.3L12 16.7 6.4 19.8l1.3-6.3L2.9 9.2l6.4-.7z" />
                        </svg>
                        Invitation
                        <InfoTip label="About invitation only" align="end">
                          An invitation evening leaves the everyday flow entirely: it is hidden from hotel guests,
                          bookable only at /premium, and served from the premium menu.
                        </InfoTip>
                      </span>
                      <input
                        type="checkbox"
                        className="size-4 accent-[var(--primary)]"
                        checked={Boolean(selectedEntry.premium)}
                        onChange={(event) => patchSelected({ premium: event.target.checked })}
                      />
                    </label>
                  </div>

                  <div className="grid gap-2 sm:grid-cols-3">
                    <Field
                      label="Seats"
                      compact
                      hint={`${selectedEntry.reservedSeats} taken`}
                      tip="How many people the room can take this evening. Lowering it below what is already booked is refused — the seats are held."
                      error={
                        selectedEntry.capacity < selectedEntry.reservedSeats
                          ? "Below what is already reserved."
                          : undefined
                      }
                    >
                      {(fieldProps) => (
                        <Input
                          {...fieldProps}
                          compact
                          type="number"
                          min={0}
                          inputMode="numeric"
                          value={selectedEntry.capacity}
                          onChange={(event) => patchSelected({ capacity: Number(event.target.value || 0) })}
                        />
                      )}
                    </Field>

                    <Field
                      label="Arrival"
                      compact
                      tip="Everyone is seated at this time. It is copied onto each booking made for this evening, and it is what the calendar reminder says."
                    >
                      {(fieldProps) => (
                        <Input
                          {...fieldProps}
                          compact
                          type="time"
                          value={selectedEntry.serviceTime ?? ""}
                          onChange={(event) => patchSelected({ serviceTime: event.target.value })}
                        />
                      )}
                    </Field>

                    <Field
                      label="Ends"
                      compact
                      tipAlign="end"
                      tip="When the sitting finishes. Used for the calendar reminder the guest adds, and nothing else."
                    >
                      {(fieldProps) => (
                        <Input
                          {...fieldProps}
                          compact
                          type="time"
                          value={selectedEntry.serviceEndTime ?? ""}
                          onChange={(event) => patchSelected({ serviceEndTime: event.target.value })}
                        />
                      )}
                    </Field>
                  </div>

                  {/*
                    Everything below is set once and then left alone, so it is
                    folded away — but **only when it has nothing to say**. An
                    evening carrying a cutoff or its own switches opens with the
                    panel, because hiding a setting that is not at its default
                    is how somebody comes to wonder why one Thursday behaves
                    differently and finds nothing on the screen to explain it.
                  */}
                  <AdvancedEvening
                    entry={selectedEntry}
                    defaults={eveningDefaults}
                    can={can}
                    savingDefaults={savingDefaults}
                    onPatch={patchSelected}
                    onChangeDefault={saveEveningDefault}
                  />

                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge tone={selectedEntry.isOpen ? "success" : "info"}>
                      {selectedEntry.isOpen ? `${selectedEntry.remainingSeats} free` : "Closed"}
                    </Badge>
                    {hasOverrides(selectedEntry.features) ? <Badge tone="warning">Own settings</Badge> : null}
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
        loading={loadingDay}
      />
    </div>
  );
}

/**
 * The settings an evening is given once and then left alone — folded away.
 *
 * ## Why folded, and when it refuses to fold
 *
 * The panel is opened dozens of times a day to change a seat count or a time.
 * The cutoff and the feature switches are set on the rare evening that wants
 * them and never touched again, so making everybody scroll past them is a cost
 * paid every day for a decision taken once.
 *
 * But it opens **already expanded whenever this evening has anything to say**.
 * Hiding a setting that is not at its default is how somebody comes to wonder
 * why one Thursday behaves differently from every other and finds nothing on
 * the screen to explain it. Folded means "nothing unusual here", and that has
 * to be true or the fold is a lie.
 *
 * ## Two grains, one list
 *
 * The same three switches can be set for this evening or for every other one,
 * and they are the same list with a tab above it rather than two lists. Showing
 * them apart would have meant repeating every label and every explanation, and
 * would have hidden the thing actually worth understanding: that an evening
 * inherits until it says otherwise.
 *
 * A `<select>` per switch rather than a row of buttons, because "Follow the
 * restaurant (Staff only)" is a phrase, and four of those wrapped across a
 * narrow panel is most of its height.
 */
function AdvancedEvening({
  entry,
  defaults,
  can,
  savingDefaults,
  onPatch,
  onChangeDefault,
}: {
  entry: RestaurantDateAvailability;
  defaults: EveningDefaults;
  can: (permission: StaffPermission) => boolean;
  savingDefaults: boolean;
  onPatch: (patch: Partial<RestaurantDateAvailability>) => void;
  onChangeDefault: (patch: Partial<EveningDefaults>) => void;
}) {
  const cutoff = Math.max(0, Number(entry.bookingCutoffHours ?? 0));
  const unusual = hasOverrides(entry.features) || cutoff > 0;

  const [open, setOpen] = useState(unusual);
  const [grain, setGrain] = useState<"evening" | "restaurant">("evening");
  /**
   * Reopens when the selection moves to an evening that has something to say.
   * Derived from a render-time comparison rather than an effect, which keeps it
   * clear of the rule against setting state inside one (rule 2.15).
   */
  const [lastDate, setLastDate] = useState(entry.date);

  if (lastDate !== entry.date) {
    setLastDate(entry.date);
    setOpen(unusual);
    setGrain("evening");
  }

  const setOverride = (feature: EveningFeature, value: FloorPlanMode | boolean | undefined) => {
    const next = { ...entry.features };

    if (value === undefined) {
      delete next[feature];
    } else if (feature === "tableSelection") {
      next.tableSelection = value as FloorPlanMode;
    } else {
      next[feature] = value as boolean;
    }

    onPatch({ features: next });
  };

  /**
   * Table selection is the one with three answers of its own; the other two are
   * a plain yes or no. Shared by both grains, so the evening's control and the
   * restaurant's cannot come to offer different things.
   */
  const answersFor = (feature: EveningFeature): Array<{ label: string; value: FloorPlanMode | boolean }> =>
    feature === "tableSelection"
      ? FLOOR_PLAN_MODES.map((mode) => ({ label: FLOOR_PLAN_MODE_LABELS[mode], value: mode }))
      : [
          { label: "On", value: true },
          { label: "Off", value: false },
        ];

  const nameOf = (feature: EveningFeature, value: FloorPlanMode | boolean) =>
    answersFor(feature).find((answer) => answer.value === value)?.label ?? String(value);

  return (
    <div className="rounded-control border border-line bg-surface">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((was) => !was)}
        className="flex min-h-9 w-full items-center justify-between gap-2 px-2.5 py-1.5 text-sm font-medium text-ink-muted transition-colors hover:text-ink"
      >
        <span className="flex items-center gap-1.5">
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2.5}
            className={cx("size-3.5 transition-transform", open && "rotate-90")}
          >
            <path d="M9 5l7 7-7 7" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Advanced
        </span>
        {/* Says what is in there without opening it, so a folded panel is
            never hiding something somebody needed to know about. */}
        <span className="text-xs font-normal text-ink-subtle">
          {unusual ? "set for this evening" : "booking cutoff, what guests may do"}
        </span>
      </button>

      {open ? (
        <div className="space-y-3 border-t border-line px-2.5 py-3">
          <Field
            label="Guest bookings close"
            compact
            hint={describeCutoff(entry)}
            tip="Hours before the sitting that guests stop being able to book online. Reception is never bound by it — a table that has walked up to the desk can always be taken."
          >
            {(fieldProps) => (
              <div className="flex items-center gap-2">
                <Input
                  {...fieldProps}
                  compact
                  type="number"
                  min={0}
                  max={240}
                  step={1}
                  inputMode="numeric"
                  className="w-20"
                  value={entry.bookingCutoffHours ?? 0}
                  onChange={(event) =>
                    onPatch({
                      bookingCutoffHours: Math.max(0, Math.min(240, Math.round(Number(event.target.value) || 0))),
                    })
                  }
                />
                <span className="text-xs text-ink-muted">hours before</span>
              </div>
            )}
          </Field>

          <div className="border-t border-line pt-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="flex items-center gap-1.5 text-sm font-medium text-ink">
                What guests may do
                <InfoTip label="About what guests may do">
                  Each switch follows the restaurant until this evening says otherwise — which is how something new
                  gets tried on a single night, on a date nobody else can see, without touching tonight.
                </InfoTip>
              </span>

              {/* Which grain the list below is editing. */}
              <div className="inline-flex rounded-control border border-line-strong p-0.5" role="group">
                {(
                  [
                    { key: "evening" as const, label: "This evening" },
                    { key: "restaurant" as const, label: "Every evening" },
                  ]
                ).map((tab) => (
                  <button
                    key={tab.key}
                    type="button"
                    aria-pressed={grain === tab.key}
                    onClick={() => setGrain(tab.key)}
                    className={cx(
                      "rounded-[calc(var(--radius-control)-2px)] px-2 py-0.5 text-xs font-medium transition-colors",
                      grain === tab.key ? "bg-accent-soft text-accent-ink" : "text-ink-subtle hover:text-ink",
                    )}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="mt-2.5 space-y-2">
              {EVENING_FEATURES.map((feature) => {
                const editable = can(EVENING_FEATURE_PERMISSIONS[feature]);
                const inherited = defaults[feature];
                const override = entry.features?.[feature];

                const value =
                  grain === "restaurant" ? String(inherited) : override === undefined ? "" : String(override);

                const toValue = (raw: string): FloorPlanMode | boolean | undefined => {
                  if (raw === "") return undefined;
                  if (feature === "tableSelection") return raw as FloorPlanMode;
                  return raw === "true";
                };

                return (
                  <div key={feature} className="flex items-center justify-between gap-2">
                    <span className="flex min-w-0 items-center gap-1.5">
                      <span className="truncate text-sm text-ink">{EVENING_FEATURE_LABELS[feature]}</span>
                      <InfoTip label={`About ${EVENING_FEATURE_LABELS[feature].toLowerCase()}`}>
                        {EVENING_FEATURE_DESCRIPTIONS[feature]}
                        {editable ? "" : " Your account cannot change this one."}
                      </InfoTip>
                    </span>

                    <Select
                      compact
                      aria-label={`${EVENING_FEATURE_LABELS[feature]}, ${
                        grain === "restaurant" ? "every evening" : "this evening"
                      }`}
                      disabled={!editable || (grain === "restaurant" && savingDefaults)}
                      className="w-40 shrink-0"
                      value={value}
                      onChange={(event) => {
                        const next = toValue(event.target.value);

                        if (grain === "restaurant") {
                          // "Follow the restaurant" is not an answer the
                          // restaurant itself can give, so the option is absent
                          // from this grain and `next` is always defined here.
                          if (next !== undefined) {
                            onChangeDefault({ [feature]: next } as Partial<EveningDefaults>);
                          }
                          return;
                        }

                        setOverride(feature, next);
                      }}
                    >
                      {grain === "evening" ? (
                        // Named with what it currently resolves to, so
                        // "follow the restaurant" is never a state somebody
                        // has to go and look up.
                        <option value="">Follow the restaurant ({nameOf(feature, inherited)})</option>
                      ) : null}
                      {answersFor(feature).map((answer) => (
                        <option key={String(answer.value)} value={String(answer.value)}>
                          {answer.label}
                        </option>
                      ))}
                    </Select>
                  </div>
                );
              })}
            </div>

            <p className="mt-2 text-xs text-ink-subtle">
              {grain === "restaurant"
                ? "Saved as soon as you change it. Every evening that has not said otherwise moves with it."
                : "Saved with this date."}
            </p>
          </div>
        </div>
      ) : null}
    </div>
  );
}
