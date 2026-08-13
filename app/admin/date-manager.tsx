"use client";

import { useMemo, useState } from "react";
import type { ReservationRecord, RestaurantDateAvailability } from "@/types/booking";

const MAX_DAYS = 42;

const formatDateKey = (date: Date) => date.toISOString().slice(0, 10);

const formatDateLabel = (date: string) =>
  new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" }).format(
    new Date(`${date}T12:00:00`),
  );

export function AdminDateManager({
  initialDates,
  initialReservations,
}: {
  initialDates: RestaurantDateAvailability[];
  initialReservations: ReservationRecord[];
}) {
  const [dates, setDates] = useState<RestaurantDateAvailability[]>(initialDates);
  const [reservations, setReservations] = useState<ReservationRecord[]>(initialReservations);
  const [selectedDate, setSelectedDate] = useState<string>(initialDates[0]?.date ?? formatDateKey(new Date()));
  const [month, setMonth] = useState(() => {
    const firstDate = initialDates[0]?.date ? new Date(`${initialDates[0].date}T12:00:00`) : new Date();
    return new Date(firstDate.getFullYear(), firstDate.getMonth(), 1);
  });
  const [dateInput, setDateInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const selectedEntry = dates.find((entry) => entry.date === selectedDate) ?? null;
  const selectedDayReservations = useMemo(
    () => reservations.filter((reservation) => reservation.date === selectedDate).sort((a, b) => a.roomNumber - b.roomNumber),
    [reservations, selectedDate],
  );

  const calendarDays = useMemo(() => {
    const start = new Date(month.getFullYear(), month.getMonth(), 1);
    const startDay = (start.getDay() + 6) % 7;
    const firstCalendarDate = new Date(start);
    firstCalendarDate.setDate(start.getDate() - startDay);

    return Array.from({ length: MAX_DAYS }, (_, index) => {
      const date = new Date(firstCalendarDate);
      date.setDate(firstCalendarDate.getDate() + index);
      return date;
    });
  }, [month]);

  const updateSelectedDate = (field: "isOpen" | "capacity", value: boolean | number) => {
    if (!selectedDate) return;

    setDates((current) =>
      current.map((entry) => (entry.date === selectedDate ? { ...entry, [field]: value } : entry)),
    );
  };

  const addDate = () => {
    const candidate = dateInput || selectedDate;
    if (!candidate) {
      setError("Choose a date first.");
      return;
    }

    if (dates.some((entry) => entry.date === candidate)) {
      setError("This date already exists in the availability list.");
      return;
    }

    const nextEntry: RestaurantDateAvailability = {
      date: candidate,
      isOpen: true,
      capacity: 40,
      reservedSeats: 0,
      remainingSeats: 40,
    };

    setDates((current) => [...current, nextEntry]);
    setSelectedDate(candidate);
    setMonth(new Date(`${candidate}T12:00:00`));
    setDateInput("");
    setError("");
  };

  const saveDate = async () => {
    if (!selectedDate) return;

    const entry = dates.find((item) => item.date === selectedDate);
    if (!entry) return;

    setSaving(true);
    setError("");

    try {
      const response = await fetch("/api/admin/dates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date: entry.date,
          isOpen: entry.isOpen,
          capacity: Number(entry.capacity),
        }),
      });

      if (!response.ok) {
        throw new Error("Unable to save date settings.");
      }

      const updated = await response.json();
      setDates((current) =>
        current.map((item) => (item.date === selectedDate ? { ...item, ...updated } : item)),
      );
    } catch {
      setError("Unable to save the availability for this date.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mt-8 rounded-[28px] border border-[#e7d8c6] bg-white p-6 shadow-[0_18px_55px_rgba(49,31,13,0.08)]">
      <div className="mb-5 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.22em] text-[#8e6b49]">AVAILABILITY</p>
          <h2 className="mt-2 text-2xl font-semibold">Restaurant availability calendar</h2>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <input
            type="date"
            value={dateInput}
            onChange={(event) => setDateInput(event.target.value)}
            className="rounded-2xl border border-[#d5c4ad] bg-[#fffdfb] px-4 py-3 outline-none"
          />
          <button type="button" onClick={addDate} className="rounded-2xl border border-[#d7c8b6] bg-white px-4 py-3 font-semibold text-[#1d1b1a]">
            Add date
          </button>
        </div>
      </div>

      {error ? <p className="mb-4 rounded-2xl border border-[#f1d5d1] bg-[#fef3f0] p-3 text-sm text-[#a63a2d]">{error}</p> : null}

      <div className="mb-5 flex items-center justify-between rounded-2xl bg-[#f8f1ea] p-3">
        <button type="button" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))} className="rounded-xl border border-[#dbc9b1] px-3 py-2 text-lg font-medium">←</button>
        <div className="text-lg font-semibold">{new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" }).format(month)}</div>
        <button type="button" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))} className="rounded-xl border border-[#dbc9b1] px-3 py-2 text-lg font-medium">→</button>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.45fr_0.95fr]">
        <div className="rounded-2xl border border-[#e7d8c6] bg-[#fffdfb] p-4">
          <div className="grid grid-cols-7 gap-2 text-center text-xs font-semibold uppercase tracking-wide text-[#7a6455]">
            {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((day) => (
              <div key={day}>{day}</div>
            ))}
          </div>

          <div className="mt-2 grid grid-cols-7 gap-2">
            {calendarDays.map((date) => {
              const dateKey = formatDateKey(date);
              const entry = dates.find((item) => item.date === dateKey);
              const isSelected = selectedDate === dateKey;
              const isCurrentMonth = date.getMonth() === month.getMonth();
              const remainingSeats = entry ? Math.max(entry.capacity - entry.reservedSeats, 0) : 0;

              return (
                <button
                  key={dateKey}
                  type="button"
                  onClick={() => setSelectedDate(dateKey)}
                  className={[
                    "flex min-h-[86px] flex-col justify-between rounded-2xl border p-2 text-left transition",
                    !isCurrentMonth ? "opacity-40" : "",
                    entry?.isOpen
                      ? "border-[#d7c8b6] bg-[#fffdfb] hover:border-[#8e6b49]"
                      : "border-[#f0e6db] bg-[#f8f2ec] text-[#a4988b]",
                    isSelected ? "border-[#1d1b1a] bg-[#1d1b1a] text-white" : "",
                  ].join(" ")}
                >
                  <span className="text-base font-semibold">{date.getDate()}</span>
                  <span className="text-[10px] leading-tight">
                    {entry
                      ? entry.isOpen
                        ? remainingSeats > 0
                          ? `${remainingSeats} free`
                          : "Full"
                        : "Closed"
                      : "-"}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="rounded-2xl border border-[#e7d8c6] bg-[#fffdfb] p-4">
          {selectedEntry ? (
            <>
              <div className="text-xs font-medium uppercase tracking-[0.2em] text-[#8e6b49]">Selected date</div>
              <div className="mt-2 text-2xl font-semibold">{formatDateLabel(selectedEntry.date)}</div>

              <div className="mt-5 space-y-4">
                <label className="flex items-center justify-between gap-4 rounded-2xl border border-[#d5c4ad] bg-[#f9f3ec] px-4 py-3 text-sm font-medium text-[#413a35]">
                  <span>Open for reservations</span>
                  <input
                    type="checkbox"
                    checked={Boolean(selectedEntry.isOpen)}
                    onChange={(event) => updateSelectedDate("isOpen", event.target.checked)}
                  />
                </label>

                <label className="block text-sm font-medium text-[#413a35]">
                  Total seats
                  <input
                    type="number"
                    min={1}
                    value={selectedEntry.capacity}
                    onChange={(event) => updateSelectedDate("capacity", Number(event.target.value || 0))}
                    className="mt-2 w-full rounded-2xl border border-[#d5c4ad] bg-[#fffdfb] px-4 py-3 outline-none"
                  />
                </label>
              </div>

              <div className="mt-5 flex flex-wrap gap-3 text-sm text-[#52443a]">
                <span className="rounded-full bg-[#edf6ee] px-3 py-1 font-medium text-[#2f7d51]">
                  {selectedEntry.isOpen ? `${Math.max(selectedEntry.capacity - selectedEntry.reservedSeats, 0)} free seats` : "Closed"}
                </span>
                <span className="rounded-full bg-[#f8f1ea] px-3 py-1 font-medium text-[#734d2a]">
                  {selectedEntry.reservedSeats} reserved
                </span>
              </div>

              <button
                type="button"
                onClick={saveDate}
                disabled={saving}
                className="mt-6 w-full rounded-2xl bg-[#1d1b1a] px-5 py-3 text-sm font-semibold text-white disabled:opacity-70"
              >
                {saving ? "Saving..." : "Save this date"}
              </button>
            </>
          ) : (
            <div className="flex h-full min-h-[240px] flex-col items-center justify-center text-center">
              <div className="text-xs font-medium uppercase tracking-[0.2em] text-[#8e6b49]">No date selected</div>
              <p className="mt-3 text-sm text-[#5f5148]">Choose a day from the calendar, or add a new date using the field above.</p>
              <button type="button" onClick={addDate} className="mt-5 rounded-2xl border border-[#d7c8b6] bg-white px-4 py-3 font-semibold text-[#1d1b1a]">
                Add selected date
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="mt-8 rounded-2xl border border-[#e7d8c6] bg-[#fffdfb] p-4">
        <div className="mb-4 flex items-center justify-between gap-4">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.22em] text-[#8e6b49]">REPORT</p>
            <h3 className="mt-2 text-xl font-semibold">Reservations for {selectedDate ? formatDateLabel(selectedDate) : "selected date"}</h3>
          </div>
          <button
            type="button"
            onClick={() => window.print()}
            className="rounded-2xl border border-[#d7c8b6] bg-white px-4 py-3 font-semibold text-[#1d1b1a]"
          >
            Print report
          </button>
        </div>

        {selectedDayReservations.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-[#d5c4ad] bg-[#f9f3ec] p-4 text-sm text-[#5f5148]">
            No reservations have been made for this date yet.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm print:table">
              <thead className="bg-[#f8f1ea] text-[#624f3f]">
                <tr>
                  <th className="px-4 py-3 font-semibold">Reservation</th>
                  <th className="px-4 py-3 font-semibold">Room</th>
                  <th className="px-4 py-3 font-semibold">Guests</th>
                  <th className="px-4 py-3 font-semibold">Choices</th>
                  <th className="px-4 py-3 font-semibold">Status</th>
                </tr>
              </thead>
              <tbody>
                {selectedDayReservations.map((reservation) => (
                  <tr key={reservation.reservationNumber} className="border-t border-[#f1e6db] align-top">
                    <td className="px-4 py-3 font-medium text-[#1d1b1a]">{reservation.reservationNumber}</td>
                    <td className="px-4 py-3">{reservation.roomNumber}</td>
                    <td className="px-4 py-3">{reservation.guestCount}</td>
                    <td className="px-4 py-3">
                      <div className="space-y-2">
                        {reservation.selections.length === 0 ? (
                          <span className="text-[#695d53]">No menu selections</span>
                        ) : (
                          reservation.selections.map((selection, index) => (
                            <div key={`${reservation.reservationNumber}-${index}`} className="rounded-xl bg-[#faf7f3] p-2">
                              <div className="font-medium text-[#1d1b1a]">{selection.courseName}</div>
                              <div className="text-[#5f5148]">{selection.optionName}</div>
                            </div>
                          ))
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 capitalize">{reservation.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
