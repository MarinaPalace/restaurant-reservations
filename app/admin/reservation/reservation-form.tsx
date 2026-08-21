"use client";

import { Fragment, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { DishImage } from "@/components/dish-image";
import { Card, CardHeader } from "@/components/ui/card";
import { Button, ButtonLink } from "@/components/ui/button";
import { Alert, Badge } from "@/components/ui/feedback";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { ContactFields } from "@/components/contact-fields";
import { RESERVATION_PREFIX } from "@/lib/brand";
import { formatLongDate } from "@/lib/date";
import { NONE_OPTION_ID, NONE_OPTION_NAME } from "@/lib/menu-selection";
import { MAX_ADDITIONAL_ROOMS, MAX_GUESTS_PER_RESERVATION } from "@/lib/validation/booking";
import { pruneSelectionsToGuestCount } from "@/lib/booking-session";
import {
  adjustCourseQuantity,
  clearCourse,
  fillCourseWithOption,
  findMissingCourses,
  summarizeSelections,
  tallyCourses,
} from "@/lib/reservation-ticket";
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
 *
 * It has two ways in:
 *
 * - **From a ticket** — the default for a new booking, and how reception
 *   actually works. Guests who cannot use the app fill in a card: the rooms,
 *   how many are coming, and how many of each dish, on one line. So the form
 *   asks for exactly that: a count per dish, not a dish per guest. Six guests
 *   times four courses used to be twenty-four separate choices to click
 *   through, one guest at a time.
 * - **Per guest** — the original, and the default when editing, because a
 *   booking a guest made themselves records who is having what and retyping it
 *   as counts would throw that away. It is also the way to record an allergy
 *   against a particular seat.
 *
 * Both write the same per-guest selections; see `lib/reservation-ticket.ts`.
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
  /** The other rooms on this table, when the ticket named more than one. */
  const [additionalRooms, setAdditionalRooms] = useState<string[]>(reservation?.additionalRooms ?? []);
  const [guestCount, setGuestCount] = useState(reservation?.guestCount ?? 1);
  const [date, setDate] = useState(reservation?.date ?? dates.find((entry) => entry.isOpen)?.date ?? "");
  const [selections, setSelections] = useState<ReservationSelection[]>(reservation?.selections ?? []);
  const [notes, setNotes] = useState(reservation?.notes ?? "");
  const [tableNumber, setTableNumber] = useState(reservation?.tableNumber ?? "");
  /**
   * Another booking to sit with, by reservation number.
   *
   * Seeded from the table this one is already on, so the field shows the
   * current arrangement rather than looking unset — and clearing it is how you
   * take a booking off a shared table.
   */
  const [joinReservationNumber, setJoinReservationNumber] = useState(reservation?.tableGroupId ?? "");
  const [contact, setContact] = useState<ReservationContact>(
    reservation?.contact ?? { method: "email", email: "", messagingApp: "phone" },
  );
  const [withContact, setWithContact] = useState(Boolean(reservation?.contact));

  /**
   * A booking already carrying choices opens per guest: it may be a guest's own
   * order, where which seat has what is real information rather than a total.
   */
  const [mode, setMode] = useState<"ticket" | "guest">(
    reservation?.selections?.length ? "guest" : "ticket",
  );
  const [activeGuest, setActiveGuest] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const guestIndexes = useMemo(
    () => Array.from({ length: guestCount }, (_, index) => index),
    [guestCount],
  );
  const selectedDate = dates.find((entry) => entry.date === date);

  const tallies = useMemo(() => tallyCourses(selections, menu), [selections, menu]);
  /** What the ticket says, added up — the number staff check against the card. */
  const summary = useMemo(() => summarizeSelections(selections, menu), [selections, menu]);
  const missingCourses = useMemo(
    () => findMissingCourses(selections, menu, guestCount),
    [selections, menu, guestCount],
  );
  const isComplete = missingCourses.length === 0;

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

  /* ---------------------------------------------------------------- *
   * Ticket entry
   * ---------------------------------------------------------------- */

  const adjust = (course: MenuCourse, optionId: string, delta: number) => {
    setSelections((current) => adjustCourseQuantity(current, course, optionId, delta, guestCount));
    setError("");
  };

  const fillRest = (course: MenuCourse, optionId: string) => {
    setSelections((current) => fillCourseWithOption(current, course, optionId, guestCount));
    setError("");
  };

  const resetCourse = (courseId: string) => {
    setSelections((current) => clearCourse(current, courseId));
    setError("");
  };

  /* ---------------------------------------------------------------- *
   * Rooms
   * ---------------------------------------------------------------- */

  const cleanRoom = (value: string) => value.replace(/[^A-Za-z0-9-]/g, "").toUpperCase();

  const changeAdditionalRoom = (index: number, value: string) => {
    setAdditionalRooms((current) => current.map((room, position) => (position === index ? cleanRoom(value) : room)));
    setError("");
  };

  const filledAdditionalRooms = additionalRooms.map((room) => room.trim()).filter(Boolean);

  /**
   * Only sent when it actually changes.
   *
   * The anchor of a table carries its *own* reservation number as the group,
   * so a booking that started the table seeds this field with itself. Sending
   * that unchanged would read as "seat this booking with itself", which the
   * service refuses — correctly, since typing your own number is otherwise a
   * mistake. Saying nothing when nothing changed avoids the question, and
   * avoids rewriting a table arrangement that nobody touched.
   */
  const joinChanged =
    joinReservationNumber.trim().toUpperCase() !== (reservation?.tableGroupId ?? "").toUpperCase();

  const save = async () => {
    if (saving) {
      return;
    }

    /**
     * Checked here as well as in the route, because the point is to catch it
     * *before* the booking is sent: a reservation with a room, a date and no
     * dinner was being created and only noticed when the kitchen sheet came out
     * short. The route still enforces the same rule — this only says which
     * course is missing and for how many guests, which the route cannot.
     */
    if (!roomNumber.trim()) {
      setError("Please enter the room number from the ticket.");
      return;
    }

    if (!date) {
      setError("Please choose the evening this booking is for.");
      return;
    }

    if (!isComplete) {
      setError(
        `This booking is not finished: ${missingCourses
          .map((entry) => `${entry.courseName} (${entry.missing} of ${guestCount} guests)`)
          .join(", ")}. Use “No thank you” for a guest who is skipping a course.`,
      );
      document
        .getElementById(`course-${missingCourses[0].courseId}`)
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }

    setSaving(true);
    setError("");

    const body = {
      roomNumber,
      additionalRooms: filledAdditionalRooms,
      guestCount,
      date,
      selections,
      notes: notes.trim() || undefined,
      tableNumber: tableNumber.trim() || undefined,
      contact: withContact ? contact : undefined,
      joinReservationNumber: joinChanged ? joinReservationNumber.trim() : undefined,
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
              : "For a ticket handed in at the desk, or a booking taken over the phone."
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
          <div className="sm:col-span-2">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Room number" hint="The first room on the ticket.">
                {(fieldProps) => (
                  <Input
                    {...fieldProps}
                    maxLength={10}
                    placeholder="402 or L10"
                    value={roomNumber}
                    onChange={(event) => setRoomNumber(cleanRoom(event.target.value))}
                  />
                )}
              </Field>

              {/* Rooms dining together on one ticket: one table, one line of
                  dish counts, and no way to tell which room ordered what — so
                  they are listed on the booking rather than split across
                  several. */}
              {additionalRooms.map((room, index) => (
                <Field key={index} label={`Room sharing the table ${index + 2}`}>
                  {(fieldProps) => (
                    <div className="flex gap-2">
                      <Input
                        {...fieldProps}
                        maxLength={10}
                        placeholder="405"
                        value={room}
                        onChange={(event) => changeAdditionalRoom(index, event.target.value)}
                      />
                      <Button
                        variant="secondary"
                        onClick={() =>
                          setAdditionalRooms((current) => current.filter((_, position) => position !== index))
                        }
                        aria-label={`Remove room ${room || index + 2}`}
                      >
                        Remove
                      </Button>
                    </div>
                  )}
                </Field>
              ))}
            </div>

            {additionalRooms.length < MAX_ADDITIONAL_ROOMS ? (
              <Button
                variant="secondary"
                className="mt-3"
                onClick={() => setAdditionalRooms((current) => [...current, ""])}
              >
                Add a room sharing this table
              </Button>
            ) : null}
          </div>

          {/* Sitting two *bookings* together, as against listing more rooms on
              this one. Each keeps its own dishes, which is the difference that
              matters to the kitchen: the rooms above share one ticket and one
              line of dish counts, whereas these two ordered separately and both
              orders have to reach the sheet. Guests routinely miss the pairing
              when booking, so reception has to be able to do it afterwards. */}
          <Field
            label="Seated with reservation"
            hint={
              reservation?.tableGroupId
                ? "Clear this to take the booking off that table. Both parties keep their own dishes."
                : "Optional. The other party's reservation number — they must be booked for the same evening."
            }
          >
            {(fieldProps) => (
              <Input
                {...fieldProps}
                maxLength={40}
                placeholder={`${RESERVATION_PREFIX}-A1B2C3`}
                value={joinReservationNumber}
                onChange={(event) => {
                  setJoinReservationNumber(event.target.value.trim().toUpperCase());
                  setError("");
                }}
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

          <Field label="Guests" hint="Everyone at the table, across all the rooms listed.">
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
        <CardHeader
          eyebrow="Menu"
          title="Courses"
          description={
            mode === "ticket"
              ? "Enter how many of each dish the table wants, exactly as written on the ticket."
              : "One choice per guest, per course."
          }
          actions={
            <div role="group" aria-label="How to enter the choices" className="flex gap-2">
              {(
                [
                  { value: "ticket", label: "From a ticket" },
                  { value: "guest", label: "Per guest" },
                ] as const
              ).map((option) => (
                <button
                  key={option.value}
                  type="button"
                  aria-pressed={mode === option.value}
                  onClick={() => setMode(option.value)}
                  className={cx(
                    "min-h-11 rounded-control border px-4 text-sm font-semibold transition-colors",
                    mode === option.value
                      ? "border-primary bg-primary text-primary-fg"
                      : "border-line-strong bg-surface text-ink hover:border-accent",
                  )}
                >
                  {option.label}
                </button>
              ))}
            </div>
          }
        />

        {mode === "ticket" ? (
          <div className="mt-5 space-y-4">
            {menu.map((course) => {
              const tally = tallies.find((entry) => entry.courseId === course.id);
              const chosen = tally?.chosen ?? 0;
              const headroom = Math.max(guestCount - chosen, 0);
              const rows = [
                ...course.options,
                { id: NONE_OPTION_ID, name: NONE_OPTION_NAME, imageUrl: "" },
              ];

              return (
                <fieldset
                  key={course.id}
                  id={`course-${course.id}`}
                  className={cx(
                    "scroll-mt-4 rounded-control border p-4",
                    chosen === guestCount
                      ? "border-success/40 bg-success-soft/30"
                      : chosen > 0
                        ? "border-warning/40"
                        : "border-line",
                  )}
                >
                  <legend className="px-1 text-sm font-semibold text-ink">
                    {course.name}
                    {course.required ? "" : " (optional)"}
                  </legend>

                  <div className="flex flex-wrap items-center justify-between gap-2">
                    {/* The running count against the ticket. This is the number
                        staff were adding up in their heads. */}
                    <p
                      aria-live="polite"
                      className={cx(
                        "text-sm font-semibold tabular-nums",
                        chosen === guestCount ? "text-success" : "text-warning",
                      )}
                    >
                      {chosen} of {guestCount} chosen
                      {headroom > 0 ? ` · ${headroom} still to enter` : ""}
                    </p>
                    {chosen > 0 ? (
                      <Button variant="ghost" onClick={() => resetCourse(course.id)}>
                        Clear course
                      </Button>
                    ) : null}
                  </div>

                  <div className="mt-3 space-y-2">
                    {rows.map((option) => {
                      const quantity = tally?.quantities[option.id] ?? 0;
                      const isNone = option.id === NONE_OPTION_ID;
                      const label = isNone ? "No thank you" : option.name;

                      return (
                        <div key={option.id} className="flex items-stretch gap-2">
                          {/*
                            The whole row adds one. A ticket is read left to
                            right and tapped off as you go, so the fast target
                            has to be the dish itself rather than a small plus.
                          */}
                          <button
                            type="button"
                            onClick={() => adjust(course, option.id, 1)}
                            disabled={headroom === 0}
                            // The count is in the label rather than only in the
                            // badge, which is decorative: a screen reader user
                            // has to hear what the row is already at.
                            aria-label={`${label}: ${quantity} of ${guestCount}. Add one.`}
                            className={cx(
                              "flex min-h-14 flex-1 items-center gap-3 rounded-control border p-2 text-left transition-colors",
                              "disabled:cursor-not-allowed disabled:opacity-60",
                              isNone && "border-dashed",
                              quantity > 0
                                ? "border-primary bg-primary text-primary-fg"
                                : "border-line-strong bg-surface text-ink hover:border-accent",
                            )}
                          >
                            <DishImage
                              src={isNone ? "" : option.imageUrl}
                              alt=""
                              width={40}
                              height={40}
                              className="size-10 shrink-0"
                            />
                            <span className="min-w-0 flex-1 text-sm font-medium">{label}</span>
                            <span
                              aria-hidden="true"
                              className={cx(
                                "flex size-9 shrink-0 items-center justify-center rounded-full text-base font-semibold tabular-nums",
                                quantity > 0
                                  ? "bg-primary-fg/15 text-primary-fg"
                                  : "border border-line text-ink-subtle",
                              )}
                            >
                              {quantity}
                            </span>
                          </button>

                          <button
                            type="button"
                            onClick={() => adjust(course, option.id, -1)}
                            disabled={quantity === 0}
                            aria-label={`Remove one ${label}`}
                            className="min-h-14 w-12 shrink-0 rounded-control border border-line-strong bg-surface text-xl font-semibold text-ink transition-colors hover:border-accent disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            −
                          </button>

                          {/* The commonest ticket by far: the whole table has
                              the same thing. One tap rather than six. */}
                          <button
                            type="button"
                            onClick={() => fillRest(course, option.id)}
                            disabled={headroom === 0}
                            aria-label={`Give the remaining ${headroom} guests ${label}`}
                            className="min-h-14 shrink-0 rounded-control border border-line-strong bg-surface px-3 text-xs font-semibold text-ink transition-colors hover:border-accent disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            +{headroom || ""} all
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </fieldset>
              );
            })}
          </div>
        ) : (
          <>
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
                  <fieldset
                    key={course.id}
                    id={`course-${course.id}`}
                    className="scroll-mt-4 rounded-control border border-line p-4"
                  >
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
          </>
        )}
      </Card>

      {/*
        The check against the ticket, before anything is saved.
        Reception used to have to read every guest's list and add the dishes up
        by hand to see whether the numbers matched the card in front of them.
      */}
      <Card className="p-5 sm:p-6">
        <CardHeader
          eyebrow="Check against the ticket"
          title="Summary"
          description={
            <>
              {[roomNumber.trim() || "—", ...filledAdditionalRooms].join(" + ")} · {guestCount}{" "}
              {guestCount === 1 ? "guest" : "guests"}
              {date ? ` · ${formatLongDate(date)}` : ""}
            </>
          }
          actions={
            isComplete ? (
              <Badge tone="success">Complete</Badge>
            ) : (
              <Badge tone="warning">Not finished</Badge>
            )
          }
        />

        {summary.courses.length === 0 ? (
          <Alert tone="warning" className="mt-4">
            Nothing has been chosen yet, so there is no dinner on this booking.
          </Alert>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full border-collapse text-left text-sm">
              <caption className="sr-only">How many of each dish this booking needs</caption>
              <thead>
                <tr className="border-b border-line-strong text-ink-muted">
                  <th scope="col" className="py-1 pr-6 font-semibold">Course</th>
                  <th scope="col" className="py-1 pr-6 font-semibold">Dish</th>
                  <th scope="col" className="py-1 text-right font-semibold">Qty</th>
                </tr>
              </thead>
              <tbody>
                {summary.courses.map((course) => (
                  <Fragment key={course.courseId}>
                    {course.dishes.map((dish, index) => (
                      <tr key={`${course.courseId}-${dish.optionId}`} className="border-b border-line">
                        <td className="py-1 pr-6 text-ink-muted">{index === 0 ? course.courseName : ""}</td>
                        <td className="py-1 pr-6 font-medium text-ink">{dish.optionName}</td>
                        <td className="py-1 text-right text-base font-semibold tabular-nums text-ink">
                          {dish.quantity}
                        </td>
                      </tr>
                    ))}
                    {course.declined > 0 ? (
                      <tr key={`${course.courseId}-declined`} className="border-b border-line">
                        <td className="py-1 pr-6 text-ink-muted">
                          {course.dishes.length === 0 ? course.courseName : ""}
                        </td>
                        <td className="py-1 pr-6 text-ink-subtle">No thank you</td>
                        <td className="py-1 text-right text-base font-semibold tabular-nums text-ink-subtle">
                          {course.declined}
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-line-strong">
                  <th scope="row" colSpan={2} className="py-1 pr-6 text-left font-semibold">
                    Total plates
                  </th>
                  <td className="py-1 text-right text-base font-semibold tabular-nums">{summary.plates}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}

        {!isComplete ? (
          <Alert tone="warning" className="mt-4">
            Still to enter:{" "}
            {missingCourses
              .map((entry) => `${entry.courseName} — ${entry.missing} of ${guestCount}`)
              .join(" · ")}
            . A guest skipping a course counts as “No thank you”.
          </Alert>
        ) : null}
      </Card>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-end">
        {!isComplete ? (
          <p className="text-sm text-ink-muted sm:mr-auto">
            {missingCourses.length} course{missingCourses.length === 1 ? "" : "s"} still to enter.
          </p>
        ) : null}
        <ButtonLink
          href={isEdit ? `/admin/reservation/${reservation!.reservationNumber}` : "/admin"}
          size="lg"
        >
          Discard
        </ButtonLink>
        {/*
          Deliberately not disabled while the booking is unfinished. A disabled
          button gives no reason; pressing this one names the courses that are
          short and scrolls to the first of them, and sends nothing.
        */}
        <Button size="lg" onClick={save} loading={saving} loadingLabel="Saving…">
          {isEdit ? "Save changes" : "Create reservation"}
        </Button>
      </div>
    </div>
  );
}
