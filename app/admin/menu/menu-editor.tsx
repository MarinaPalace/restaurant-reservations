"use client";

import { useMemo, useState } from "react";
import { ImageUploader } from "@/components/image-uploader";
import { Card, CardHeader } from "@/components/ui/card";
import { Button, ButtonLink } from "@/components/ui/button";
import { Alert } from "@/components/ui/feedback";
import { Field, Input, Textarea } from "@/components/ui/field";
import { LANGUAGE_NAMES, isLanguageCode, listLanguages } from "@/lib/languages";
import { hasAllergen, listAllergenChoices, toggleAllergen } from "@/lib/allergens";
import { VeganBadge } from "@/components/vegan-badge";
import { cx } from "@/components/ui/utils";
import Link from "next/link";
import { CURRENCIES, discountedPrice, formatPrice, type Currency } from "@/lib/money";
import { MENU_CATALOGS, type MenuCatalog, type MenuCourse, type MenuOption, type MenuTranslation } from "@/types/booking";

const DEFAULT_LANGUAGE = "en";

/** Reads a translatable field in the given language, falling back to English. */
function readTranslated(item: MenuCourse | MenuOption, language: string, field: keyof MenuTranslation) {
  if (language === DEFAULT_LANGUAGE) {
    // Only options carry ingredients, so the lookup is deliberately loose.
    return (item as Record<string, unknown>)[field]?.toString() ?? "";
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

/**
 * What each catalogue is called, and what it is for, in the editor's own
 * words.
 *
 * Kept as data rather than three ternaries through the markup: the wording is
 * most of the difference between editing a dinner and editing a wine list, and
 * a table makes it obvious that nothing else diverges.
 */
const CATALOGS = {
  standard: {
    label: "Everyday",
    eyebrow: "Admin panel",
    title: "Menu editor",
    description:
      "English is the master copy. Other languages fall back to English wherever a translation is missing.",
    groupNoun: "Course",
    newGroupName: "New course",
    newItemName: "New option",
    href: "/admin/menu",
  },
  premium: {
    label: "Premium",
    eyebrow: "Invitation menu",
    title: "Premium menu editor",
    description:
      "Served only to invited guests booking from /premium. Saved separately from the everyday menu.",
    groupNoun: "Course",
    newGroupName: "New course",
    newItemName: "New option",
    href: "/admin/menu?menu=premium",
  },
  promo: {
    label: "Promotions",
    eyebrow: "Offered after booking",
    title: "Promotions editor",
    description:
      "Products offered once, on the confirmation screen, after a guest has their reservation number. Nothing here appears in the dinner menu.",
    groupNoun: "Group",
    newGroupName: "New group",
    newItemName: "New product",
    href: "/admin/menu?menu=promo",
  },
} as const satisfies Record<MenuCatalog, unknown>;

/**
 * What a promotion costs, and what the guest will actually be shown.
 *
 * The preview is the point. A discount is two numbers that produce a third,
 * and typing 25 into a box does not tell you whether the wine now reads as a
 * bargain or as a rounding error — so the row renders the same struck-through
 * pair the confirmation screen does, in the currency the restaurant quotes in,
 * as it is typed.
 */
function PromoPricing({
  option,
  currency,
  onChange,
}: {
  option: MenuOption;
  currency: Currency;
  onChange: (patch: Partial<MenuOption>) => void;
}) {
  const price = Math.max(0, Number(option.price ?? 0));
  const discountPercent = Math.min(100, Math.max(0, Math.round(Number(option.discountPercent ?? 0))));
  const finalPrice = discountedPrice(price, discountPercent);

  return (
    <div className="mt-4 rounded-control border border-line bg-surface-muted p-4">
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Price">
          {(fieldProps) => (
            <Input
              {...fieldProps}
              type="number"
              min="0"
              step="0.01"
              value={option.price ?? 0}
              onChange={(event) => onChange({ price: Math.max(0, Number(event.target.value) || 0) })}
              className="w-28"
            />
          )}
        </Field>
        <Field label="Discount %">
          {(fieldProps) => (
            <Input
              {...fieldProps}
              type="number"
              min="0"
              max="100"
              step="1"
              value={option.discountPercent ?? 0}
              onChange={(event) =>
                onChange({
                  discountPercent: Math.min(100, Math.max(0, Math.round(Number(event.target.value) || 0))),
                })
              }
              className="w-28"
            />
          )}
        </Field>

        <div className="min-w-40">
          <p className="text-xs font-medium uppercase tracking-wide text-ink-subtle">Guests will see</p>
          <p className="mt-1 flex flex-wrap items-baseline gap-2">
            {discountPercent > 0 ? (
              <s className="text-sm text-ink-subtle">{formatPrice(price, currency, "en")}</s>
            ) : null}
            <span className="text-lg font-semibold text-ink">{formatPrice(finalPrice, currency, "en")}</span>
            {discountPercent > 0 ? (
              <span className="rounded-full bg-success-soft px-2 py-0.5 text-xs font-semibold text-success">
                −{discountPercent}%
              </span>
            ) : null}
          </p>
          {price === 0 ? (
            <p className="mt-1 text-xs text-ink-muted">Free — offered at no charge.</p>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export function MenuEditor({
  initialCourses,
  menu,
  /**
   * True when this catalogue is empty and what is on screen is a copy of the
   * everyday menu that has not been saved yet. Nothing exists on the server
   * until the person presses Save.
   */
  startedFromCopy = false,
  /**
   * What promotion prices are quoted in. Promotions only — a dinner course
   * carries no price — and saved through its own endpoint, so changing it does
   * not require saving the catalogue.
   */
  initialCurrency,
}: {
  initialCourses: MenuCourse[];
  menu: MenuCatalog;
  startedFromCopy?: boolean;
  initialCurrency: Currency;
}) {
  const catalog = CATALOGS[menu];
  const isPromo = menu === "promo";
  const [currency, setCurrency] = useState<Currency>(initialCurrency);
  const [savingCurrency, setSavingCurrency] = useState(false);
  const [courses, setCourses] = useState<MenuCourse[]>(initialCourses);
  // Cleared on the first successful save, when the copy stops being a draft.
  const [showCopyNotice, setShowCopyNotice] = useState(startedFromCopy);
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

  const allergenChoices = useMemo(
    () => listAllergenChoices(courses.flatMap((course) => course.options.flatMap((option) => option.allergens ?? []))),
    [courses],
  );

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
        menu,
        order: current.length + 1,
        name: catalog.newGroupName,
        description: "",
        // A promotion is never compulsory. The server forces this too; here it
        // is so the checkbox is not shown ticked for a moment before it does.
        required: !isPromo,
        active: true,
        imageUrl: "",
        translations: { en: { name: catalog.newGroupName, description: "" } },
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
          name: catalog.newItemName,
          description: "",
          allergens: [],
          active: true,
          imageUrl: "",
          ingredients: "",
          vegan: false,
          price: 0,
          discountPercent: 0,
          translations: { en: { name: catalog.newItemName, description: "" } },
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

  /**
   * Saved on change, through its own endpoint.
   *
   * Not folded into "Save menu" because it is not part of the catalogue: the
   * currency is one value the whole restaurant quotes in, and requiring a full
   * menu save to change it would mean an unfinished wine list had to be saved
   * to fix a currency typo.
   */
  const handleCurrencyChange = async (next: Currency) => {
    const previous = currency;
    setCurrency(next);
    setSavingCurrency(true);
    setError("");
    setNotice("");

    try {
      const response = await fetch("/api/admin/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currency: next }),
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(data.error ?? "Unable to save the currency.");
      }

      setNotice(`Prices are now quoted in ${next}.`);
    } catch (saveError) {
      // Put the select back, so it never shows a currency that was not stored.
      setCurrency(previous);
      setError(saveError instanceof Error ? saveError.message : "Unable to save the currency.");
    } finally {
      setSavingCurrency(false);
    }
  };

  const handleSave = async () => {
    if (saving) {
      return;
    }

    const untitled = courses.find((course) => !course.name.trim());
    if (untitled) {
      setError(`Every ${catalog.groupNoun.toLowerCase()} needs an English name before saving.`);
      return;
    }

    /**
     * A product nobody can name is a product nobody can order. Dinner options
     * are covered by the course check above — the kitchen knows what "Starter"
     * means — but a promotion is a line on a bill.
     */
    if (isPromo) {
      const unnamed = courses.find((course) => course.options.some((option) => !option.name.trim()));
      if (unnamed) {
        setError(`Every product in "${unnamed.name}" needs an English name before saving.`);
        return;
      }
    }

    setSaving(true);
    setError("");
    setNotice("");

    try {
      const response = await fetch("/api/admin/menu", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          menu,
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
      setShowCopyNotice(false);
      setNotice(
        showCopyNotice
          ? "Premium menu created from the everyday menu. The two are separate from now on — editing one does not change the other."
          : isPromo
            ? "Promotions saved. Guests confirming a booking from now on will be offered these."
            : "Menu saved. Guests will see these changes immediately.",
      );
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
          eyebrow={catalog.eyebrow}
          title={catalog.title}
          description={catalog.description}
          actions={
            <div className="flex flex-wrap items-center gap-3">
              {/* The three catalogues are edited and saved independently. */}
              <div role="group" aria-label="Which catalogue" className="flex rounded-control border border-line-strong">
                {MENU_CATALOGS.map((id) => (
                  <Link
                    key={id}
                    href={CATALOGS[id].href}
                    aria-current={menu === id ? "page" : undefined}
                    className={cx(
                      "flex min-h-11 items-center px-4 text-sm font-medium transition-colors first:rounded-l-control last:rounded-r-control",
                      menu === id ? "bg-primary text-primary-fg" : "bg-surface text-ink hover:bg-surface-sunken",
                    )}
                  >
                    {CATALOGS[id].label}
                  </Link>
                ))}
              </div>
              <ButtonLink href="/admin">Dashboard</ButtonLink>
              <Button onClick={handleSave} loading={saving} loadingLabel="Saving…">
                {isPromo ? "Save promotions" : "Save menu"}
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

          {isPromo ? (
            <div>
              <label htmlFor="promo-currency" className="text-sm font-medium text-ink">
                Prices are in
              </label>
              <select
                id="promo-currency"
                value={currency}
                disabled={savingCurrency}
                onChange={(event) => void handleCurrencyChange(event.target.value as Currency)}
                className="mt-2 block min-h-11 rounded-control border border-line-strong bg-surface px-3 text-sm font-medium text-ink"
              >
                {CURRENCIES.map((code) => (
                  <option key={code} value={code}>
                    {code} — {formatPrice(30, code, "en")}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs text-ink-muted">Saved on change. Applies to every promotion.</p>
            </div>
          ) : null}
        </div>

        {showCopyNotice ? (
          <Alert tone="warning" className="mt-4">
            <span className="font-semibold">This premium menu has not been created yet.</span> It is filled in below
            with a copy of the everyday menu so you have somewhere to start. Change whatever you like, then press{" "}
            <span className="font-semibold">Save menu</span> — nothing is stored, and invited guests see nothing, until
            you do. Afterwards the two menus are completely separate.
          </Alert>
        ) : null}

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

            {!isDefaultLanguage ? (
              <div className="mt-5 rounded-control border border-line bg-surface-muted p-3">
                <p className="text-xs font-medium uppercase tracking-wide text-ink-subtle">English (master)</p>
                <p className="mt-1 font-semibold text-ink">{course.name || "Untitled course"}</p>
                {course.description ? (
                  <p className="mt-1 text-sm text-ink-muted">{course.description}</p>
                ) : null}
              </div>
            ) : null}

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
                  {/* A promotion is never compulsory, so there is nothing to tick. */}
                  {isPromo ? null : (
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
                  )}
                  <label className="flex items-center gap-2 text-sm font-medium text-ink">
                    <input
                      type="checkbox"
                      className="size-4 accent-[var(--primary)]"
                      checked={course.active}
                      onChange={(event) =>
                        updateCourse(course.id, (current) => ({ ...current, active: event.target.checked }))
                      }
                    />
                    {isPromo ? "Offer this group" : "Visible to guests"}
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
                      {!isDefaultLanguage ? (
                        <div className="mb-4 rounded-control border border-line bg-surface p-3">
                          <p className="text-xs font-medium uppercase tracking-wide text-ink-subtle">
                            English (master)
                          </p>
                          <p className="mt-1 font-semibold text-ink">{option.name || "Untitled option"}</p>
                          {option.description ? (
                            <p className="mt-1 text-sm text-ink-muted">{option.description}</p>
                          ) : null}
                        </div>
                      ) : null}

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

                        <div className="md:col-span-2">
                          <Field
                            label={`Ingredients (${activeLanguage.toUpperCase()})`}
                            hint="Optional. Left blank, guests never see an ingredients line."
                          >
                            {(fieldProps) => (
                              <Textarea
                                {...fieldProps}
                                maxLength={500}
                                placeholder="Salmon, dill, pickled shallot, citrus"
                                value={readTranslated(option, activeLanguage, "ingredients")}
                                onChange={(event) =>
                                  updateOption(course.id, option.id, (current) =>
                                    withTranslation(current, activeLanguage, "ingredients", event.target.value),
                                  )
                                }
                              />
                            )}
                          </Field>
                        </div>
                      </div>

                      {isDefaultLanguage ? (
                        <>
                          <div className="mt-4">
                            <fieldset>
                              <legend className="text-sm font-medium text-ink">Allergens</legend>
                              <p className="mt-1 text-xs text-ink-muted">
                                The fourteen declarable allergens, plus anything already on this menu.
                              </p>
                              <div className="mt-2 flex flex-wrap gap-2">
                                {allergenChoices.map((allergen) => {
                                  const selected = hasAllergen(option.allergens ?? [], allergen);

                                  return (
                                    <button
                                      key={allergen}
                                      type="button"
                                      role="checkbox"
                                      aria-checked={selected}
                                      onClick={() =>
                                        updateOption(course.id, option.id, (current) => ({
                                          ...current,
                                          allergens: toggleAllergen(current.allergens ?? [], allergen),
                                        }))
                                      }
                                      className={cx(
                                        "min-h-9 rounded-full border px-3 text-xs font-medium transition-colors",
                                        selected
                                          ? "border-danger/40 bg-danger-soft text-danger"
                                          : "border-line-strong bg-surface text-ink-muted hover:border-accent",
                                      )}
                                    >
                                      {selected ? "✓ " : ""}
                                      {allergen}
                                    </button>
                                  );
                                })}
                              </div>
                            </fieldset>
                          </div>

                          <div className="mt-4">
                            <label className="flex min-h-11 w-fit items-center gap-3 rounded-control border border-line bg-surface px-3 text-sm font-medium text-ink">
                              <input
                                type="checkbox"
                                className="size-4 accent-[var(--primary)]"
                                checked={Boolean(option.vegan)}
                                onChange={(event) =>
                                  updateOption(course.id, option.id, (current) => ({
                                    ...current,
                                    vegan: event.target.checked,
                                  }))
                                }
                              />
                              This dish is vegan
                              {option.vegan ? <VeganBadge compact /> : null}
                            </label>
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

                          {/* Only promotions are priced; dinner is part of the stay. */}
                          {isPromo ? (
                            <PromoPricing
                              option={option}
                              currency={currency}
                              onChange={(patch) =>
                                updateOption(course.id, option.id, (current) => ({ ...current, ...patch }))
                              }
                            />
                          ) : null}

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
                              {isPromo ? "Remove product" : "Remove option"}
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
