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
import { useSearchParams } from "next/navigation";
import { useBookingSession } from "@/hooks/use-booking-session";
import { PASS_KEY_PREFIX, formatPassKey, isValidPassKeyFormat, normalizePassKey } from "@/lib/pass-key";
import { cx } from "@/components/ui/utils";
import type { MenuCourse, ReservationRecord, ReservationSelection } from "@/types/booking";

/** One booking, with whether the guest may still change it. */
type Entry = {
  reservation: ReservationRecord;
  canModify: boolean;
  modificationDeadline: string;
  modificationBlockedReason: string | null;
};

type Loaded = {
  usesRemaining: number;
  reservations: Entry[];
};


/**
 * Swaps one booking inside the loaded list, leaving the others alone. The key
 * may hold several dinners, so changing one must not discard the rest.
 */
function replaceEntry(loaded: Loaded, reservation: ReservationRecord, patch: Partial<Entry> = {}): Loaded {
  return {
    ...loaded,
    reservations: loaded.reservations.map((entry) =>
      entry.reservation.reservationNumber === reservation.reservationNumber
        ? { ...entry, ...patch, reservation }
        : entry,
    ),
  };
}

/**
 * Self-service, opened with the pass-key from check-in: look the booking up,
 * change the menu choices, or cancel — all subject to the same cutoff the
 * server enforces.
 *
 * The reservation number deliberately does not work here. Guests read it out
 * to other rooms so they can share a table, and any of those rooms could
 * otherwise change or cancel the booking.
 */
