"use client";

import { useMemo, useState } from "react";
import { ImageUploader } from "@/components/image-uploader";
import { Card, CardHeader } from "@/components/ui/card";
import { Button, ButtonLink } from "@/components/ui/button";
import { Alert } from "@/components/ui/feedback";
import { Field, Input, Textarea } from "@/components/ui/field";
import { LANGUAGE_NAMES, isLanguageCode, listLanguages } from "@/lib/languages";
import { cx } from "@/components/ui/utils";
import type { MenuCourse, MenuOption, MenuTranslation } from "@/types/booking";

const DEFAULT_LANGUAGE = "en";

/** Reads a name/description in the given language, falling back to English. */
function readTranslated(item: MenuCourse | MenuOption, language: string, field: keyof MenuTranslation) {
  if (language === DEFAULT_LANGUAGE) {
    return item[field] ?? "";
  }
  return item.translations?.[language]?.[field] ?? "";
}

function withTranslation<T extends MenuCourse | MenuOption>(
  item: T,
  language: string,
  field: keyof MenuTranslation,
  value: string,
): T {
  if (language === DEFAULT_LANGUAGE) {
    // English is the canonical copy; it is stored on the item itself and
    // mirrored into translations so the fallback chain always resolves.
    return {
      ...item,
      [field]: value,
      translations: { ...item.translations, en: { ...item.translations?.en, [field]: value } },
    };
  }

  return {
    ...item,
    translations: {
      ...item.translations,
      [language]: { ...item.translations?.[language], [field]: value },
    },
  };
}

