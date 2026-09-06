"use client";

import { useEffect, useState } from "react";
import { Card, CardHeader } from "@/components/ui/card";
import { Alert, Badge, EmptyState, Skeleton } from "@/components/ui/feedback";
import { Button } from "@/components/ui/button";
import { SEAT_HOLD_MINUTES, SEAT_HOLD_STEP_LABELS, seatHoldSecondsLeft } from "@/lib/seat-hold";
import type { SeatHoldRecord } from "@/lib/seat-hold";

/**
 * Bookings that were started on this evening — the ones still going, and the
 * ones nobody finished.
 *
 * ## The conversation this exists for
 *
 * A guest comes to the desk certain they booked. There is no booking. Until
 * this there was nothing to check and no way to be fair to either of them: the
 * only honest answer was "there is no reservation", which sounds like calling
 * them a liar, and staff had no idea whether the guest had genuinely got
 * halfway and lost the thread or had never opened the page at all.
 *
 * Now the evening can say. **Room 402 started booking 4 guests at 18:41, was
 * choosing from the menu, and did not finish.** That is a fact both sides can
 * work from, and usually it is the guest who is remembering right — they did
 * everything except the last screen.
 *
 * ## And why an evening can look fuller than its bookings
 *
 * The other half of the same question, from the other side of the desk. Seats
 * held by a guest mid-booking are gone from the room and are in no reservation,
 * so an evening could read as full with nothing anywhere accounting for the
 * difference. The live rows here are that accounting.
 *
 * It fetches its own data rather than being handed it: this is a panel that
 * answers a question somebody has just thought of, and it must be current at
 * the moment they look rather than as old as the page.
 */
export function UnfinishedBookings({ date }: { date: string }) {
  const [holds, setHolds] = useState<SeatHoldRecord[] | null>(null);
  const [error, setError] = useState("");
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let current = true;

    // Cleared through the state setter rather than before the request, so
    // switching evenings does not blank the panel and then fill it again.
    void (async () => {
      try {
        const response = await fetch(`/api/admin/seat-holds?date=${encodeURIComponent(date)}`);

        if (!response.ok) {
          throw new Error("Unable to load unfinished bookings.");
        }

        const { holds: loaded } = (await response.json()) as { holds: SeatHoldRecord[] };

        if (current) {
          setHolds(loaded);
          setError("");
        }
      } catch (loadError) {
        if (current) {
          setHolds([]);
          setError(loadError instanceof Error ? loadError.message : "Unable to load unfinished bookings.");
        }
      }
    })();

    // A late answer for an evening nobody is looking at must not land on the
    // one they are.
    return () => {
      current = false;
    };
  }, [date, reloadToken]);

  const live = holds?.filter((hold) => hold.status === "live" && seatHoldSecondsLeft(hold.expiresAt) > 0) ?? [];
  const abandoned = holds?.filter((hold) => hold.status === "abandoned") ?? [];
  const heldSeats = live.reduce((total, hold) => total + hold.guests, 0);

  return (
    <Card className="mt-6 p-5 sm:p-6">
      <CardHeader
        as="h2"
        eyebrow="Bookings in progress"
        title="Started, and not finished"
        description={
          `Seats are held for ${SEAT_HOLD_MINUTES} minutes while a guest books. ` +
          "Held seats are not in any reservation yet, which is why an evening can read as full with fewer bookings than seats."
        }
        actions={
          <Button variant="secondary" onClick={() => setReloadToken((token) => token + 1)}>
            Refresh
          </Button>
        }
      />

      {error ? (
        <Alert tone="danger" className="mt-4">
          {error}
        </Alert>
      ) : null}

      {holds === null ? (
        <div className="mt-4 space-y-2">
          <Skeleton className="h-14" />
          <Skeleton className="h-14" />
        </div>
      ) : holds.length === 0 ? (
        <EmptyState
          title="Nothing in progress"
          description="Nobody is part-way through booking this evening, and nobody has started one and walked away."
        />
      ) : (
        <div className="mt-4 space-y-5">
          {live.length > 0 ? (
            <section>
              <h3 className="eyebrow">
                Holding seats now — {heldSeats} seat{heldSeats === 1 ? "" : "s"} out of the room
              </h3>
              <ul className="mt-2 space-y-2">
                {live.map((hold) => (
                  <HoldRow key={hold.holdId} hold={hold} />
                ))}
              </ul>
            </section>
          ) : null}

          {abandoned.length > 0 ? (
            <section>
              <h3 className="eyebrow">Started and never finished</h3>
              <ul className="mt-2 space-y-2">
                {abandoned.map((hold) => (
                  <HoldRow key={hold.holdId} hold={hold} />
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      )}
    </Card>
  );
}

/**
 * One attempt.
 *
 * Says the four things that settle the conversation at the desk: who, how
 * many, when they started, and how far they got. The seats they are holding are
 * shown only while they still are, because a number of seats beside an
 * abandoned attempt reads as though they are still gone.
 */
function HoldRow({ hold }: { hold: SeatHoldRecord }) {
  const secondsLeft = seatHoldSecondsLeft(hold.expiresAt);
  const isLive = hold.status === "live" && secondsLeft > 0;

  return (
    <li className="rounded-control border border-line bg-surface-muted p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-semibold text-ink">
          {hold.roomNumber ? `Room ${hold.roomNumber}` : "Room not recorded"}
          <span className="ml-2 font-normal text-ink-muted">
            · {hold.guests} guest{hold.guests === 1 ? "" : "s"}
          </span>
        </p>

        {isLive ? (
          <Badge tone="warning">
            Holding {hold.guests} · {Math.ceil(secondsLeft / 60)} min left
          </Badge>
        ) : (
          <Badge tone="info">Not finished</Badge>
        )}
      </div>

      <p className="mt-1 text-sm text-ink-muted">
        {hold.step ? SEAT_HOLD_STEP_LABELS[hold.step] : "started a booking"}
        {hold.createdAt ? ` · started ${formatClock(hold.createdAt)}` : ""}
        {/*
          Only for an attempt that is over. On a live one the guest is still
          going, and a time stamped on it would read as though they had stopped.
        */}
        {!isLive && hold.closedAt ? ` · seats released ${formatClock(hold.closedAt)}` : ""}
      </p>
    </li>
  );
}

/**
 * The time of day, on the machine's clock.
 *
 * Which is the restaurant's clock (rule 2.1), and the same one every other time
 * on this dashboard is drawn against — the date is not repeated because the
 * whole panel is one evening.
 */
function formatClock(iso: string) {
  const at = new Date(iso);
  return Number.isNaN(at.getTime())
    ? "—"
    : at.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}
