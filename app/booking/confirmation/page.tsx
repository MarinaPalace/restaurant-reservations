"use client";

import { useMemo } from "react";

export default function ConfirmationPage() {
  const reservation = useMemo(() => {
    if (typeof window === "undefined") {
      return null;
    }

    const stored = window.sessionStorage.getItem("reservation-confirmation");
    if (!stored) {
      return null;
    }

    try {
      return JSON.parse(stored) as {
        reservationNumber?: string;
        roomNumber?: number;
        guestCount?: number;
        date?: string;
        selections?: Array<{ guestIndex?: number; courseName: string; optionName: string }>;
      };
    } catch {
      return null;
    }
  }, []);

  if (!reservation) {
    return (
      <main className="min-h-screen bg-[#f7f3ee] p-4 text-[#1d1b1a]">
        <div className="mx-auto flex min-h-screen max-w-md items-center justify-center">
          <div className="rounded-[28px] border border-[#e7d8c6] bg-white p-6 text-center shadow-[0_18px_55px_rgba(49,31,13,0.08)]">
            <p className="text-lg font-medium text-[#7a6455]">No reservation found.</p>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#f7f3ee] p-4 text-[#1d1b1a]">
      <div className="mx-auto flex min-h-screen max-w-md items-center justify-center">
        <div className="w-full rounded-[28px] border border-[#e7d8c6] bg-white p-6 shadow-[0_18px_55px_rgba(49,31,13,0.08)]">
          <div className="mb-5 text-center">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-[#edf6ee] text-3xl text-[#2f7d51]">✓</div>
            <h1 className="text-3xl font-semibold tracking-tight">Reservation Confirmed</h1>
            <p className="mt-2 text-base text-[#5f5148]">Thank you.</p>
          </div>

          <dl className="space-y-3 rounded-2xl bg-[#faf7f3] p-4 text-sm text-[#564d46]">
            <div className="flex justify-between gap-3">
              <dt className="font-medium uppercase tracking-wide text-[#7a6455]">Room</dt>
              <dd className="font-semibold text-[#1d1b1a]">{reservation.roomNumber}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="font-medium uppercase tracking-wide text-[#7a6455]">Date</dt>
              <dd className="font-semibold text-[#1d1b1a]">
                {reservation.date ? new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric" }).format(new Date(`${reservation.date}T12:00:00`)) : "-"}
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="font-medium uppercase tracking-wide text-[#7a6455]">Guests</dt>
              <dd className="font-semibold text-[#1d1b1a]">{reservation.guestCount}</dd>
            </div>
          </dl>

          <div className="mt-5 rounded-2xl border border-[#e7d8c6] bg-[#fffdfb] p-4">
            <div className="text-[10px] font-medium uppercase tracking-[0.2em] text-[#8e6b49]">Reservation Number</div>
            <div className="mt-1 text-2xl font-semibold tracking-[0.18em]">{reservation.reservationNumber}</div>
          </div>

          <div className="mt-5 space-y-3">
            {reservation.selections?.map((selection, index) => (
              <div key={`${selection.courseName}-${selection.guestIndex ?? "guest"}-${index}`} className="rounded-2xl border border-[#f0e6db] bg-[#f9f5f1] p-3">
                <div className="text-[10px] font-medium uppercase tracking-[0.2em] text-[#8e6b49]">
                  {selection.guestIndex !== undefined ? `Guest ${selection.guestIndex + 1}` : "Selection"}
                </div>
                <div className="mt-1 text-[10px] font-medium uppercase tracking-[0.2em] text-[#8e6b49]">{selection.courseName}</div>
                <div className="mt-1 text-lg font-semibold text-[#1d1b1a]">{selection.optionName}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </main>
  );
}