export function MenuEditor({ initialCourses }: { initialCourses: MenuCourse[] }) {
  const [courses, setCourses] = useState<MenuCourse[]>(initialCourses);
  const [language, setLanguage] = useState(DEFAULT_LANGUAGE);
  const [extraLanguages, setExtraLanguages] = useState<string[]>([]);
  const [newLanguage, setNewLanguage] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const languages = useMemo(
    () => [...new Set([...listLanguages(courses), ...extraLanguages])],
    [courses, extraLanguages],
  );
  const activeLanguage = languages.includes(language) ? language : DEFAULT_LANGUAGE;
  const isDefaultLanguage = activeLanguage === DEFAULT_LANGUAGE;

  const updateCourse = (courseId: string, update: (course: MenuCourse) => MenuCourse) => {
    setCourses((current) => current.map((course) => (course.id === courseId ? update(course) : course)));
    setNotice("");
  };

  const updateOption = (courseId: string, optionId: string, update: (option: MenuOption) => MenuOption) => {
    updateCourse(courseId, (course) => ({
      ...course,
      options: course.options.map((option) => (option.id === optionId ? update(option) : option)),
    }));
  };

  const moveCourse = (courseId: string, direction: -1 | 1) => {
    setCourses((current) => {
      const index = current.findIndex((course) => course.id === courseId);
      const target = index + direction;
      if (index === -1 || target < 0 || target >= current.length) {
        return current;
      }

      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      // Keep `order` in step with the visual order that was just chosen.
      return next.map((course, position) => ({ ...course, order: position + 1 }));
    });
    setNotice("");
  };

  const addCourse = () => {
    setCourses((current) => [
      ...current,
      {
        id: `draft-course-${crypto.randomUUID()}`,
        order: current.length + 1,
        name: "New course",
        description: "",
        required: true,
        active: true,
        imageUrl: "",
        translations: { en: { name: "New course", description: "" } },
        options: [],
      },
    ]);
    setLanguage(DEFAULT_LANGUAGE);
    setNotice("");
  };

  const removeCourse = (courseId: string) => {
    setCourses((current) =>
      current.filter((course) => course.id !== courseId).map((course, index) => ({ ...course, order: index + 1 })),
    );
    setNotice("");
  };

  const addOption = (courseId: string) => {
    updateCourse(courseId, (course) => ({
      ...course,
      options: [
        ...course.options,
        {
          id: `draft-option-${crypto.randomUUID()}`,
          courseId,
          name: "New option",
          description: "",
          allergens: [],
          active: true,
          imageUrl: "",
          translations: { en: { name: "New option", description: "" } },
        },
      ],
    }));
  };

  const removeOption = (courseId: string, optionId: string) => {
    updateCourse(courseId, (course) => ({
      ...course,
      options: course.options.filter((option) => option.id !== optionId),
    }));
  };

  const addLanguage = () => {
    const candidate = newLanguage.trim().toLowerCase();

    if (!isLanguageCode(candidate)) {
      setError("Use a language code such as en, fr, es or ar.");
      return;
    }

    setExtraLanguages((current) => [...new Set([...current, candidate])]);
    setLanguage(candidate);
    setNewLanguage("");
    setError("");
  };

  const handleSave = async () => {
    if (saving) {
      return;
    }

    const untitled = courses.find((course) => !course.name.trim());
    if (untitled) {
      setError("Every course needs an English name before saving.");
      return;
    }

    setSaving(true);
    setError("");
    setNotice("");

    try {
      const response = await fetch("/api/admin/menu", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          courses: courses.map((course) => ({
            ...course,
            // Draft ids are placeholders; the server assigns real ones.
            id: course.id.startsWith("draft-") ? undefined : course.id,
            options: course.options.map((option) => ({
              ...option,
              id: option.id.startsWith("draft-") ? undefined : option.id,
            })),
          })),
        }),
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(data.error ?? "Unable to save the menu.");
      }

      setCourses(Array.isArray(data.menu) ? data.menu : courses);
      setNotice("Menu saved. Guests will see these changes immediately.");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Unable to save menu changes.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Card className="p-5 sm:p-6">
        <CardHeader
          as="h1"
          eyebrow="Admin panel"
          title="Menu editor"
          description="English is the master copy. Other languages fall back to English wherever a translation is missing."
          actions={
            <div className="flex flex-wrap items-center gap-3">
              <ButtonLink href="/admin">Dashboard</ButtonLink>
              <Button onClick={handleSave} loading={saving} loadingLabel="Saving…">
                Save menu
              </Button>
            </div>
          }
        />

        <div className="mt-6 flex flex-wrap items-end gap-4">
          <div>
            <p className="text-sm font-medium text-ink">Editing language</p>
            <div className="mt-2 flex flex-wrap gap-2" role="group" aria-label="Editing language">
              {languages.map((code) => (
                <button
                  key={code}
                  type="button"
                  aria-pressed={activeLanguage === code}
                  onClick={() => setLanguage(code)}
                  className={cx(
                    "min-h-11 rounded-full border px-4 text-sm font-semibold transition-colors",
                    activeLanguage === code
                      ? "border-accent bg-accent-soft text-accent-ink"
                      : "border-line-strong bg-surface text-ink hover:border-accent",
                  )}
                >
                  {LANGUAGE_NAMES[code] ?? code.toUpperCase()}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-end gap-2">
            <Field label="Add a language">
              {(fieldProps) => (
                <Input
                  {...fieldProps}
                  value={newLanguage}
                  onChange={(event) => setNewLanguage(event.target.value)}
                  placeholder="es"
                  className="w-24"
                />
              )}
            </Field>
            <Button variant="secondary" onClick={addLanguage}>
              Add
            </Button>
          </div>
        </div>

        {error ? (
          <Alert tone="danger" className="mt-4">
            {error}
          </Alert>
        ) : null}
        {notice ? (
          <Alert tone="success" className="mt-4">
            {notice}
          </Alert>
        ) : null}

        {!isDefaultLanguage ? (
          <Alert tone="info" className="mt-4">
            Editing {LANGUAGE_NAMES[activeLanguage] ?? activeLanguage.toUpperCase()} translations. Switch to English to
            change images, allergens or the course structure.
          </Alert>
        ) : null}
      </Card>

      <div className="mt-6 space-y-5">
        {courses.map((course, index) => (
          <Card key={course.id} as="section" className="p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="eyebrow">Course {course.order}</p>
                <h2 className="mt-1 text-xl font-semibold text-ink">{course.name || "Untitled course"}</h2>
              </div>

              {isDefaultLanguage ? (
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    variant="secondary"
                    onClick={() => moveCourse(course.id, -1)}
                    disabled={index === 0}
                    aria-label={`Move ${course.name} earlier`}
                  >
                    ↑
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={() => moveCourse(course.id, 1)}
                    disabled={index === courses.length - 1}
                    aria-label={`Move ${course.name} later`}
                  >
                    ↓
                  </Button>
                  <Button variant="danger" onClick={() => removeCourse(course.id)}>
                    Remove course
                  </Button>
                </div>
              ) : null}
            </div>

            <div className="mt-5 grid gap-4 md:grid-cols-2">
              <Field label={`Name (${activeLanguage.toUpperCase()})`}>
                {(fieldProps) => (
                  <Input
                    {...fieldProps}
                    value={readTranslated(course, activeLanguage, "name")}
                    onChange={(event) =>
                      updateCourse(course.id, (current) =>
                        withTranslation(current, activeLanguage, "name", event.target.value),
                      )
                    }
                  />
                )}
              </Field>
              <Field label={`Description (${activeLanguage.toUpperCase()})`}>
                {(fieldProps) => (
                  <Textarea
                    {...fieldProps}
                    value={readTranslated(course, activeLanguage, "description")}
                    onChange={(event) =>
                      updateCourse(course.id, (current) =>
                        withTranslation(current, activeLanguage, "description", event.target.value),
                      )
                    }
                  />
                )}
              </Field>
            </div>

            {isDefaultLanguage ? (
              <>
                <div className="mt-4 flex flex-wrap items-center gap-6">
                  <label className="flex items-center gap-2 text-sm font-medium text-ink">
                    <input
                      type="checkbox"
                      className="size-4 accent-[var(--primary)]"
                      checked={course.required}
                      onChange={(event) =>
                        updateCourse(course.id, (current) => ({ ...current, required: event.target.checked }))
                      }
                    />
                    Required
                  </label>
                  <label className="flex items-center gap-2 text-sm font-medium text-ink">
                    <input
                      type="checkbox"
                      className="size-4 accent-[var(--primary)]"
                      checked={course.active}
                      onChange={(event) =>
                        updateCourse(course.id, (current) => ({ ...current, active: event.target.checked }))
                      }
                    />
                    Visible to guests
                  </label>
                </div>

                <div className="mt-4">
                  <ImageUploader
                    label="Course photo"
                    value={course.imageUrl ?? ""}
                    onChange={(imageUrl) => updateCourse(course.id, (current) => ({ ...current, imageUrl }))}
                    previewClassName="h-24 w-32"
                  />
                </div>
              </>
            ) : null}

            <div className="mt-6 border-t border-line pt-5">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-lg font-semibold text-ink">Options</h3>
                {isDefaultLanguage ? (
                  <Button variant="secondary" onClick={() => addOption(course.id)}>
                    Add option
                  </Button>
                ) : null}
              </div>

              {course.options.length === 0 ? (
                <p className="rounded-control border border-dashed border-line-strong bg-surface-muted p-4 text-sm text-ink-muted">
                  This course has no options yet. Guests cannot complete a booking until it has at least one.
                </p>
              ) : (
                <div className="space-y-4">
                  {course.options.map((option) => (
                    <div key={option.id} className="rounded-control border border-line bg-surface-muted p-4">
                      <div className="grid gap-4 md:grid-cols-2">
                        <Field label={`Option name (${activeLanguage.toUpperCase()})`}>
                          {(fieldProps) => (
                            <Input
                              {...fieldProps}
                              value={readTranslated(option, activeLanguage, "name")}
                              onChange={(event) =>
                                updateOption(course.id, option.id, (current) =>
                                  withTranslation(current, activeLanguage, "name", event.target.value),
                                )
                              }
                            />
                          )}
                        </Field>
                        <Field label={`Option description (${activeLanguage.toUpperCase()})`}>
                          {(fieldProps) => (
                            <Textarea
                              {...fieldProps}
                              value={readTranslated(option, activeLanguage, "description")}
                              onChange={(event) =>
                                updateOption(course.id, option.id, (current) =>
                                  withTranslation(current, activeLanguage, "description", event.target.value),
                                )
                              }
                            />
                          )}
                        </Field>
                      </div>

                      {isDefaultLanguage ? (
                        <>
                          <div className="mt-4">
                            <Field label="Allergens" hint="Comma separated">
                              {(fieldProps) => (
                                <Input
                                  {...fieldProps}
                                  value={option.allergens.join(", ")}
                                  onChange={(event) =>
                                    updateOption(course.id, option.id, (current) => ({
                                      ...current,
                                      allergens: event.target.value
                                        .split(",")
                                        .map((entry) => entry.trim())
                                        .filter(Boolean),
                                    }))
                                  }
                                />
                              )}
                            </Field>
                          </div>

                          {/* Guests see this picture beside the dish, so it
                              gets the same uploader as a course. */}
                          <div className="mt-4">
                            <ImageUploader
                              label="Dish photo"
                              value={option.imageUrl ?? ""}
                              onChange={(imageUrl) =>
                                updateOption(course.id, option.id, (current) => ({ ...current, imageUrl }))
                              }
                              previewClassName="size-24"
                            />
                          </div>

                          <div className="mt-4 flex flex-wrap items-center justify-between gap-4">
                            <label className="flex items-center gap-2 text-sm font-medium text-ink">
                              <input
                                type="checkbox"
                                className="size-4 accent-[var(--primary)]"
                                checked={option.active}
                                onChange={(event) =>
                                  updateOption(course.id, option.id, (current) => ({
                                    ...current,
                                    active: event.target.checked,
                                  }))
                                }
                              />
                              Available
                            </label>
                            <Button variant="danger" onClick={() => removeOption(course.id, option.id)}>
                              Remove option
                            </Button>
                          </div>
                        </>
                      ) : null}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </Card>
        ))}
      </div>

      <div className="mt-6 flex flex-wrap justify-between gap-3">
        {isDefaultLanguage ? (
          <Button variant="secondary" onClick={addCourse}>
            Add course
          </Button>
        ) : (
          <span />
        )}
        <Button onClick={handleSave} loading={saving} loadingLabel="Saving…">
          Save menu
        </Button>
      </div>
    </>
  );
}
