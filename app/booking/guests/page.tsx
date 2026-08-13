"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

const GUEST_OPTIONS = [1, 2, 3, 4, 5, 6];

export default function GuestsPage() {
  const router = useRouter();
  const [selected, setSelected] = useState<number | null>(null);
  const [roomNumber, setRoomNumber] = useState("");

  useEffect(() => {
    if (typeof window !== "undefined") {
      const saved = Number(window.sessionStorage.getItem("booking-guest-count") ?? "");
      setSelected(Number.isFinite(saved) && saved > 0 ? saved : null);
      setRoomNumber(window.sessionStorage.getItem("booking-room-number") ?? "");
    }
  }, []);

  const continueBooking = () => {
    if (!selected) {
      return;
    }

    sessionStorage.setItem("booking-guest-count", String(selected));
    router.push("/booking/date");
  };

  return (
    <main className="min-h-screen bg-[#f7f3ee] p-4 text-[#1d1b1a]">
      <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center">
        <div className="rounded-[28px] border border-[#e7d8c6] bg-white p-6 shadow-[0_18px_55px_rgba(49,31,13,0.08)]">
          <div className="mb-5 text-center">
            <p className="text-xs font-medium uppercase tracking-[0.22em] text-[#8e6b49]">ROOM {roomNumber || "---"}</p>
            <h2 className="mt-4 text-3xl font-semibold tracking-tight text-[#1d1b1a]">How many guests will be dining?</h2>
          </div>

          <div className="grid grid-cols-3 gap-3">
            {GUEST_OPTIONS.map((option) => {
              const isSelected = selected === option;
              return (
                <button
                  key={option}
                  type="button"
                  onClick={() => setSelected(option)}
                  className={[
                    "rounded-2xl border px-4 py-5 text-center text-2xl font-semibold transition",
                    isSelected
                      ? "border-[#1d1b1a] bg-[#1d1b1a] text-white shadow-sm"
                      : "border-[#d7c8b6] bg-[#fffdfb] text-[#1d1b1a] hover:border-[#8e6b49]",
                  ].join(" ")}
                >
                  {option}
                </button>
              );
            })}
          </div>

          <button
            type="button"
            onClick={continueBooking}
            disabled={!selected}
            className="mt-6 flex w-full items-center justify-center rounded-2xl bg-[#1d1b1a] px-5 py-4 text-lg font-semibold text-white shadow-sm transition hover:bg-[#2e2723] disabled:cursor-not-allowed disabled:bg-[#c7b8a4]"
          >
            Continue
          </button>
        </div>
      </div>
    </main>
  );
}