export function ManageReservation({ menu }: { menu: MenuCourse[] }) {
  const searchParams = useSearchParams();
  const session = useBookingSession();

  /**
   * The key arrives in the link when the guest came from a screen that already
   * had it — after scanning a card, or from the confirmation — and otherwise
   * from the session. Either way it is not typed again: a guest who has just
   * scanned their card should never be asked to copy the code by hand.
   */
  const suppliedKey = searchParams.get("k") ?? session.passKey;

  const [typedKey, setTypedKey] = useState<string | null>(null);
  const passKey =
    typedKey ?? (suppliedKey && isValidPassKeyFormat(suppliedKey) ? formatPassKey(suppliedKey) : "");
  const setPassKey = setTypedKey;
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  /**
   * Which booking is open. A long stay earns more than one dinner, so a key
   * can hold several; with only one there is nothing to choose and it opens
   * straight away.
   */
  const [selectedNumber, setSelectedNumber] = useState<string | null>(null);
  const [lookupError, setLookupError] = useState("");
  const [busy, setBusy] = useState(false);

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<ReservationSelection[]>([]);
  const [activeGuest, setActiveGuest] = useState(0);
  const [actionError, setActionError] = useState("");
  const [notice, setNotice] = useState("");

  // The booking currently open, if any. Declared here so the handlers below
  // and the markup further down both read the same value.
  const activeEntry =
    loaded?.reservations.find((entry) => entry.reservation.reservationNumber === selectedNumber) ?? null;

  const lookup = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) {
      return;
    }

    if (!isValidPassKeyFormat(passKey)) {
      setLookupError("Please enter the pass-key exactly as it appears on your slip.");
      return;
    }

    setBusy(true);
    setLookupError("");
    setNotice("");

    try {
      // POSTed rather than put in the URL: the key is a credential and has no
      // business in browser history or a proxy log.
      const response = await fetch("/api/booking/manage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ passKey: normalizePassKey(passKey) }),
      });

      if (!response.ok) {
        setLookupError("We could not find a reservation for that pass-key. Please check it and try again.");
        setLoaded(null);
        return;
      }

      const data: Loaded = await response.json();
      setLoaded(data);

      const only = data.reservations.length === 1 ? data.reservations[0] : null;
      setSelectedNumber(only?.reservation.reservationNumber ?? null);
      setDraft(only?.reservation.selections ?? []);
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
    if (!loaded || !activeEntry || busy) {
      return;
    }

    const { reservation } = activeEntry;

    setBusy(true);
    setActionError("");

    try {
      const response = await fetch("/api/booking/manage", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          passKey: normalizePassKey(passKey),
          reservationNumber: reservation.reservationNumber,
          selections: draft,
        }),
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        setActionError(data.error || "We could not save your changes.");
        return;
      }

      setLoaded(replaceEntry(loaded, data.reservation));
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
    if (!loaded || !activeEntry || busy) {
      return;
    }

    const { reservation } = activeEntry;

    const confirmed = window.confirm(
      `Cancel reservation ${reservation.reservationNumber}? ` +
        "Your pass-key will work again afterwards, so you can book another evening. " +
        "If you cancel by mistake, reception can put it back.",
    );
    if (!confirmed) {
      return;
    }

    setBusy(true);
    setActionError("");

    try {
      const response = await fetch("/api/booking/manage/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          passKey: normalizePassKey(passKey),
          reservationNumber: reservation.reservationNumber,
        }),
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        setActionError(data.error || "We could not cancel this reservation.");
        return;
      }

      setLoaded(
        replaceEntry(loaded, { ...reservation, status: "cancelled" }, { canModify: false }),
      );
      setNotice(
        "Your reservation has been cancelled. Your pass-key works again, so you can book another evening — " +
          "or call reception if this was a mistake.",
      );
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
          description="Enter the pass-key you booked with — the one from your check-in slip."
        />

        <form onSubmit={lookup} noValidate className="mt-6 space-y-4">
          <Field label="Pass-key" error={lookupError} hint="Capitals and dashes do not matter.">
            {(fieldProps) => (
              <Input
                {...fieldProps}
                autoFocus
                name="passKey"
                autoComplete="off"
                autoCapitalize="characters"
                autoCorrect="off"
                spellCheck={false}
                maxLength={24}
                placeholder={`${PASS_KEY_PREFIX}-XXXX-XXXX-XXXX`}
                value={passKey}
                onChange={(event) => {
                  setPassKey(event.target.value.toUpperCase());
                  setLookupError("");
                }}
                onBlur={(event) => {
                  const normalized = normalizePassKey(event.target.value);
                  if (isValidPassKeyFormat(normalized)) {
                    setPassKey(formatPassKey(normalized));
                  }
                }}
                className="text-xl tracking-wider"
              />
            )}
          </Field>

          <Button type="submit" size="lg" className="w-full" loading={busy} loadingLabel="Looking up…">
            Find my reservation
          </Button>
        </form>

        <p className="mt-6 rounded-control border border-line bg-surface-muted p-3 text-sm text-ink-muted">
          Booked at reception rather than online, or lost your slip? Dial{" "}
          <span className="font-semibold text-ink">9</span> from your room and they will change it for you.
        </p>
      </Card>
    );
  }

  if (!activeEntry) {
    return (
      <Card className="p-5 sm:p-6">
        <CardHeader
          as="h1"
          eyebrow="Your reservations"
          title="You have more than one dinner booked"
          description={
            loaded.usesRemaining > 0
              ? `Choose the one you want to change. Your pass-key can still book ${loaded.usesRemaining} more.`
              : "Choose the one you want to change."
          }
        />

        <ul className="mt-6 space-y-3">
          {loaded.reservations.map((entry) => (
            <li key={entry.reservation.reservationNumber}>
              <button
                type="button"
                onClick={() => {
                  setSelectedNumber(entry.reservation.reservationNumber);
                  setDraft(entry.reservation.selections);
                  setEditing(false);
                  setNotice("");
                  setActionError("");
                }}
                className="flex w-full items-center justify-between gap-4 rounded-control border border-line-strong bg-surface p-4 text-left transition-colors hover:border-accent"
              >
                <span>
                  <span className="block font-semibold text-ink">{formatLongDate(entry.reservation.date)}</span>
                  <span className="block text-sm text-ink-muted">
                    {entry.reservation.reservationNumber} · {entry.reservation.guestCount}{" "}
                    {entry.reservation.guestCount === 1 ? "guest" : "guests"}
                    {entry.reservation.time ? ` · arrival ${entry.reservation.time}` : ""}
                  </span>
                </span>
                <Badge tone={entry.reservation.status === "cancelled" ? "info" : "success"}>
                  {entry.reservation.status}
                </Badge>
              </button>
            </li>
          ))}
        </ul>

        <div className="mt-6">
          <ButtonLink href="/booking" size="lg">
            Book another evening
          </ButtonLink>
        </div>
      </Card>
    );
  }

  const { reservation, canModify, modificationDeadline, modificationBlockedReason } = activeEntry;
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
