"use client";

import { useState } from "react";
import { DishImage } from "@/components/dish-image";
import { Card, CardHeader } from "@/components/ui/card";
import { Button, ButtonLink } from "@/components/ui/button";
import { Alert, Badge } from "@/components/ui/feedback";
import { Field, Input } from "@/components/ui/field";
import { formatLongDate } from "@/lib/date";
import { formatDeadline } from "@/lib/reservation-policy";
import { NONE_OPTION_ID, NONE_OPTION_NAME } from "@/lib/menu-selection";
import { cx } from "@/components/ui/utils";
import type { MenuCourse, ReservationRecord, ReservationSelection } from "@/types/booking";

type Loaded = {
  reservation: ReservationRecord;
  canModify: boolean;
  modificationDeadline: string;
  modificationBlockedReason: string | null;
};

/**
 * Self-service for a guest who has their reservation number: look the booking
 * up, change the menu choices, or cancel — all subject to the same cutoff the
 * server enforces.
 */
export function ManageReservation({ menu }: { menu: MenuCourse[] }) {
  const [reservationNumber, setReservationNumber] = useState("");
  const [roomNumber, setRoomNumber] = useState("");
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [lookupError, setLookupError] = useState("");
  const [busy, setBusy] = useState(false);

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<ReservationSelection[]>([]);
  const [activeGuest, setActiveGuest] = useState(0);
  const [actionError, setActionError] = useState("");
  const [notice, setNotice] = useState("");

  const lookup = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) {
      return;
    }

    setBusy(true);
    setLookupError("");
    setNotice("");

    try {
      const response = await fetch(
        `/api/reservations/${encodeURIComponent(reservationNumber.trim().toUpperCase())}` +
          `?roomNumber=${encodeURIComponent(roomNumber.trim())}`,
      );

      if (!response.ok) {
        setLookupError("We could not find a reservation with that number and room. Please check both and try again.");
        setLoaded(null);
        return;
      }

      const data: Loaded = await response.json();
      setLoaded(data);
      setDraft(data.reservation.selections);
      setEditing(false);
    } catch {
      setLookupError("We could not reach the restaurant. Please check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  const choose = (guestIndex: number, course: MenuCourse, option: { id: string; name: string }) => {
    setDraft((current) => [
      ...current.filter((entry) => !((entry.guestIndex ?? 0) === guestIndex && entry.courseId === course.id)),
      {
        guestIndex,
        courseId: course.id,
        courseName: course.name,
        optionId: option.id,
        optionName: option.name,
      },
    ]);
    setActionError("");
  };

  const saveChanges = async () => {
    if (!loaded || busy) {
      return;
    }

    setBusy(true);
    setActionError("");

    try {
      const response = await fetch(`/api/reservations/${encodeURIComponent(loaded.reservation.reservationNumber)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roomNumber, selections: draft }),
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        setActionError(data.error || "We could not save your changes.");
        return;
      }

      setLoaded({ ...loaded, reservation: data.reservation });
      setDraft(data.reservation.selections);
      setEditing(false);
      setNotice("Your menu choices have been updated.");
    } catch {
      setActionError("We could not reach the restaurant. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const cancelReservation = async () => {
    if (!loaded || busy) {
      return;
    }

    const confirmed = window.confirm(
      `Cancel reservation ${loaded.reservation.reservationNumber}? This cannot be undone.`,
    );
    if (!confirmed) {
      return;
    }

    setBusy(true);
    setActionError("");

    try {
      const response = await fetch(
        `/api/reservations/${encodeURIComponent(loaded.reservation.reservationNumber)}` +
          `?roomNumber=${encodeURIComponent(roomNumber.trim())}`,
        { method: "DELETE" },
      );

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        setActionError(data.error || "We could not cancel this reservation.");
        return;
      }

      setLoaded({ ...loaded, reservation: { ...loaded.reservation, status: "cancelled" }, canModify: false });
      setNotice("Your reservation has been cancelled.");
    } catch {
      setActionError("We could not reach the restaurant. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  if (!loaded) {
    return (
      <Card className="p-6">
        <CardHeader
          as="h1"
          align="center"
          flourish
          eyebrow="Your reservation"
          title="Manage your reservation"
          description="Enter the reservation number from your confirmation, along with your room number."
        />

        <form onSubmit={lookup} className="mt-6 space-y-4">
          <Field label="Reservation number">
            {(fieldProps) => (
              <Input
                {...fieldProps}
                autoFocus
                placeholder="e.g. VDM-3E94B8"
                autoCapitalize="characters"
                value={reservationNumber}
                onChange={(event) => setReservationNumber(event.target.value.toUpperCase())}
              />
            )}
          </Field>

          <Field label="Room number" error={lookupError}>
            {(fieldProps) => (
              <Input
                {...fieldProps}
                maxLength={10}
                placeholder="402 or L10"
                value={roomNumber}
                onChange={(event) => setRoomNumber(event.target.value.replace(/[^A-Za-z0-9-]/g, "").toUpperCase())}
              />
            )}
          </Field>

          <Button type="submit" size="lg" className="w-full" loading={busy} loadingLabel="Looking up…">
            Find my reservation
          </Button>
        </form>
      </Card>
    );
  }

  const { reservation, canModify, modificationDeadline, modificationBlockedReason } = loaded;
  const guestIndexes = Array.from({ length: Math.max(reservation.guestCount, 1) }, (_, index) => index);
  const isCancelled = reservation.status === "cancelled";

  return (
    <Card className="p-5 sm:p-6">
      <CardHeader
        as="h1"
        eyebrow={`Reservation ${reservation.reservationNumber}`}
        title={formatLongDate(reservation.date)}
        description={
          <>
            Room {reservation.roomNumber} · {reservation.guestCount}{" "}
            {reservation.guestCount === 1 ? "guest" : "guests"}
            {reservation.time ? ` · arrival ${reservation.time}` : ""}
          </>
        }
        actions={<Badge tone={isCancelled ? "info" : "success"}>{reservation.status}</Badge>}
      />

      {notice ? (
        <Alert tone="success" className="mt-4">
          {notice}
        </Alert>
      ) : null}
      {actionError ? (
        <Alert tone="danger" className="mt-4">
          {actionError}
        </Alert>
      ) : null}

      {!canModify && !isCancelled ? (
        <Alert tone="warning" className="mt-4">
          {modificationBlockedReason}
        </Alert>
      ) : null}

      {canModify ? (
        <p className="mt-4 text-sm text-ink-muted">
          You can change or cancel this booking yourself until{" "}
          <strong className="text-ink">{formatDeadline(new Date(modificationDeadline))}</strong>.
        </p>
      ) : null}

      <div className="mt-6 space-y-4">
        {guestIndexes.map((guestIndex) => {
          const entries = (editing ? draft : reservation.selections).filter(
            (entry) => (entry.guestIndex ?? 0) === guestIndex,
          );

          return (
            <section key={guestIndex} className="rounded-control border border-line bg-surface-muted p-4">
              <h2 className="eyebrow">Guest {guestIndex + 1}</h2>
              <ul className="mt-2 space-y-1 text-sm">
                {entries.map((entry) => (
                  <li key={`${guestIndex}-${entry.courseId}`} className="flex justify-between gap-3">
                    <span className="text-ink-subtle">{entry.courseName}</span>
                    <span
                      className={cx(
                        "text-right font-medium",
                        entry.optionId === NONE_OPTION_ID ? "text-ink-subtle" : "text-ink",
                      )}
                    >
                      {entry.optionName}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>

      {editing ? (
        <div className="mt-6 space-y-5">
          <div>
            <p id="edit-guest-label" className="text-sm font-medium text-ink">
              Changing choices for
            </p>
            <div role="group" aria-labelledby="edit-guest-label" className="mt-2 flex flex-wrap gap-2">
              {guestIndexes.map((guestIndex) => (
                <button
                  key={guestIndex}
                  type="button"
                  aria-pressed={activeGuest === guestIndex}
                  onClick={() => setActiveGuest(guestIndex)}
                  className={cx(
                    "min-h-11 rounded-full border px-4 text-sm font-medium transition-colors",
                    activeGuest === guestIndex
                      ? "border-primary bg-primary text-primary-fg"
                      : "border-line-strong bg-surface text-ink hover:border-accent",
                  )}
                >
                  Guest {guestIndex + 1}
                </button>
              ))}
            </div>
          </div>

          {menu.map((course) => {
            const selected = draft.find(
              (entry) => (entry.guestIndex ?? 0) === activeGuest && entry.courseId === course.id,
            );

            return (
              <fieldset key={course.id} className="rounded-control border border-line p-4">
                <legend className="px-1 text-sm font-semibold text-ink">{course.name}</legend>
                <div role="radiogroup" aria-label={`${course.name} options`} className="mt-2 space-y-2">
                  {[...course.options, { id: NONE_OPTION_ID, name: NONE_OPTION_NAME, imageUrl: "" }].map((option) => {
                    const isSelected = selected?.optionId === option.id;

                    return (
                      <button
                        key={option.id}
                        type="button"
                        role="radio"
                        aria-checked={isSelected}
                        onClick={() => choose(activeGuest, course, option)}
                        className={cx(
                          "flex w-full items-center gap-3 rounded-control border p-3 text-left transition-colors",
                          option.id === NONE_OPTION_ID && "border-dashed",
                          isSelected
                            ? "border-primary bg-primary text-primary-fg"
                            : "border-line-strong bg-surface text-ink hover:border-accent",
                        )}
                      >
                        <DishImage src={option.imageUrl} alt="" width={48} height={48} className="size-12 shrink-0" />
                        <span className="flex-1 text-sm font-medium">
                          {option.id === NONE_OPTION_ID ? "No thank you" : option.name}
                        </span>
                        <span aria-hidden="true">{isSelected ? "✓" : ""}</span>
                      </button>
                    );
                  })}
                </div>
              </fieldset>
            );
          })}

          <div className="flex flex-col gap-3 sm:flex-row">
            <Button
              variant="secondary"
              size="lg"
              className="flex-1"
              onClick={() => {
                setDraft(reservation.selections);
                setEditing(false);
                setActionError("");
              }}
            >
              Discard changes
            </Button>
            <Button size="lg" className="flex-1" onClick={saveChanges} loading={busy} loadingLabel="Saving…">
              Save choices
            </Button>
          </div>
        </div>
      ) : (
        <div className="mt-6 flex flex-col gap-3 sm:flex-row" data-print="hide">
          {canModify ? (
            <>
              <Button variant="secondary" size="lg" className="flex-1" onClick={() => setEditing(true)}>
                Change menu choices
              </Button>
              <Button variant="danger" size="lg" className="flex-1" onClick={cancelReservation} loading={busy}>
                Cancel reservation
              </Button>
            </>
          ) : (
            <ButtonLink href="/booking" size="lg" className="flex-1">
              Back to the restaurant
            </ButtonLink>
          )}
        </div>
      )}
    </Card>
  );
}
