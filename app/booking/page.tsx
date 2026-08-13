"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

export default function BookingPage() {
  const router = useRouter();
  const [roomNumber, setRoomNumber] = useState("");
  const [error, setError] = useState("");

  const handleContinue = () => {
    const trimmed = roomNumber.trim();
    if (!/^\d+$/.test(trimmed)) {
      setError("Please enter a valid room number.");
      return;
    }

    sessionStorage.setItem("booking-room-number", trimmed);
    router.push("/booking/guests");
  };

  const roomHelp = useMemo(() => roomNumber.trim() ? roomNumber.trim() : "Room Number", [roomNumber]);

  return (
    <main className="min-h-screen bg-[#f7f3ee] p-4 text-[#1d1b1a]">
      <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center">
        <div className="rounded-[28px] border border-[#e7d8c6] bg-white p-6 shadow-[0_18px_55px_rgba(49,31,13,0.08)]">
          <div className="mb-6 text-center">
            <p className="text-xs font-medium uppercase tracking-[0.22em] text-[#8e6b49]">À LA CARTE RESTAURANT</p>
            <h1 className="mt-4 text-4xl font-semibold tracking-tight text-[#1d1b1a]">Reserve Your Dinner</h1>
          </div>

          <label className="mb-2 block text-base font-medium text-[#2a231d]">Please enter your room number to begin.</label>
          <input
            aria-label="Room Number"
            inputMode="numeric"
            value={roomNumber}
            onChange={(event) => {
              setRoomNumber(event.target.value.replace(/\D+/g, ""));
              setError("");
            }}
            placeholder="Room Number"
            className="w-full rounded-2xl border border-[#d5c4ad] bg-[#fffdfb] px-4 py-4 text-xl outline-none transition focus:border-[#8e6b49] focus:ring-4 focus:ring-[#8e6b49]/10"
          />

          {error ? <p className="mt-3 text-sm font-medium text-[#a63a2d]">{error}</p> : null}

          <button
            type="button"
            onClick={handleContinue}
            className="mt-6 flex w-full items-center justify-center rounded-2xl bg-[#1d1b1a] px-5 py-4 text-lg font-semibold text-white shadow-sm transition hover:bg-[#2e2723]"
          >
            Continue
          </button>

          <div className="mt-6 rounded-2xl border border-[#efe4d4] bg-[#f9f5f1] p-3 text-sm text-[#5f5148]">
            Guest service hotline: <span className="font-semibold text-[#1d1b1a]">{roomHelp}</span>
          </div>
        </div>
      </div>
    </main>
  );
}
