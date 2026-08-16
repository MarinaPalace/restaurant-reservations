"use client";

import { useMemo, useState } from "react";
import { PASS_KEY_PREFIX, formatPassKey, isValidPassKeyFormat, normalizePassKey } from "@/lib/pass-key";
import { Brand } from "@/components/brand";
import { DishImage } from "@/components/dish-image";
import { ContactFields } from "@/components/contact-fields";
import { MonthCalendar, type DayState } from "@/components/month-calendar";
import { VeganBadge } from "@/components/vegan-badge";
import { Card, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert, EmptyState } from "@/components/ui/feedback";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { buildGoogleCalendarUrl, describeReservationTime } from "@/lib/calendar";
import { formatLongDate, startOfMonth } from "@/lib/date";
import { NONE_OPTION_ID, NONE_OPTION_NAME } from "@/lib/menu-selection";
import { describeContactProblem, normalizeContact } from "@/lib/contact";
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
 * The invitation flow.
 *
 * Unlike the hotel flow this is a single page rather than a wizard: the guest
 * arrives from a link sent weeks ahead, is not staying yet, and should be able
 * to see the whole ask at once. They give a name instead of a room, and only
 * the evenings the restaurant opened for them can be chosen.
 */
export function PremiumBooking({
  menu,
  dates,
  /**
   * The key from the invitation. Supplied by /premium/<pass-key> so the guest
   * follows a link from their email and never types it; blank on the bare
   * /premium address, where they are asked for it.
   */
  initialPassKey = "",
}: {
  menu: MenuCourse[];
  dates: RestaurantDateAvailability[];
  initialPassKey?: string;
}) {
  const [passKey, setPassKey] = useState(initialPassKey ? formatPassKey(initialPassKey) : "");
  const [guestName, setGuestName] = useState("");
  const [guestCount, setGuestCount] = useState(1);
  const [date, setDate] = useState(dates[0]?.date ?? "");
  const [selections, setSelections] = useState<ReservationSelection[]>([]);
  const [notes, setNotes] = useState("");
  const [contact, setContact] = useState<ReservationContact>({ method: "email", email: "", messagingApp: "phone" });

  const [activeGuest, setActiveGuest] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [confirmed, setConfirmed] = useState<ReservationRecord | null>(null);

  const [month, setMonth] = useState(() => startOfMonth(dates[0] ? new Date(`${dates[0].date}T12:00:00`) : new Date()));

  const guestIndexes = useMemo(() => Array.from({ length: guestCount }, (_, index) => index), [guestCount]);
  const requiredCourses = useMemo(() => menu.filter((course) => course.required), [menu]);
  const selectedDate = dates.find((entry) => entry.date === date) ?? null;

  const getDayState = (dateKey: string): DayState => {
    const entry = dates.find((item) => item.date === dateKey);

    if (!entry) {
      // Every other evening is locked: this invitation is for specific dates.
      return { disabled: true, status: "not part of this invitation" };
    }

    if (entry.remainingSeats < guestCount) {
      return {
        disabled: true,
        premium: true,
        hint: `${entry.remainingSeats} left`,
        status: `only ${entry.remainingSeats} places left`,
      };
    }

    return {
      premium: true,
      hint: `${entry.remainingSeats} left`,
      status: `${entry.remainingSeats} places available`,
    };
  };

  const changeGuestCount = (next: number) => {
    setGuestCount(next);
    setSelections((current) => pruneSelectionsToGuestCount(current, next));
    setActiveGuest((current) => Math.min(current, next - 1));
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
    requiredCourses.every((course) =>
      selections.some((entry) => (entry.guestIndex ?? 0) === guestIndex && entry.courseId === course.id),
    );

  const submit = async () => {
    if (submitting) {
      return;
    }

    if (guestName.trim().length < 2) {
      setError("Please tell us who the reservation is for.");
      return;
    }

    if (!date) {
      setError("Please choose one of the evenings offered.");
      return;
    }

    const incomplete = guestIndexes.find((guestIndex) => !isGuestComplete(guestIndex));
    if (incomplete !== undefined) {
      setActiveGuest(incomplete);
      setError(`Please complete the menu choices for guest ${incomplete + 1}.`);
      return;
    }

    if (!isValidPassKeyFormat(passKey)) {
      setError("Please enter the pass-key from your invitation.");
      return;
    }

    const contactProblem = describeContactProblem(contact);
    if (contactProblem) {
      setError(contactProblem);
      return;
    }

    setSubmitting(true);
    setError("");

    try {
      const response = await fetch("/api/premium/reservations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          passKey: normalizePassKey(passKey),
          guestName: guestName.trim(),
          guestCount,
          date,
          selections,
          contact: normalizeContact(contact),
          notes: notes.trim() || undefined,
        }),
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        setError(data.error || "Something went wrong. Please try again.");
        setSubmitting(false);
        return;
      }

      setConfirmed(data.reservation);
    } catch {
      setError("We could not reach the restaurant. Please check your connection and try again.");
      setSubmitting(false);
    }
  };

  if (confirmed) {
    return (
      <Card className="p-6 sm:p-8">
        <Brand stacked className="mb-6" />
        <CardHeader
          as="h1"
          align="center"
          flourish
          eyebrow="You are expected"
          title="Reservation confirmed"
          description={`Thank you, ${confirmed.guestName}. We look forward to welcoming you.`}
        />

        <div className="mt-6 rounded-control border border-gold/50 bg-accent-soft p-4 text-center">
          <p className="eyebrow">Reservation number</p>
          <p className="mt-2 font-mono text-3xl font-semibold tracking-[0.2em] text-ink">
            {confirmed.reservationNumber}
          </p>
        </div>

        <dl className="mt-5 space-y-3 rounded-control bg-surface-muted p-4 text-sm">
          <div className="flex justify-between gap-3">
            <dt className="text-ink-subtle">Evening</dt>
            <dd className="text-right font-semibold text-ink">
              {describeReservationTime(confirmed.date, confirmed.time, confirmed.endTime)}
            </dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-ink-subtle">Guests</dt>
            <dd className="font-semibold text-ink">{confirmed.guestCount}</dd>
          </div>
        </dl>

        <a
          href={buildGoogleCalendarUrl(confirmed)}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-5 inline-flex min-h-11 w-full items-center justify-center rounded-control bg-primary px-4 text-sm font-semibold text-primary-fg transition-colors hover:bg-primary-hover"
        >
          Add to Google Calendar
        </a>
      </Card>
    );
  }

  if (dates.length === 0) {
    return (
      <Card className="p-6 sm:p-8">
        <Brand stacked className="mb-6" />
        <EmptyState
          title="No evenings are open just yet"
          description="This invitation has no dates available at the moment. Please try again shortly, or contact the hotel."
        />
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Card className="p-6 sm:p-8">
        <Brand stacked className="mb-6" />
        <CardHeader
          as="h1"
          align="center"
          flourish
          eyebrow="An invitation"
          title="Reserve your evening"
          description="Please choose your evening and your menu. We keep your choices for the kitchen, so everything is ready when you arrive."
        />
      </Card>

      <Card className="p-5 sm:p-6">
        <CardHeader eyebrow="Your party" title="Who is coming" />

        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          {/*
            Shown only when the guest arrived without a key in the link, so
            somebody following the invitation never has to type it.
          */}
          {!initialPassKey ? (
            <Field
              label="Pass-key from your invitation"
              hint="Capitals and dashes do not matter."
            >
              {(fieldProps) => (
                <Input
                  {...fieldProps}
                  name="passKey"
                  autoComplete="off"
                  autoCapitalize="characters"
                  autoCorrect="off"
                  spellCheck={false}
                  maxLength={24}
                  placeholder={`${PASS_KEY_PREFIX}-XXXXX-XXXXX`}
                  value={passKey}
                  onChange={(event) => setPassKey(event.target.value.toUpperCase())}
                  onBlur={(event) => {
                    const normalized = normalizePassKey(event.target.value);
                    if (isValidPassKeyFormat(normalized)) {
                      setPassKey(formatPassKey(normalized));
                    }
                  }}
                  className="tracking-wider"
                />
              )}
            </Field>
          ) : null}

          <Field label="Name the reservation is under">
            {(fieldProps) => (
              <Input
                {...fieldProps}
                autoComplete="name"
                maxLength={120}
                placeholder="e.g. Maria Petrova"
                value={guestName}
                onChange={(event) => setGuestName(event.target.value)}
              />
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
        </div>

        <div className="mt-5">
          <ContactFields contact={contact} onChange={setContact} />
        </div>
      </Card>

      <Card className="p-5 sm:p-6">
        <CardHeader
          eyebrow="Evening"
          title="Choose your date"
          description="Only the evenings held for this invitation can be selected."
        />

        <div className="mt-5">
          <MonthCalendar
            label="Evenings held for you"
            month={month}
            onMonthChange={setMonth}
            selectedDate={date || null}
            onSelect={(dateKey) => {
              setDate(dateKey);
              setError("");
            }}
            getDayState={getDayState}
          />
        </div>

        <div className="mt-4 rounded-control border border-line bg-surface-muted p-4 text-sm text-ink-muted">
          {selectedDate ? (
            <>
              <p className="font-semibold text-ink">
                <time dateTime={selectedDate.date}>{formatLongDate(selectedDate.date)}</time>
              </p>
              {selectedDate.serviceTime ? (
                <p className="mt-1 font-medium text-accent-ink">
                  Everyone is seated at {selectedDate.serviceTime}. Please arrive a few minutes early.
                </p>
              ) : null}
              <p className="mt-1">{selectedDate.remainingSeats} places remaining.</p>
            </>
          ) : (
            <p>Select one of the highlighted evenings.</p>
          )}
        </div>
      </Card>

      <Card className="p-5 sm:p-6">
        <CardHeader
          eyebrow="Menu"
          title="Choose your dishes"
          description="One choice per guest, per course."
        />

        {menu.length === 0 ? (
          <Alert tone="info" className="mt-5">
            The menu for this evening is not published yet. Please come back shortly.
          </Alert>
        ) : (
          <>
            {guestCount > 1 ? (
              <div className="mt-5 flex flex-wrap gap-2" role="group" aria-label="Guest">
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
            ) : null}

            <div className="mt-5 space-y-5">
              {menu.map((course) => {
                const selected = selections.find(
                  (entry) => (entry.guestIndex ?? 0) === activeGuest && entry.courseId === course.id,
                );

                return (
                  <fieldset key={course.id} className="rounded-control border border-line p-4">
                    <legend className="display px-1 text-xl text-ink">{course.name}</legend>
                    {course.description ? (
                      <p className="mt-1 text-sm text-pretty text-ink-muted">{course.description}</p>
                    ) : null}

                    <div role="radiogroup" aria-label={`${course.name} options`} className="mt-3 space-y-2">
                      {[...course.options, { id: NONE_OPTION_ID, name: NONE_OPTION_NAME, imageUrl: "" }].map(
                        (option) => {
                          const isSelected = selected?.optionId === option.id;
                          const full = course.options.find((entry) => entry.id === option.id);

                          return (
                            <button
                              key={option.id}
                              type="button"
                              role="radio"
                              aria-checked={isSelected}
                              onClick={() => choose(activeGuest, course, option)}
                              className={cx(
                                "relative flex w-full items-start gap-3 rounded-control border p-3 text-left transition-colors",
                                option.id === NONE_OPTION_ID && "border-dashed",
                                isSelected
                                  ? "border-primary bg-primary text-primary-fg"
                                  : "border-line-strong bg-surface text-ink hover:border-accent",
                              )}
                            >
                              <DishImage
                                src={full?.imageUrl}
                                alt=""
                                width={64}
                                height={64}
                                className="size-16 shrink-0"
                              />
                              <span className="min-w-0 flex-1">
                                <span className="block pr-16 text-base font-semibold">
                                  {option.id === NONE_OPTION_ID ? "No thank you" : option.name}
                                </span>
                                {full?.description ? (
                                  <span
                                    className={cx(
                                      "mt-1 block text-sm text-pretty",
                                      isSelected ? "text-primary-fg/80" : "text-ink-muted",
                                    )}
                                  >
                                    {full.description}
                                  </span>
                                ) : null}
                                {full?.ingredients ? (
                                  <span
                                    className={cx(
                                      "mt-1 block text-xs text-pretty",
                                      isSelected ? "text-primary-fg/80" : "text-ink-muted",
                                    )}
                                  >
                                    <span className="font-medium">Ingredients:</span> {full.ingredients}
                                  </span>
                                ) : null}
                                {full?.allergens.length ? (
                                  <span
                                    className={cx(
                                      "mt-1 block text-xs",
                                      isSelected ? "text-primary-fg/80" : "text-ink-subtle",
                                    )}
                                  >
                                    <span className="font-medium">Allergens:</span> {full.allergens.join(", ")}
                                  </span>
                                ) : null}
                              </span>

                              {full?.vegan ? (
                                <span className="absolute right-3 top-3">
                                  <VeganBadge />
                                </span>
                              ) : null}
                            </button>
                          );
                        },
                      )}
                    </div>
                  </fieldset>
                );
              })}
            </div>
          </>
        )}

        <div className="mt-5">
          <Field label="Allergies or requests" hint="Anything the kitchen should know. Optional.">
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
      </Card>

      {error ? <Alert tone="danger">{error}</Alert> : null}

      <Button size="lg" className="w-full" onClick={submit} loading={submitting} loadingLabel="Confirming…">
        Confirm my reservation
      </Button>
    </div>
  );
}
