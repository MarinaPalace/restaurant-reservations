"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { MenuCourse, ReservationSelection } from "@/types/booking";

function normalizeSelections(value: unknown): ReservationSelection[] {
  if (Array.isArray(value)) {
    return value as ReservationSelection[];
  }

  if (!value || typeof value !== "object") {
    return [];
  }

  return Object.values(value as Record<string, Record<string, unknown>>).map((entry) => ({
    guestIndex: Number((entry as { guestIndex?: number }).guestIndex ?? 0),
    courseId: String((entry as { courseId?: string }).courseId ?? ""),
    courseName: String((entry as { courseName?: string }).courseName ?? ""),
    optionId: String((entry as { optionId?: string }).optionId ?? ""),
    optionName: String((entry as { optionName?: string }).optionName ?? ""),
  }));
}

function formatSummaryDate(value: string) {
  if (!value || value === "-") {
    return "-";
  }

  const parsed = new Date(`${value}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric" }).format(parsed);
}

export default function SummaryPage() {
  const router = useRouter();
  const [menu, setMenu] = useState<MenuCourse[]>([]);
  const [roomNumber, setRoomNumber] = useState("-");
  const [guestCount, setGuestCount] = useState(1);
  const [selectedDate, setSelectedDate] = useState("-");
  const [selections, setSelections] = useState<ReservationSelection[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    if (typeof window !== "undefined") {
      setRoomNumber(window.sessionStorage.getItem("booking-room-number") ?? "-");
      setGuestCount(Number(window.sessionStorage.getItem("booking-guest-count") ?? "1") || 1);
      setSelectedDate(window.sessionStorage.getItem("booking-date") ?? "-");

      try {
        const selected = window.sessionStorage.getItem("booking-selections");
        setSelections(selected ? normalizeSelections(JSON.parse(selected)) : []);
      } catch {
        setSelections([]);
      }
    }

    fetch("/api/menu")
      .then((response) => response.json())
      .then((data) => setMenu(Array.isArray(data) ? data : []));
  }, []);

  const validGuestCount = Number.isFinite(guestCount) && guestCount > 0 ? guestCount : 1;

  const selectedEntries = useMemo(
    () =>
      selections.map((entry) => {
        const course = menu.find((item) => item.id === entry.courseId);
        return {
          ...entry,
          courseName: course?.name ?? entry.courseName,
        };
      }),
    [menu, selections],
  );

  const groupedSelections = useMemo(
    () =>
      Array.from({ length: validGuestCount }, (_, guestIndex) => ({
        guestIndex,
        entries: selectedEntries.filter((entry) => entry.guestIndex === guestIndex),
      })),
    [validGuestCount, selectedEntries],
  );

  const handleConfirm = async () => {
    try {
      const payload = {
        roomNumber: Number(roomNumber),
        guestCount: validGuestCount,
        date: selectedDate,
        selections: selections.map((entry) => ({
          guestIndex: entry.guestIndex,
          courseId: entry.courseId,
          courseName: entry.courseName,
          optionId: entry.optionId,
          optionName: entry.optionName,
        })),
      };

      const response = await fetch("/api/reservations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await response.json();
      if (!response.ok) {
        const message = data.error || "Something went wrong while creating your reservation. Please try again.";
        if (message.includes("date") || message.includes("available") || message.includes("choose another evening")) {
          sessionStorage.setItem("booking-error", message);
          router.push("/booking/date");
          return;
        }

        setError(message);
        return;
      }

      sessionStorage.setItem("reservation-confirmation", JSON.stringify(data.reservation));
      router.push("/booking/confirmation");
    } catch {
      setError("Something went wrong while creating your reservation. Please try again.");
    }
  };

  return (
    <main className="min-h-screen bg-[#f7f3ee] p-4 text-[#1d1b1a]">
      <div className="mx-auto max-w-2xl py-8">
        <div className="rounded-[28px] border border-[#e7d8c6] bg-white p-6 shadow-[0_18px_55px_rgba(49,31,13,0.08)]">
          <div className="mb-6 text-center">
            <p className="text-xs font-medium uppercase tracking-[0.22em] text-[#8e6b49]">À LA CARTE RESTAURANT</p>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight">Your Reservation</h2>
          </div>

          <dl className="grid grid-cols-2 gap-3 rounded-2xl bg-[#faf7f3] p-4 text-sm text-[#564d46]">
            <div>
              <dt className="font-medium uppercase tracking-wide text-[#7a6455]">Room</dt>
              <dd className="mt-1 text-lg font-semibold text-[#1d1b1a]">{roomNumber}</dd>
            </div>
            <div>
              <dt className="font-medium uppercase tracking-wide text-[#7a6455]">Guests</dt>
              <dd className="mt-1 text-lg font-semibold text-[#1d1b1a]">{validGuestCount}</dd>
            </div>
            <div className="col-span-2">
              <dt className="font-medium uppercase tracking-wide text-[#7a6455]">Date</dt>
              <dd className="mt-1 text-lg font-semibold text-[#1d1b1a]">{formatSummaryDate(selectedDate)}</dd>
            </div>
          </dl>

          <div className="mt-6 space-y-4">
            {groupedSelections.map(({ guestIndex, entries }) => (
              <div key={guestIndex} className="rounded-2xl border border-[#e7d8c6] bg-[#fffdfb] p-4">
                <div className="mb-2 text-[10px] font-medium uppercase tracking-[0.2em] text-[#8e6b49]">Guest {guestIndex + 1}</div>
                {entries.length === 0 ? (
                  <div className="text-sm text-[#695d53]">No menu choices selected yet.</div>
                ) : (
                  <div className="space-y-2">
                    {entries.map((entry) => (
                      <div key={`${entry.guestIndex}-${entry.courseId}`} className="flex items-center justify-between rounded-xl border border-[#f0e6db] bg-white px-3 py-2">
                        <div>
                          <div className="text-[10px] font-medium uppercase tracking-[0.2em] text-[#8e6b49]">{entry.courseName}</div>
                          <div className="mt-1 text-base font-semibold">{entry.optionName}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>

          {error ? <p className="mt-4 rounded-2xl border border-[#f1d5d1] bg-[#fef3f0] p-3 text-sm font-medium text-[#a63a2d]">{error}</p> : null}

          <div className="mt-6 flex gap-3">
            <button type="button" onClick={() => router.back()} className="flex-1 rounded-2xl border border-[#d7c8b6] bg-white px-5 py-4 text-lg font-semibold text-[#1d1b1a]">Back</button>
            <button type="button" onClick={handleConfirm} className="flex-1 rounded-2xl bg-[#1d1b1a] px-5 py-4 text-lg font-semibold text-white">Confirm Reservation</button>
          </div>
        </div>
      </div>
    </main>
  );
}
