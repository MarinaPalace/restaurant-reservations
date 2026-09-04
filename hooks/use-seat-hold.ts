"use client";

import { useEffect, useMemo, useState } from "react";
import { writeBookingSession, useBookingSession } from "@/hooks/use-booking-session";
import { seatHoldStanding, type BookingSession, type SeatHoldStanding } from "@/lib/booking-session";
import type { SeatHoldStep } from "@/lib/seat-hold";

/**
 * The guest's side of the seat hold.
 *
 * Taking one is the only thing here that can fail in a way the guest has to
 * hear about, so it returns the server's answer rather than swallowing it. Every
 * screen that calls `takeSeatHold` shows what comes back — that is the whole
 * point of the feature, and the reason nothing in this module navigates
 * anywhere on its own.
 */

export type SeatHoldOutcome =
  | { ok: true; expiresAt: string }
  /**
   * Refused, with the reason as the server told it. `code` is the API's
   * contract and `error` its English sentence; the screen looks the code up in
   * its own dictionary and falls back to the sentence for a code it does not
   * know (`lib/i18n/errors.ts`).
   */
  | { ok: false; code: string; error: string };

/** Writes a hold into the session, or clears it when there is none. */
function storeHold(hold: { holdId: string; date: string; guests: number; expiresAt: string } | null) {
  writeBookingSession({
    holdId: hold?.holdId ?? "",
    holdExpiresAt: hold?.expiresAt ?? "",
    holdDate: hold?.date ?? "",
    holdGuests: hold?.guests ?? 0,
  });
}

/**
 * Takes seats out of the room for this party, on this evening.
 *
 * `previousHoldId` goes with it so the server moves the hold rather than
 * stacking a second one — a guest who changes the date three times must not
 * shut an evening on their own.
 */
export async function takeSeatHold(input: {
  passKey: string;
  date: string;
  guestCount: number;
  roomNumber?: string;
  previousHoldId?: string;
}): Promise<SeatHoldOutcome> {
  try {
    const response = await fetch("/api/booking/hold", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        passKey: input.passKey,
        date: input.date,
        guestCount: input.guestCount,
        // So an attempt nobody finishes has a room on it when staff are asked
        // about it later.
        roomNumber: input.roomNumber || undefined,
        previousHoldId: input.previousHoldId || undefined,
      }),
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      /**
       * The seats were not held, so the session must not go on claiming they
       * were. Clearing it matters most in the case that looks harmless — the
       * guest had a hold, changed the date, and the new evening is full: the
       * old hold is already gone on the server, and a session still naming it
       * would submit a booking against seats nobody has.
       */
      storeHold(null);

      return {
        ok: false,
        code: typeof data.code === "string" ? data.code : "",
        error: typeof data.error === "string" ? data.error : "",
      };
    }

    storeHold({
      holdId: String(data.hold?.holdId ?? ""),
      date: String(data.hold?.date ?? input.date),
      guests: Number(data.hold?.guests ?? input.guestCount),
      expiresAt: String(data.hold?.expiresAt ?? ""),
    });

    return { ok: true, expiresAt: String(data.hold?.expiresAt ?? "") };
  } catch {
    storeHold(null);
    return { ok: false, code: "CONNECTION", error: "" };
  }
}

/**
 * Gives the seats back before the fifteen minutes are up.
 *
 * Called when the guest returns to the calendar, because that is the moment
 * they have stopped wanting the evening they were holding. Waiting out the
 * clock would keep it shut against everybody else for no reason.
 *
 * The session is cleared first and the request is not waited on: whether the
 * server heard is not something to make the guest sit through, and a hold that
 * survives a lost request expires on its own anyway.
 */
export function releaseSeatHold(holdId: string) {
  storeHold(null);

  if (!holdId) {
    return;
  }

  void fetch("/api/booking/hold", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ holdId }),
    keepalive: true,
  }).catch(() => undefined);
}

/**
 * What the hold is worth, recomputed every second.
 *
 * A ticking clock rather than a value read once, because the thing being shown
 * is a countdown and the thing being guarded is a deadline.
 *
 * The tick sets *the time*, and the standing is derived from it during render
 * (rule 2.15: nothing sets state synchronously inside an effect). The interval
 * runs only while a hold is actually live — an expired hold cannot become more
 * expired, and a screen holding nothing has nothing to count.
 */
export function useSeatHold(): { session: BookingSession; standing: SeatHoldStanding } {
  const session = useBookingSession();
  const [now, setNow] = useState(() => Date.now());

  const standing = useMemo(() => seatHoldStanding(session, new Date(now)), [session, now]);
  const ticking = standing.state === "held";

  useEffect(() => {
    if (!ticking) {
      return;
    }

    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [ticking]);

  return { session, standing };
}

/**
 * Tells the server how far the guest has got.
 *
 * Fire-and-forget, and deliberately so: this exists for the desk, not for the
 * guest, and nothing about their booking may wait on it or fail with it. A
 * `keepalive` request survives the page navigating away, which is exactly the
 * moment worth recording — the guest reached the menu and then closed the tab.
 */
export function reportSeatHoldStep(holdId: string, step: SeatHoldStep) {
  if (!holdId) {
    return;
  }

  void fetch("/api/booking/hold", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ holdId, step }),
    keepalive: true,
  }).catch(() => undefined);
}

/**
 * Records that this screen was reached, once.
 *
 * Keyed on the hold and the step, so re-rendering does not re-send and a guest
 * moving back and forth sends one request per screen they actually arrive at.
 */
export function useReportSeatHoldStep(step: SeatHoldStep) {
  const session = useBookingSession();
  const holdId = session.holdId;

  useEffect(() => {
    reportSeatHoldStep(holdId, step);
  }, [holdId, step]);
}
