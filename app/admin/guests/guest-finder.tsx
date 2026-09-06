"use client";

import { useState } from "react";
import Link from "next/link";
import { Card, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert, Badge, EmptyState, Skeleton } from "@/components/ui/feedback";
import { Field, Input } from "@/components/ui/field";
import { QrScanner } from "@/components/qr-scanner";
import { formatLongDate, isPastDateKey } from "@/lib/date";
import { SEAT_HOLD_STEP_LABELS } from "@/lib/seat-hold";
import type { SeatHoldRecord } from "@/lib/seat-hold";
import type { GuestLookupKey } from "@/lib/services/guest-lookup";
import type { ReservationRecord } from "@/types/booking";

/**
 * Finding a guest at the desk.
 *
 * One box and one camera, because the person serving a guest should not have
 * to know what they are holding before they can start. A scanned pass-key card,
 * a scanned confirmation card, a code read aloud, the hotel's own booking
 * reference — all of them go in the same place, and the server works out which
 * it was given.
 *
 * ## What it answers
 *
 * Not "here is the booking" but "here is the guest": every dinner on that key,
 * past and future, and — the part that could not be answered at all before —
 * every booking they started and never finished. That last list is the whole
 * reason this page is worth having on a busy evening, because the hardest
 * version of this conversation is the one where the guest is certain they
 * booked and there is nothing to show them.
 */

type Match = {
  passKey: GuestLookupKey;
  reservations: ReservationRecord[];
  unfinished: SeatHoldRecord[];
};

type Result = {
  matches: Match[];
  orphanReservations: ReservationRecord[];
  unreadable: boolean;
};

export function GuestFinder() {
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  /** What was actually searched for, so the empty state can name it. */
  const [searched, setSearched] = useState("");

  const search = async (raw: string) => {
    const value = raw.trim();

    if (!value || searching) {
      return;
    }

    setSearching(true);
    setError("");
    setSearched(value);

    try {
      const response = await fetch("/api/admin/guest-lookup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // A pass-key may be in here, so it goes in the body and never the URL.
        body: JSON.stringify({ query: value }),
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        setResult(null);
        setError(typeof data.error === "string" ? data.error : "Unable to search just now.");
        return;
      }

      setResult(data as Result);
    } catch {
      setResult(null);
      setError("Could not reach the server. Check the connection and try again.");
    } finally {
      setSearching(false);
    }
  };

  return (
    <>
      <Card className="p-5 sm:p-6" as="section">
        <CardHeader
          as="h1"
          eyebrow="Reception"
          title="Find a guest"
          description="Scan their pass-key card or confirmation card, or type a pass-key, a reservation number, or the hotel booking reference."
        />

        <div className="mt-5 grid gap-5 md:grid-cols-2">
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void search(query);
            }}
          >
            <Field label="Code or reference" hint="e.g. VDM-3E94B8, VDM-K7QP3-M2XR4, or 10245">
              {(fieldProps) => (
                <Input
                  {...fieldProps}
                  value={query}
                  autoCapitalize="characters"
                  autoComplete="off"
                  placeholder="Scan, or type here"
                  onChange={(event) => setQuery(event.target.value)}
                />
              )}
            </Field>

            <Button type="submit" className="mt-3 w-full" loading={searching} loadingLabel="Searching…">
              Find
            </Button>
          </form>

          <div>
            {/*
              Beside the box, never instead of it. Cameras get refused, break,
              and are missing on a desktop — and the desk cannot stop working
              when one does.
            */}
            <QrScanner
              onScan={(value) => {
                setQuery(value);
                void search(value);
              }}
              labels={{
                start: "Scan a card",
                stop: "Stop scanning",
                scanning: "Point the camera at the code",
                noCamera: "No camera available on this device. Type the code instead.",
                denied: "The camera was blocked. Allow it in your browser, or type the code instead.",
                hint: "Hold the card inside the square.",
              }}
            />
          </div>
        </div>

        {error ? (
          <Alert tone="danger" className="mt-4">
            {error}
          </Alert>
        ) : null}
      </Card>

      {searching && !result ? (
        <Card className="mt-6 p-5 sm:p-6">
          <Skeleton className="h-24" />
        </Card>
      ) : null}

      {result ? <Results result={result} searched={searched} /> : null}
    </>
  );
}

