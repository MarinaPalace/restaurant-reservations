"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { readStoredGuestCount } from "@/lib/booking-session";
import type { RestaurantDateAvailability } from "@/types/booking";

const MAX_DAYS = 42;

function formatDateKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

export default function DatePage() {
  const router = useRouter();
  const [dates, setDates] = useState<RestaurantDateAvailability[]>([]);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [month, setMonth] = useState(() => new Date("2026-08-01T12:00:00"));
  const [loading, setLoading] = useState(true);
  const [guestCount, setGuestCount] = useState(1);

  useEffect(() => {
    if (typeof window !== "undefined") {
      setSelectedDate(window.sessionStorage.getItem("booking-date") ?? null);
      setGuestCount(readStoredGuestCount(window.sessionStorage));
    }

    fetch("/api/restaurant/dates")
      .then((response) => response.json())
      .then((data) => {
        setDates(Array.isArray(data) ? data : []);
      })
      .finally(() => setLoading(false));
  }, []);

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

  const isDateSelectable = (dateKey: string) => {
    const entry = dates.find((item) => item.date === dateKey);
    if (!entry || !entry.isOpen) return false;
    if (entry.remainingSeats <= 0) return false;
    if (entry.remainingSeats < guestCount) return false;
    return true;
  };

  const handleNext = () => {
    if (!selectedDate) return;
    sessionStorage.setItem("booking-date", selectedDate);
    router.push("/booking/menu");
  };

  const visibleDates = dates.filter((entry) => entry.date.startsWith(`${month.getFullYear()}-${String(month.getMonth()+1).padStart(2, "0")}`));

  return (
    <main className="min-h-screen bg-[#f7f3ee] p-4 text-[#1d1b1a]">
      <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center">
        <div className="rounded-[28px] border border-[#e7d8c6] bg-white p-5 shadow-[0_18px_55px_rgba(49,31,13,0.08)]">
          <div className="mb-5 flex items-center justify-between">
            <div>
              <p className="text-xs font-medium uppercase tracking-[0.22em] text-[#8e6b49]">DATE</p>
              <h2 className="mt-2 text-3xl font-semibold tracking-tight">Select a dinner date</h2>
            </div>
          </div>

          <div className="mb-4 flex items-center justify-between rounded-2xl bg-[#f8f1ea] p-3">
            <button type="button" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth()-1, 1))} className="rounded-xl border border-[#dbc9b1] px-3 py-2 text-lg font-medium">←</button>
            <div className="text-lg font-semibold">{new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" }).format(month)}</div>
            <button type="button" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth()+1, 1))} className="rounded-xl border border-[#dbc9b1] px-3 py-2 text-lg font-medium">→</button>
          </div>

          <div className="grid grid-cols-7 gap-2 text-center text-xs font-semibold uppercase tracking-wide text-[#7a6455]">
            {['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map((day) => <div key={day}>{day}</div>)}
          </div>

          <div className="mt-2 grid grid-cols-7 gap-2">
            {calendarDays.map((date) => {
              const dateKey = formatDateKey(date);
              const entry = dates.find((item) => item.date === dateKey);
              const selectable = isDateSelectable(dateKey);
              const isSelected = selectedDate === dateKey;
              const isCurrentMonth = date.getMonth() === month.getMonth();

              return (
                <button
                  key={dateKey}
                  type="button"
                  disabled={!selectable}
                  onClick={() => setSelectedDate(dateKey)}
                  className={[
                    "flex min-h-[72px] flex-col justify-between rounded-2xl border p-2 text-left transition",
                    !isCurrentMonth ? "opacity-40" : "",
                    selectable ? "border-[#d7c8b6] bg-[#fffdfb] hover:border-[#8e6b49]" : "cursor-not-allowed border-[#f0e6db] bg-[#f8f2ec] text-[#a4988b]",
                    isSelected ? "border-[#1d1b1a] bg-[#1d1b1a] text-white" : "",
                  ].join(" ")}
                >
                  <span className="text-base font-semibold">{date.getDate()}</span>
                  <span className="text-[10px] leading-tight">
                    {entry ? (entry.isOpen ? (entry.remainingSeats > 0 ? `${entry.remainingSeats} left` : "Fully booked") : "Closed") : "-"}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="mt-5 rounded-2xl border border-[#efe4d4] bg-[#faf7f3] p-3 text-sm text-[#52443a]">
            {selectedDate ? (
              <div>
                <div className="font-semibold text-[#1d1b1a]">{new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric" }).format(new Date(`${selectedDate}T12:00:00`))}</div>
                {(() => {
                  const entry = dates.find((item) => item.date === selectedDate);
                  if (!entry) return <div>Availability is being checked.</div>;
                  if (!entry.isOpen) return <div>Restaurant closed on this date.</div>;
                  if (entry.remainingSeats <= 0) return <div>Fully booked. Please choose another evening.</div>;
                  if (entry.remainingSeats < guestCount) return <div>Only {entry.remainingSeats} seats remain for {guestCount} guests.</div>;
                  return <div>{entry.remainingSeats} places remaining</div>;
                })()}
              </div>
            ) : (
              <div>Select a date to continue.</div>
            )}
          </div>

          <div className="mt-6 flex gap-3">
            <button type="button" onClick={() => router.back()} className="flex-1 rounded-2xl border border-[#d7c8b6] bg-white px-5 py-4 text-lg font-semibold text-[#1d1b1a]">Back</button>
            <button type="button" onClick={handleNext} disabled={!selectedDate} className="flex-1 rounded-2xl bg-[#1d1b1a] px-5 py-4 text-lg font-semibold text-white disabled:cursor-not-allowed disabled:bg-[#c7b8a4]">Continue</button>
          </div>

          {loading ? <p className="mt-4 text-sm text-[#6b5a4b]">Loading availability...</p> : null}
          {visibleDates.length === 0 && !loading ? <p className="mt-4 text-sm text-[#a63a2d]">No dates are currently available for this month.</p> : null}
        </div>
      </div>
    </main>
  );
}
