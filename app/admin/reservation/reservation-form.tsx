"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { DishImage } from "@/components/dish-image";
import { Card, CardHeader } from "@/components/ui/card";
import { Button, ButtonLink } from "@/components/ui/button";
import { Alert } from "@/components/ui/feedback";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { ContactFields } from "@/components/contact-fields";
import { formatLongDate } from "@/lib/date";
import { NONE_OPTION_ID, NONE_OPTION_NAME } from "@/lib/menu-selection";
import { MAX_GUESTS_PER_RESERVATION } from "@/lib/validation/booking";
import { pruneSelectionsToGuestCount } from "@/lib/booking-session";
import { cx } from "@/components/ui/utils";
import type {
  MenuCourse,
  ReservationContact,
  ReservationRecord,
  ReservationSelection,
  RestaurantDateAvailability,
} from "@/types/booking";

/**
 * One form for both taking a booking at the desk and editing an existing one.
 * Staff are not bound by the guest cutoff, and contact details are optional
 * because a phone booking may not have them.
 */
export function ReservationForm({
  menu,
  dates,
  reservation,
}: {
  menu: MenuCourse[];
  dates: RestaurantDateAvailability[];
  reservation?: ReservationRecord;
}) {
  const router = useRouter();
  const isEdit = Boolean(reservation);

  const [roomNumber, setRoomNumber] = useState(reservation?.roomNumber ?? "");
  const [guestCount, setGuestCount] = useState(reservation?.guestCount ?? 1);
  const [date, setDate] = useState(reservation?.date ?? dates.find((entry) => entry.isOpen)?.date ?? "");
  const [selections, setSelections] = useState<ReservationSelection[]>(reservation?.selections ?? []);
  const [notes, setNotes] = useState(reservation?.notes ?? "");
  const [tableNumber, setTableNumber] = useState(reservation?.tableNumber ?? "");
  const [contact, setContact] = useState<ReservationContact>(
    reservation?.contact ?? { method: "email", email: "", messagingApp: "phone" },
  );
  const [withContact, setWithContact] = useState(Boolean(reservation?.contact));

  const [activeGuest, setActiveGuest] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const guestIndexes = useMemo(
    () => Array.from({ length: guestCount }, (_, index) => index),
    [guestCount],
  );
  const selectedDate = dates.find((entry) => entry.date === date);

  const changeGuestCount = (next: number) => {
    setGuestCount(next);
    // Choices belonging to guests who are no longer coming must not linger.
    setSelections((current) => pruneSelectionsToGuestCount(current, next));
    setActiveGuest((current) => Math.min(current, next - 1));
    setError("");
  };

  const choose = (guestIndex: number, course: MenuCourse, option: { id: string; name: string }) => {
    setSelections((current) => [
      ...current.filter((entry) => !((entry.guestIndex ?? 0) === guestIndex && entry.courseId === course.id)),
      {
        guestIndex,
        courseId: course.id,
        courseName: course.name,
        optionId: option.id,
        optionName: option.name,
      },
    ]);
    setError("");
  };

  const isGuestComplete = (guestIndex: number) =>
    menu
      .filter((course) => course.required)
      .every((course) =>
        selections.some((entry) => (entry.guestIndex ?? 0) === guestIndex && entry.courseId === course.id),
      );

  const save = async () => {
    if (saving) {
      return;
    }

    setSaving(true);
    setError("");

    const body = {
      roomNumber,
      guestCount,
      date,
      selections,
      notes: notes.trim() || undefined,
      tableNumber: tableNumber.trim() || undefined,
      contact: withContact ? contact : undefined,
    };

    try {
      const response = await fetch(
        isEdit ? `/api/admin/reservations/${encodeURIComponent(reservation!.reservationNumber)}` : "/api/admin/reservations",
        {
          method: isEdit ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      );

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        setError(data.error || "Unable to save this reservation.");
        setSaving(false);
        return;
      }

      router.push(`/admin/reservation/${data.reservation.reservationNumber}`);
      router.refresh();
    } catch {
      setError("Could not reach the server. Please try again.");
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <Card className="p-5 sm:p-6">
        <CardHeader
          as="h1"
          eyebrow={isEdit ? `Reservation ${reservation!.reservationNumber}` : "New reservation"}
          title={isEdit ? "Edit reservation" : "Take a reservation"}
          description={
            isEdit
              ? "Staff edits are not subject to the guest cutoff."
              : "For bookings taken at the desk or over the phone."
          }
          actions={
            <ButtonLink href={isEdit ? `/admin/reservation/${reservation!.reservationNumber}` : "/admin"}>
              Cancel
            </ButtonLink>
          }
        />

        {error ? (
          <Alert tone="danger" className="mt-4">
            {error}
          </Alert>
        ) : null}

        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          <Field label="Room number">
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

          <Field label="Table" hint="Optional. Applies to everyone sharing the table.">
            {(fieldProps) => (
              <Input {...fieldProps} value={tableNumber} onChange={(event) => setTableNumber(event.target.value)} />
            )}
          </Field>

          <Field
            label="Date"
            hint={
              selectedDate
                ? `${selectedDate.remainingSeats} seats free${selectedDate.serviceTime ? ` · arrival ${selectedDate.serviceTime}` : ""}`
                : "This date is not configured."
            }
          >
            {(fieldProps) => (
              <Select {...fieldProps} value={date} onChange={(event) => setDate(event.target.value)}>
                {dates.map((entry) => (
                  <option key={entry.date} value={entry.date} disabled={!entry.isOpen}>
                    {formatLongDate(entry.date)}
                    {entry.isOpen ? ` — ${entry.remainingSeats} free` : " — closed"}
                  </option>
                ))}
                {/* A booking may sit on a date that has since been removed. */}
                {date && !dates.some((entry) => entry.date === date) ? (
                  <option value={date}>{formatLongDate(date)} — not configured</option>
                ) : null}
              </Select>
            )}
          </Field>

          <Field label="Guests">
            {(fieldProps) => (
              <Select
                {...fieldProps}
                value={String(guestCount)}
                onChange={(event) => changeGuestCount(Number(event.target.value))}
              >
                {Array.from({ length: MAX_GUESTS_PER_RESERVATION }, (_, index) => index + 1).map((count) => (
                  <option key={count} value={count}>
                    {count} {count === 1 ? "guest" : "guests"}
                  </option>
                ))}
              </Select>
            )}
          </Field>

          <div className="sm:col-span-2">
            <Field label="Comment" hint="Allergies or anything the kitchen should know.">
              {(fieldProps) => (
                <Textarea
                  {...fieldProps}
                  maxLength={500}
                  value={notes}
                  onChange={(event) => setNotes(event.target.value)}
                />
              )}
            </Field>
          </div>
        </div>

        <div className="mt-4 rounded-control border border-line bg-surface-muted p-4">
          <label className="flex min-h-11 items-center gap-3 text-sm font-medium text-ink">
            <input
              type="checkbox"
              className="size-4 accent-[var(--primary)]"
              checked={withContact}
              onChange={(event) => setWithContact(event.target.checked)}
            />
            Record contact details
          </label>

          {withContact ? (
            <div className="mt-3">
              <ContactFields contact={contact} onChange={setContact} />
            </div>
          ) : null}
        </div>
      </Card>

      <Card className="p-5 sm:p-6">
        <CardHeader eyebrow="Menu" title="Courses" description="One choice per guest, per course." />

        <div className="mt-4 flex flex-wrap gap-2" role="group" aria-label="Guest">
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
                  : isGuestComplete(guestIndex)
                    ? "border-success/40 bg-success-soft text-success"
                    : "border-line-strong bg-surface text-ink hover:border-accent",
              )}
            >
              Guest {guestIndex + 1}
              {isGuestComplete(guestIndex) ? <span aria-hidden="true"> ✓</span> : null}
            </button>
          ))}
        </div>

        <div className="mt-5 space-y-4">
          {menu.map((course) => {
            const selected = selections.find(
              (entry) => (entry.guestIndex ?? 0) === activeGuest && entry.courseId === course.id,
            );

            return (
              <fieldset key={course.id} className="rounded-control border border-line p-4">
                <legend className="px-1 text-sm font-semibold text-ink">
                  {course.name}
                  {course.required ? "" : " (optional)"}
                </legend>

                <div role="radiogroup" aria-label={`${course.name} options`} className="mt-2 grid gap-2 sm:grid-cols-2">
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
                          "flex items-center gap-3 rounded-control border p-3 text-left transition-colors",
                          option.id === NONE_OPTION_ID && "border-dashed",
                          isSelected
                            ? "border-primary bg-primary text-primary-fg"
                            : "border-line-strong bg-surface text-ink hover:border-accent",
                        )}
                      >
                        <DishImage src={option.imageUrl} alt="" width={40} height={40} className="size-10 shrink-0" />
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
        </div>
      </Card>

      <div className="flex flex-col gap-3 sm:flex-row sm:justify-end">
        <ButtonLink
          href={isEdit ? `/admin/reservation/${reservation!.reservationNumber}` : "/admin"}
          size="lg"
        >
          Discard
        </ButtonLink>
        <Button size="lg" onClick={save} loading={saving} loadingLabel="Saving…" disabled={!roomNumber || !date}>
          {isEdit ? "Save changes" : "Create reservation"}
        </Button>
      </div>
    </div>
  );
}