function Results({ result, searched }: { result: Result; searched: string }) {
  if (result.unreadable) {
    return (
      <Card className="mt-6 p-5 sm:p-6">
        <EmptyState
          title="That does not look like one of ours"
          description={`"${searched}" is not a pass-key, a reservation number or a booking reference. If it was scanned, try holding the card straighter.`}
        />
      </Card>
    );
  }

  if (result.matches.length === 0 && result.orphanReservations.length === 0) {
    return (
      <Card className="mt-6 p-5 sm:p-6">
        <EmptyState
          title="Nothing found"
          description={`No pass-key or reservation matches "${searched}". Check the code, or look the guest up by room on the dashboard.`}
        />
      </Card>
    );
  }

  return (
    <div className="mt-6 space-y-6">
      {result.matches.map((match) => (
        <GuestPanel key={match.passKey.id} match={match} />
      ))}

      {/*
        A dinner whose key has since been deleted. Rare, and shown rather than
        swallowed: the booking is real and on the sheet tonight.
      */}
      {result.orphanReservations.length > 0 ? (
        <Card className="p-5 sm:p-6" as="section">
          <CardHeader
            as="h2"
            eyebrow="Reservation"
            title="Found, but its pass-key is gone"
            description="The booking stands. The key it was made with has been deleted, so there is nothing else to show under it."
          />
          <ul className="mt-4 space-y-2">
            {result.orphanReservations.map((reservation) => (
              <ReservationRow key={reservation.reservationNumber} reservation={reservation} />
            ))}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}

function GuestPanel({ match }: { match: Match }) {
  const { passKey, reservations, unfinished } = match;
  const upcoming = reservations.filter((entry) => !isPastDateKey(entry.date));
  const past = reservations.filter((entry) => isPastDateKey(entry.date));

  return (
    <Card className="p-5 sm:p-6" as="section">
      <CardHeader
        as="h2"
        eyebrow={passKey.roomNumber ? `Room ${passKey.roomNumber}` : "Pass-key"}
        title={passKey.guestName || `Room ${passKey.roomNumber ?? "—"}`}
        description={
          passKey.reservationRef
            ? `Hotel booking ${passKey.reservationRef}`
            : "No hotel booking reference recorded on this key."
        }
      />

      {/*
        No pass-key code here, deliberately — see `GuestLookupKey`. Anybody who
        overheard a reservation number could otherwise read the credential that
        cancels that guest's dinner. Reading a code is `/admin/pass-keys`, which
        requires `passkeys:issue`.
      */}
      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        {passKey.status === "revoked" ? <Badge tone="danger">Pass-key withdrawn</Badge> : null}
        {passKey.kind === "premium" ? <Badge tone="warning">Invitation</Badge> : null}
        {passKey.expiresOn ? (
          <Badge tone="info">Checks out {passKey.expiresOn}</Badge>
        ) : null}
        <Badge tone={passKey.usedCount < passKey.maxUses ? "success" : "info"}>
          {passKey.usedCount} of {passKey.maxUses} dinners booked
        </Badge>
      </div>

      {reservations.length === 0 ? (
        <div className="mt-5">
          <EmptyState
            title="No reservations on this key"
            description="They have not booked a dinner yet — or they started and did not finish, which would show below."
          />
        </div>
      ) : (
        <>
          {upcoming.length > 0 ? (
            <section className="mt-5">
              <h3 className="eyebrow">Coming up</h3>
              <ul className="mt-2 space-y-2">
                {upcoming.map((reservation) => (
                  <ReservationRow key={reservation.reservationNumber} reservation={reservation} />
                ))}
              </ul>
            </section>
          ) : null}

          {past.length > 0 ? (
            <section className="mt-5">
              <h3 className="eyebrow">Already dined</h3>
              <ul className="mt-2 space-y-2">
                {past.map((reservation) => (
                  <ReservationRow key={reservation.reservationNumber} reservation={reservation} past />
                ))}
              </ul>
            </section>
          ) : null}
        </>
      )}

      {/*
        The list this page exists for. A guest certain they booked, and no
        booking — this says whether they are remembering right.
      */}
      {unfinished.length > 0 ? (
        <section className="mt-5 rounded-control border border-warning/30 bg-warning-soft p-4">
          <h3 className="eyebrow text-warning">Started and never finished</h3>
          <p className="mt-1 text-sm text-warning">
            These never became reservations. The seats were held while the guest was choosing and
            then released.
          </p>
          <ul className="mt-3 space-y-2">
            {unfinished.map((hold) => (
              <li key={hold.holdId} className="rounded-control border border-line bg-surface p-3 text-sm">
                <p className="font-semibold text-ink">
                  {formatLongDate(hold.date)}
                  <span className="ml-2 font-normal text-ink-muted">
                    · {hold.guests} guest{hold.guests === 1 ? "" : "s"}
                  </span>
                </p>
                <p className="mt-1 text-ink-muted">
                  {hold.step ? SEAT_HOLD_STEP_LABELS[hold.step] : "started a booking"}
                  {hold.createdAt ? ` · started ${new Date(hold.createdAt).toLocaleString()}` : ""}
                </p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </Card>
  );
}

function ReservationRow({
  reservation,
  past = false,
}: {
  reservation: ReservationRecord;
  past?: boolean;
}) {
  const cancelled = reservation.status === "cancelled";

  return (
    <li className="rounded-control border border-line bg-surface-muted p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <Link
          href={`/admin/reservation/${encodeURIComponent(reservation.reservationNumber)}`}
          className="font-mono text-sm font-semibold text-accent-ink underline underline-offset-2"
        >
          {reservation.reservationNumber}
        </Link>

        <div className="flex flex-wrap items-center gap-1.5">
          {cancelled ? <Badge tone="danger">Cancelled</Badge> : null}
          {past && !cancelled ? <Badge tone="info">Past</Badge> : null}
          {reservation.tableNumber ? <Badge tone="success">Table {reservation.tableNumber}</Badge> : null}
        </div>
      </div>

      <p className="mt-1 text-sm text-ink">
        {formatLongDate(reservation.date)}
        {reservation.time ? ` · ${reservation.time}` : ""}
        <span className="text-ink-muted">
          {" "}
          · Room {reservation.roomNumber} · {reservation.guestCount} guest
          {reservation.guestCount === 1 ? "" : "s"}
        </span>
      </p>
    </li>
  );
}
