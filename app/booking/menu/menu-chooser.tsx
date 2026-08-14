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
import { cx } from "@/components/ui/utils";
import type { MenuCourse, MenuOption, ReservationSelection } from "@/types/booking";

export function MenuChooser({ courses }: { courses: MenuCourse[] }) {
  const router = useRouter();
  const { session, ready } = useBookingGuard(["room", "guests", "date"]);

  const [activeGuestIndex, setActiveGuestIndex] = useState(0);
  const [error, setError] = useState("");

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
    setError("");
  };

  const allComplete = localizedCourses.length > 0 && guestIndexes.every(isGuestComplete);
  const completedCount = guestIndexes.filter(isGuestComplete).length;

  const handleContinue = () => {
    const incompleteGuest = guestIndexes.find((guestIndex) => !isGuestComplete(guestIndex));

    if (incompleteGuest !== undefined) {
      setActiveGuestIndex(incompleteGuest);
      setError(`Please complete the menu choices for guest ${incompleteGuest + 1}.`);
      return;
    }

    router.push("/booking/summary");
  };

  return (
    <>
      <Card className="p-4 sm:p-6">
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
                    onClick={() => setActiveGuestIndex(guestIndex)}
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
        <div className="mt-6 space-y-5">
          {guestCount > 1 ? (
            <h2 className="text-lg font-semibold text-ink">Choices for guest {activeGuestIndex + 1}</h2>
          ) : null}

          {localizedCourses.map((course) => {
            const selection = selections.find(
              (entry) => entry.guestIndex === activeGuestIndex && entry.courseId === course.id,
            );

            return (
              <Card key={course.id} as="section" className="overflow-hidden">
                <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-start">
                  <DishImage src={course.imageUrl} alt="" width={160} height={112} className="h-28 w-full sm:w-40" />
                  <div className="min-w-0 flex-1">
                    <p className="eyebrow">Course {course.order}</p>
                    <h3 className="display mt-1 text-2xl text-ink">{course.name}</h3>
                    {course.description ? (
                      <p className="mt-1 text-sm text-pretty text-ink-muted">{course.description}</p>
                    ) : null}
                    <p className="mt-2 text-xs font-medium text-accent-ink">
                      {course.required ? "Required" : "Optional"}
                      {selection ? ` · ${selection.optionName} selected` : ""}
                    </p>
                  </div>
                </div>

                <fieldset className="border-t border-line p-5">
                  <legend className="sr-only">
                    {course.name} options for guest {activeGuestIndex + 1}
                  </legend>
                  <div role="radiogroup" aria-label={`${course.name} options`} className="space-y-3">
                    {course.options.map((option) => {
                      const isSelected = selection?.optionId === option.id;

                      return (
                        <button
                          key={option.id}
                          type="button"
                          role="radio"
                          aria-checked={isSelected}
                          onClick={() => chooseOption(activeGuestIndex, course, option)}
                          className={cx(
                            "relative flex w-full items-start gap-3 rounded-control border p-4 text-left transition-colors",
                            isSelected
                              ? "border-primary bg-primary text-primary-fg"
                              : "border-line-strong bg-surface text-ink hover:border-accent",
                          )}
                        >
                          <DishImage src={option.imageUrl} alt="" width={80} height={80} className="size-20 shrink-0" />
                          <span className="min-w-0 flex-1">
                            <span className="block pr-16 text-base font-semibold">{option.name}</span>
                            {option.description ? (
                              <span
                                className={cx(
                                  "mt-1 block text-sm text-pretty",
                                  isSelected ? "text-primary-fg/80" : "text-ink-muted",
                                )}
                              >
                                {option.description}
                              </span>
                            ) : null}
                            {/* Only shown when the kitchen has filled it in. */}
                            {option.ingredients ? (
                              <span
                                className={cx(
                                  "mt-2 block text-xs text-pretty",
                                  isSelected ? "text-primary-fg/80" : "text-ink-muted",
                                )}
                              >
                                <span className="font-medium">Ingredients:</span> {option.ingredients}
                              </span>
                            ) : null}
                            {option.allergens.length ? (
                              <span
                                className={cx(
                                  "mt-1 block text-xs",
                                  isSelected ? "text-primary-fg/80" : "text-ink-subtle",
                                )}
                              >
                                <span className="font-medium">Allergens:</span> {option.allergens.join(", ")}
                              </span>
                            ) : null}
                          </span>

                          {/* Top-right of the option, clear of the text. */}
                          {option.vegan ? (
                            <span className="absolute right-3 top-3">
                              <VeganBadge />
                            </span>
                          ) : null}

                          <span aria-hidden="true" className="text-lg">
                            {isSelected ? "✓" : ""}
                          </span>
                        </button>
                      );
                    })}

                    {(() => {
                      const isSelected = selection?.optionId === NONE_OPTION_ID;

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
                            "flex w-full items-center gap-3 rounded-control border border-dashed p-4 text-left transition-colors",
                            isSelected
                              ? "border-primary bg-primary text-primary-fg"
                              : "border-line-strong bg-surface text-ink-muted hover:border-accent",
                          )}
                        >
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
            );
          })}
        </div>
      )}

      {error ? (
        <Alert tone="danger" className="mt-6">
          {error}
        </Alert>
      ) : null}

      <div className="mt-6 flex flex-col gap-3 sm:flex-row">
        <ButtonLink href="/booking/date" size="lg" className="flex-1">
          Back
        </ButtonLink>
        <Button size="lg" className="flex-1" onClick={handleContinue} disabled={!ready || !allComplete}>
          Review reservation
        </Button>
      </div>
    </>
  );
}
