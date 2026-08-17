"use client";

import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { DishImage } from "@/components/dish-image";
import { VeganBadge } from "@/components/vegan-badge";
import { Card, CardHeader } from "@/components/ui/card";
import { Button, ButtonLink } from "@/components/ui/button";
import { Alert } from "@/components/ui/feedback";
import { useBookingGuard, writeBookingSession } from "@/hooks/use-booking-session";
import { LANGUAGE_NAMES, listLanguages } from "@/lib/languages";
import { localizeMenuCatalog } from "@/lib/menu-localization";
import { NONE_OPTION_ID, NONE_OPTION_NAME } from "@/lib/menu-selection";
import { Tilt } from "@/components/motion/tilt";
import { cx } from "@/components/ui/utils";
import type { MenuCourse, MenuOption, ReservationSelection } from "@/types/booking";

export function MenuChooser({ courses }: { courses: MenuCourse[] }) {
  const router = useRouter();
  const { session, ready } = useBookingGuard(["room", "guests", "date"]);

  const [activeGuestIndex, setActiveGuestIndex] = useState(0);
  const [error, setError] = useState("");
  /**
   * The dish just chosen, and a counter that changes on every tap.
   *
   * Only the plate that was actually tapped flashes, and the counter is what
   * makes a second tap on the same plate flash again — a CSS animation on an
   * element that stays in the tree only ever runs once.
   */
  const [flash, setFlash] = useState<{ courseId: string; optionId: string; tick: number } | null>(null);

  const guestCount = Math.max(session.guestCount, 1);
  const selections = session.selections;

  const availableLanguages = useMemo(() => listLanguages(courses), [courses]);
  // Derived, not stored: no effect and no render cascade when it changes.
  const language = availableLanguages.includes(session.language) ? session.language : "en";
  const localizedCourses = useMemo(() => localizeMenuCatalog(courses, language), [courses, language]);

  const requiredCourses = useMemo(
    () => localizedCourses.filter((course) => course.required),
    [localizedCourses],
  );
  const guestIndexes = useMemo(() => Array.from({ length: guestCount }, (_, index) => index), [guestCount]);

  const isGuestComplete = useCallback(
    (guestIndex: number) =>
      requiredCourses.every((course) =>
        selections.some((entry) => entry.guestIndex === guestIndex && entry.courseId === course.id),
      ),
    [requiredCourses, selections],
  );

  const chooseOption = (guestIndex: number, course: MenuCourse, option: Pick<MenuOption, "id" | "name">) => {
    const nextSelection: ReservationSelection = {
      guestIndex,
      courseId: course.id,
      courseName: course.name,
      optionId: option.id,
      optionName: option.name,
    };

    writeBookingSession({
      selections: [
        ...selections.filter((entry) => !(entry.guestIndex === guestIndex && entry.courseId === course.id)),
        nextSelection,
      ],
    });
    setFlash((current) => ({
      courseId: course.id,
      optionId: option.id,
      tick: (current?.tick ?? 0) + 1,
    }));
    setError("");
  };

  const allComplete = localizedCourses.length > 0 && guestIndexes.every(isGuestComplete);
  const completedCount = guestIndexes.filter(isGuestComplete).length;

  /** The first course this guest still owes an answer for. */
  const firstUnansweredCourse = useCallback(
    (guestIndex: number) =>
      requiredCourses.find(
        (course) => !selections.some((entry) => entry.guestIndex === guestIndex && entry.courseId === course.id),
      ),
    [requiredCourses, selections],
  );

  const currentGuestComplete = isGuestComplete(activeGuestIndex);
  const chosenForActiveGuest = requiredCourses.filter((course) =>
    selections.some((entry) => entry.guestIndex === activeGuestIndex && entry.courseId === course.id),
  ).length;
  // Whoever still needs choosing for, starting after the guest on screen so the
  // party is worked through in order.
  const nextIncompleteGuest = useMemo(
    () =>
      guestIndexes.find((guestIndex) => guestIndex > activeGuestIndex && !isGuestComplete(guestIndex)) ??
      guestIndexes.find((guestIndex) => guestIndex !== activeGuestIndex && !isGuestComplete(guestIndex)),
    [guestIndexes, activeGuestIndex, isGuestComplete],
  );

  const scrollToTopOfCourses = () => {
    document.getElementById("course-list")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const goToGuest = (guestIndex: number) => {
    setActiveGuestIndex(guestIndex);
    setError("");
    // The courses below have just been swapped for another guest's; without
    // this the page stays where it was and looks like nothing happened.
    scrollToTopOfCourses();
  };

  /**
   * One button that always does the obvious next thing.
   *
   * It is never disabled. A disabled button gives no reason and leaves the
   * guest to work out for themselves that somebody upstairs in the list is
   * unfinished — so instead it either takes them to the course they missed, or
   * on to the next guest, or to the summary.
   */
  const primaryAction = (() => {
    if (!currentGuestComplete) {
      const missing = firstUnansweredCourse(activeGuestIndex);
      return {
        label: missing ? `Choose ${missing.name}` : "Continue",
        onClick: () => {
          if (missing) {
            document.getElementById(`course-${missing.id}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
            setError("");
          }
        },
      };
    }

    if (nextIncompleteGuest !== undefined) {
      return {
        label: `Continue to guest ${nextIncompleteGuest + 1}`,
        onClick: () => goToGuest(nextIncompleteGuest),
      };
    }

    return { label: "Review reservation", onClick: () => router.push("/booking/summary") };
  })();

  return (
    <>
      <Card elevated className="p-4 sm:p-6">
        <CardHeader
          as="h1"
          flourish
          eyebrow="Menu"
          title="Choose your menu"
          description="Each guest picks one option per course."
          actions={
            <label className="flex items-center gap-2 rounded-full border border-line-strong bg-surface px-3 py-2 text-sm">
              <span className="font-medium text-ink-muted">Language</span>
              <select
                value={language}
                onChange={(event) => writeBookingSession({ language: event.target.value })}
                className="bg-transparent font-medium text-ink outline-none"
              >
                {availableLanguages.map((code) => (
                  <option key={code} value={code}>
                    {LANGUAGE_NAMES[code] ?? code.toUpperCase()}
                  </option>
                ))}
              </select>
            </label>
          }
        />

        {guestCount > 1 ? (
          <div className="mt-6">
            <div className="mb-2 flex items-center justify-between text-sm text-ink-muted">
              <span id="guest-picker-label" className="font-medium">
                Guest
              </span>
              <span aria-live="polite">
                {completedCount} of {guestCount} complete
              </span>
            </div>
            {/* Toggle buttons rather than a tablist: a real tab pattern would
                promise arrow-key navigation between panels. */}
            <div role="group" aria-labelledby="guest-picker-label" className="flex flex-wrap gap-2">
              {guestIndexes.map((guestIndex) => {
                const isActive = activeGuestIndex === guestIndex;
                const complete = isGuestComplete(guestIndex);

                return (
                  <button
                    key={guestIndex}
                    type="button"
                    aria-pressed={isActive}
                    onClick={() => goToGuest(guestIndex)}
                    className={cx(
                      "min-h-11 rounded-full border px-4 text-sm font-medium transition-colors",
                      isActive
                        ? "border-primary bg-primary text-primary-fg"
                        : complete
                          ? "border-success/40 bg-success-soft text-success"
                          : "border-line-strong bg-surface text-ink hover:border-accent",
                    )}
                  >
                    Guest {guestIndex + 1}
                    {complete ? <span aria-hidden="true"> ✓</span> : null}
                    <span className="sr-only">{complete ? " (complete)" : " (incomplete)"}</span>
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}
      </Card>

      {localizedCourses.length === 0 ? (
        <Card className="mt-6 p-6">
          <Alert tone="info">The menu is not published yet. Please contact guest services.</Alert>
        </Card>
      ) : (
        <div id="course-list" className="mt-6 space-y-5 scroll-mt-4">
          {guestCount > 1 ? (
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-lg font-semibold text-ink">Choices for guest {activeGuestIndex + 1}</h2>
              <p aria-live="polite" className="text-sm text-ink-muted">
                {currentGuestComplete
                  ? "All courses chosen for this guest."
                  : `${chosenForActiveGuest} of ${requiredCourses.length} courses chosen`}
              </p>
            </div>
          ) : null}

          {localizedCourses.map((course) => {
            const selection = selections.find(
              (entry) => entry.guestIndex === activeGuestIndex && entry.courseId === course.id,
            );

            return (
              <Tilt key={course.id} maxTilt={2} lift={6} className="reveal rounded-card">
              <Card id={`course-${course.id}`} as="section" className="lift overflow-hidden scroll-mt-4">
                {/*
                  The course announces itself full-bleed, with the title over
                  the photograph rather than beside it. A dish deserves the
                  width of the card; a 160px thumbnail beside a heading is a
                  list item, not a menu.
                */}
                <div className="relative isolate aspect-[16/10] w-full overflow-hidden sm:aspect-[21/9]">
                  <DishImage
                    src={course.imageUrl}
                    alt=""
                    width={1200}
                    height={640}
                    className="absolute inset-0 !rounded-none !border-0 size-full object-cover"
                  />

                  {/* A scrim, so display type stays legible over any photograph. */}
                  <div
                    aria-hidden="true"
                    className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/35 to-black/5"
                  />

                  <div className="tilt-layer absolute inset-x-0 bottom-0 p-5 sm:p-7">
                    <p className="text-[0.6875rem] font-medium uppercase tracking-[0.24em] text-gold">
                      Course {course.order} · {course.required ? "Required" : "Optional"}
                    </p>
                    <h3 className="display mt-1.5 text-[clamp(1.9rem,7vw,2.9rem)] text-white drop-shadow-sm">
                      {course.name}
                    </h3>
                    {course.description ? (
                      <p className="mt-1.5 max-w-prose text-sm text-pretty text-white/85">{course.description}</p>
                    ) : null}
                    {selection ? (
                      <p className="mt-3 inline-flex items-center gap-2 rounded-full border border-gold/60 bg-black/45 px-3 py-1.5 text-xs font-medium text-white backdrop-blur">
                        <span aria-hidden="true" className="text-gold">
                          ✓
                        </span>
                        {selection.optionName}
                      </p>
                    ) : null}
                  </div>
                </div>

                <fieldset className="p-4 sm:p-6">
                  <legend className="sr-only">
                    {course.name} options for guest {activeGuestIndex + 1}
                  </legend>
                  {/* Two across from `sm`, so a dish reads as a plate rather
                      than a row in a table. */}
                  <div
                    role="radiogroup"
                    aria-label={`${course.name} options`}
                    className="grid gap-3 sm:grid-cols-2"
                  >
                    {course.options.map((option) => {
                      const isSelected = selection?.optionId === option.id;
                      const justChosen = flash?.courseId === course.id && flash.optionId === option.id;

                      return (
                        <button
                          key={option.id}
                          type="button"
                          role="radio"
                          aria-checked={isSelected}
                          onClick={() => chooseOption(activeGuestIndex, course, option)}
                          className={cx(
                            "lift group relative flex flex-col overflow-hidden rounded-card border text-left",
                            isSelected
                              ? "border-gold bg-accent-soft"
                              : "border-line bg-surface hover:border-accent",
                          )}
                        >
                          {/*
                            The confirmation flash. Remounting this one empty
                            span is what restarts the animation; remounting the
                            whole button — which is what a key on the selected
                            state used to do — threw away the dish photograph
                            and rebuilt it on every tap.
                          */}
                          {justChosen ? (
                            <span key={flash.tick} aria-hidden="true" className="bloom-ring" />
                          ) : null}

                          <span className="relative block aspect-[16/9] max-h-[13rem] w-full overflow-hidden sm:aspect-[4/3] sm:max-h-none">
                            <DishImage
                              src={option.imageUrl}
                              alt=""
                              width={640}
                              height={480}
                              className={cx(
                                "absolute inset-0 !rounded-none !border-0 size-full object-cover",
                                // A slow push in on hover: the dish comes to
                                // the reader rather than the card sliding.
                                "transition-transform duration-[--motion-hero] ease-[--ease-settle]",
                                "group-hover:scale-[1.06]",
                              )}
                            />

                            {option.vegan ? (
                              <span className="absolute left-2 top-2 z-10">
                                <VeganBadge />
                              </span>
                            ) : null}

                            {/* The chosen dish is marked on the plate itself. */}
                            {isSelected ? (
                              <span
                                aria-hidden="true"
                                className="absolute right-2 top-2 z-10 flex size-8 items-center justify-center rounded-full bg-gold text-base font-bold text-primary-fg shadow-lg"
                              >
                                ✓
                              </span>
                            ) : null}
                          </span>

                          <span className="flex min-w-0 flex-1 flex-col p-4">
                            <span
                              className={cx(
                                "display text-xl text-balance",
                                isSelected ? "text-accent-ink" : "text-ink",
                              )}
                            >
                              {option.name}
                            </span>

                            {option.description ? (
                              <span className="mt-1.5 block text-sm text-pretty text-ink-muted">
                                {option.description}
                              </span>
                            ) : null}

                            {/* Only shown when the kitchen has filled it in. */}
                            {option.ingredients ? (
                              <span className="mt-2 block text-xs text-pretty text-ink-muted">
                                <span className="font-medium">Ingredients:</span> {option.ingredients}
                              </span>
                            ) : null}

                            {option.allergens.length ? (
                              <span className="mt-2 block text-xs text-ink-subtle">
                                <span className="font-medium">Allergens:</span> {option.allergens.join(", ")}
                              </span>
                            ) : null}
                          </span>
                        </button>
                      );
                    })}

                    {(() => {
                      const isSelected = selection?.optionId === NONE_OPTION_ID;
                      const justChosen = flash?.courseId === course.id && flash.optionId === NONE_OPTION_ID;

                      return (
                        <button
                          type="button"
                          role="radio"
                          aria-checked={isSelected}
                          onClick={() =>
                            chooseOption(activeGuestIndex, course, {
                              id: NONE_OPTION_ID,
                              name: NONE_OPTION_NAME,
                            })
                          }
                          className={cx(
                            "lift relative flex w-full items-center gap-3 rounded-card border border-dashed p-4 text-left sm:col-span-2",
                            isSelected
                              ? "border-gold bg-accent-soft text-accent-ink"
                              : "border-line-strong bg-surface text-ink-muted hover:border-accent",
                          )}
                        >
                          {justChosen ? (
                            <span key={flash.tick} aria-hidden="true" className="bloom-ring" />
                          ) : null}

                          <span className="flex size-20 shrink-0 items-center justify-center rounded-control border border-line text-2xl">
                            <span aria-hidden="true">—</span>
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block text-base font-semibold">No thank you</span>
                            <span
                              className={cx(
                                "mt-1 block text-sm",
                                isSelected ? "text-primary-fg/80" : "text-ink-subtle",
                              )}
                            >
                              Skip this course
                            </span>
                          </span>
                          <span aria-hidden="true" className="text-lg">
                            {isSelected ? "✓" : ""}
                          </span>
                        </button>
                      );
                    })()}
                  </div>
                </fieldset>
              </Card>
              </Tilt>
            );
          })}
        </div>
      )}

      {error ? (
        <Alert tone="danger" className="mt-6">
          {error}
        </Alert>
      ) : null}

      {/*
        Sticky, so the way forward is always on screen. The complaint this
        answers was having to scroll back to the top to move to the next guest.
      */}
      <div className="glass sticky bottom-0 z-10 mt-6 border-t border-line py-3">
        <div className="flex items-center gap-2">
          <ButtonLink href="/booking/date" size="lg" className="shrink-0 px-4">
            <span aria-hidden="true">←</span>
            <span className="sr-only">Back to the date</span>
          </ButtonLink>
          <Button size="lg" className="flex-1" onClick={primaryAction.onClick} disabled={!ready}>
            {primaryAction.label}
          </Button>
        </div>

        {guestCount > 1 ? (
          <p aria-live="polite" className="mt-1.5 text-center text-xs text-ink-muted">
            {allComplete
              ? "Everyone has chosen."
              : `${completedCount} of ${guestCount} guests have finished choosing.`}
          </p>
        ) : null}
      </div>
    </>
  );
}
