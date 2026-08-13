"use client";

import { useEffect, useMemo, useState } from "react";

const defaultLanguage = "en";
const supportedLanguages = ["en", "fr", "bg", "de", "ru", "pl", "ro"];

const normalizeLanguageList = (items: string[]) => {
  const cleaned = items
    .map((lang) => lang.trim().toLowerCase())
    .filter(Boolean)
    .filter((lang, index, arr) => arr.indexOf(lang) === index);

  const ordered = [...supportedLanguages, ...cleaned.filter((lang) => !supportedLanguages.includes(lang))];
  const unique = ordered.filter((lang, index, arr) => arr.indexOf(lang) === index);
  if (!unique.includes(defaultLanguage)) {
    unique.unshift(defaultLanguage);
  }
  return unique;
};

const ensureLanguageMap = (item: any, fallbackName = "", fallbackDescription = "") => {
  const translations = { ...(item?.translations ?? {}) };
  if (!translations[defaultLanguage]) {
    translations[defaultLanguage] = {};
  }

  if (typeof translations[defaultLanguage].name !== "string") {
    translations[defaultLanguage].name = item?.name ?? fallbackName;
  }

  if (typeof translations[defaultLanguage].description !== "string") {
    translations[defaultLanguage].description = item?.description ?? fallbackDescription;
  }

  return translations;
};

const readLanguageValue = (item: any, language: string, field: "name" | "description") => {
  const translations = item?.translations ?? {};
  if (language === defaultLanguage) {
    return item?.[field] ?? translations[defaultLanguage]?.[field] ?? "";
  }

  const localized = translations[language]?.[field];
  if (typeof localized === "string" && localized.trim().length > 0) {
    return localized;
  }

  const fallback = translations[defaultLanguage]?.[field] ?? item?.[field] ?? "";
  return fallback;
};

const readImageValue = (item: any) => item?.imageUrl ?? "";

export default function AdminMenuPage() {
  const [language, setLanguage] = useState(defaultLanguage);
  const [courses, setCourses] = useState<any[]>([]);
  const [languages, setLanguages] = useState<string[]>(supportedLanguages);
  const [newLanguage, setNewLanguage] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const previewImage = "https://hips.hearstapps.com/hmg-prod/images/c33b2259-8c6b-4308-bc6f-5373d8a6600d.jpeg";

  const availableLanguages = useMemo(() => {
    const discovered = courses.flatMap((course) => [
      ...Object.keys(course?.translations ?? {}),
      ...(course?.options ?? []).flatMap((option: any) => Object.keys(option?.translations ?? {})),
    ]);

    return normalizeLanguageList([...languages, ...discovered]);
  }, [courses, languages]);

  useEffect(() => {
    const loadMenu = async () => {
      try {
        const response = await fetch("/api/admin/menu", { method: "GET" });
        if (!response.ok) {
          throw new Error("Unauthorized");
        }
        const data = await response.json();
        const nextCourses = Array.isArray(data) ? data : [];
        setCourses(nextCourses);
        setLanguages(
          normalizeLanguageList([
            ...supportedLanguages,
            ...nextCourses.flatMap((course) => [
              ...Object.keys(course?.translations ?? {}),
              ...(course?.options ?? []).flatMap((option: any) => Object.keys(option?.translations ?? {})),
            ]),
          ]),
        );
      } catch {
        setError("Unable to load menu editor.");
      } finally {
        setLoading(false);
      }
    };

    loadMenu();
  }, []);

  useEffect(() => {
    if (!availableLanguages.includes(language)) {
      setLanguage(defaultLanguage);
    }
  }, [availableLanguages, language]);

  const updateCourse = (courseId: string, field: string, value: string | boolean | number) => {
    setCourses((current) => current.map((course) => (course.id === courseId ? { ...course, [field]: value } : course)));
  };

  const updateCourseTranslation = (courseId: string, translatedLanguage: string, field: "name" | "description", value: string) => {
    setCourses((current) =>
      current.map((course) => {
        if (course.id !== courseId) {
          return course;
        }

        const nextTranslations = ensureLanguageMap(course, course?.name ?? "", course?.description ?? "");
        nextTranslations[translatedLanguage] = {
          ...(nextTranslations[translatedLanguage] ?? {}),
          [field]: value,
        };

        const nextCourse = { ...course, translations: nextTranslations };
        if (translatedLanguage === defaultLanguage) {
          nextCourse[field] = value;
        }

        return nextCourse;
      }),
    );
  };

  const updateOption = (courseId: string, optionId: string, field: string, value: string | boolean | string[]) => {
    setCourses((current) =>
      current.map((course) =>
        course.id === courseId
          ? {
              ...course,
              options: course.options.map((option: any) =>
                option.id === optionId ? { ...option, [field]: value } : option,
              ),
            }
          : course,
      ),
    );
  };

  const updateOptionTranslation = (courseId: string, optionId: string, translatedLanguage: string, field: "name" | "description", value: string) => {
    setCourses((current) =>
      current.map((course) => {
        if (course.id !== courseId) {
          return course;
        }

        return {
          ...course,
          options: course.options.map((option: any) => {
            if (option.id !== optionId) {
              return option;
            }

            const nextTranslations = ensureLanguageMap(option, option?.name ?? "", option?.description ?? "");
            nextTranslations[translatedLanguage] = {
              ...(nextTranslations[translatedLanguage] ?? {}),
              [field]: value,
            };

            const nextOption = { ...option, translations: nextTranslations };
            if (translatedLanguage === defaultLanguage) {
              nextOption[field] = value;
            }

            return nextOption;
          }),
        };
      }),
    );
  };

  const addLanguage = () => {
    const candidate = newLanguage.trim().toLowerCase();
    if (!candidate || !/^[a-z]{2,}$/.test(candidate)) {
      setError("Use a language code like en, fr, es, ar.");
      return;
    }

    setLanguages((current) => normalizeLanguageList([...current, candidate]));
    setLanguage(candidate);
    setNewLanguage("");
    setError("");
  };

  const addCourse = () => {
    setCourses((current) => [
      ...current,
      {
        id: `draft-course-${Date.now()}`,
        order: current.length + 1,
        name: "New Course",
        description: "",
        required: true,
        active: true,
        imageUrl: "",
        translations: { en: { name: "New Course", description: "" } },
        options: [],
      },
    ]);
  };

  const addOption = (courseId: string) => {
    setCourses((current) =>
      current.map((course) =>
        course.id === courseId
          ? {
              ...course,
              options: [
                ...(course.options ?? []),
                {
                  id: `draft-option-${Date.now()}-${Math.random().toString(16).slice(2)}`,
                  name: "New Option",
                  description: "",
                  allergens: [],
                  active: true,
                  imageUrl: "",
                  translations: { en: { name: "New Option", description: "" } },
                },
              ],
            }
          : course,
      ),
    );
  };

  const handleImageUpload = async (target: "course" | "option", courseId: string, optionId?: string, file?: File | null) => {
    if (!file) {
      return;
    }

    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result ?? ""));
      reader.onerror = () => reject(new Error("Could not read image."));
      reader.readAsDataURL(file);
    });

    if (target === "course") {
      updateCourse(courseId, "imageUrl", dataUrl);
      return;
    }

    if (optionId) {
      updateOption(courseId, optionId, "imageUrl", dataUrl);
    }
  };

  const normalizeMenuForSave = (course: any) => {
    const normalizedCourse = {
      ...course,
      translations: ensureLanguageMap(course, course?.name ?? "", course?.description ?? ""),
    };

    normalizedCourse.name = normalizedCourse.translations[defaultLanguage]?.name ?? course.name ?? "";
    normalizedCourse.description = normalizedCourse.translations[defaultLanguage]?.description ?? course.description ?? "";

    normalizedCourse.options = (course.options ?? []).map((option: any) => {
      const normalizedOption = {
        ...option,
        translations: ensureLanguageMap(option, option?.name ?? "", option?.description ?? ""),
      };

      normalizedOption.name = normalizedOption.translations[defaultLanguage]?.name ?? option.name ?? "";
      normalizedOption.description = normalizedOption.translations[defaultLanguage]?.description ?? option.description ?? "";
      return normalizedOption;
    });

    return normalizedCourse;
  };

  const handleSave = async () => {
    setSaving(true);
    setError("");

    try {
      const response = await fetch("/api/admin/menu", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ courses: courses.map(normalizeMenuForSave) }),
      });

      if (!response.ok) {
        throw new Error("Unable to save menu.");
      }

      const data = await response.json();
      setCourses(Array.isArray(data?.menu) ? data.menu : courses);
    } catch {
      setError("Unable to save menu changes.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <main className="min-h-screen bg-[#f7f3ee] p-4 text-[#1d1b1a]">Loading menu editor…</main>;
  }

  return (
    <main className="min-h-screen bg-[#f7f3ee] p-4 text-[#1d1b1a]">
      <div className="mx-auto max-w-6xl py-8">
        <div className="mb-6 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.22em] text-[#8e6b49]">ADMIN PANEL</p>
            <h1 className="mt-2 text-3xl font-semibold">Menu Editor</h1>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2 rounded-xl border border-[#d5c4ad] bg-white px-3 py-2">
              <label className="text-sm font-medium text-[#5f5148]">Language</label>
              <select value={language} onChange={(event) => setLanguage(event.target.value)} className="bg-transparent outline-none">
                {supportedLanguages.map((lang) => (
                  <option key={lang} value={lang}>{lang === "en" ? "English" : lang === "fr" ? "Français" : lang === "bg" ? "Български" : lang === "de" ? "Deutsch" : lang === "ru" ? "Русский" : lang === "pl" ? "Polski" : lang === "ro" ? "Română" : lang.toUpperCase()}</option>
                ))}
                {availableLanguages.filter((lang) => !supportedLanguages.includes(lang)).map((lang) => (
                  <option key={lang} value={lang}>{lang.toUpperCase()}</option>
                ))}
              </select>
            </div>
            <div className="flex items-center gap-2 rounded-xl border border-[#d5c4ad] bg-white px-2 py-2">
              <input value={newLanguage} onChange={(event) => setNewLanguage(event.target.value)} placeholder="es" className="w-20 bg-transparent px-2 py-1 outline-none" />
              <button type="button" onClick={addLanguage} className="rounded-lg bg-[#f5ebde] px-3 py-2 text-sm font-medium text-[#6e4d2e]">Add language</button>
            </div>
            <button type="button" onClick={handleSave} disabled={saving} className="rounded-2xl bg-[#1d1b1a] px-5 py-3 text-white font-semibold disabled:opacity-70">
              {saving ? "Saving..." : "Save menu"}
            </button>
          </div>
        </div>

        {error ? <p className="mb-4 rounded-2xl border border-[#f1d5d1] bg-[#fef3f0] p-3 text-sm text-[#a63a2d]">{error}</p> : null}

        <div className="space-y-5">
          {courses.map((course) => (
            <div key={course.id} className="rounded-[28px] border border-[#e7d8c6] bg-white p-5 shadow-[0_18px_55px_rgba(49,31,13,0.08)]">
              <div className="grid gap-4 md:grid-cols-2">
                <label className="text-sm font-medium text-[#413a35]">
                  Order
                  <input type="number" min={1} value={course.order ?? 1} onChange={(event) => updateCourse(course.id, "order", Number(event.target.value))} className="mt-2 w-full rounded-2xl border border-[#d5c4ad] bg-[#fffdfb] px-4 py-3 outline-none" />
                </label>
                <div className="flex items-center gap-4 pt-8">
                  <label className="flex items-center gap-2 text-sm font-medium text-[#413a35]">
                    <input type="checkbox" checked={Boolean(course.required)} onChange={(event) => updateCourse(course.id, "required", event.target.checked)} />
                    Required
                  </label>
                  <label className="flex items-center gap-2 text-sm font-medium text-[#413a35]">
                    <input type="checkbox" checked={Boolean(course.active)} onChange={(event) => updateCourse(course.id, "active", event.target.checked)} />
                    Active
                  </label>
                </div>
              </div>

              <div className="mt-5 space-y-4">
                {availableLanguages.map((lang) => (
                  <div key={`${course.id}-${lang}`} className="rounded-2xl border border-[#f0e6db] bg-[#fffdfb] p-4">
                    <div className="mb-3 text-xs font-semibold uppercase tracking-[0.2em] text-[#8e6b49]">{lang}</div>
                    <div className="grid gap-4 md:grid-cols-2">
                      <label className="text-sm font-medium text-[#413a35]">
                        {lang.toUpperCase()} name
                        <input
                          value={readLanguageValue(course, lang, "name")}
                          onChange={(event) => updateCourseTranslation(course.id, lang, "name", event.target.value)}
                          className="mt-2 w-full rounded-2xl border border-[#d5c4ad] bg-[#fffdfb] px-4 py-3 outline-none"
                        />
                      </label>
                      <label className="text-sm font-medium text-[#413a35]">
                        {lang.toUpperCase()} description
                        <textarea
                          value={readLanguageValue(course, lang, "description")}
                          onChange={(event) => updateCourseTranslation(course.id, lang, "description", event.target.value)}
                          className="mt-2 min-h-20 w-full rounded-2xl border border-[#d5c4ad] bg-[#fffdfb] px-4 py-3 outline-none"
                        />
                      </label>
                    </div>
                  </div>
                ))}
              </div>

              <div className="mt-5 grid gap-4 md:grid-cols-2">
                <label className="text-sm font-medium text-[#413a35]">
                  Image URL
                  <input value={readImageValue(course)} onChange={(event) => updateCourse(course.id, "imageUrl", event.target.value)} className="mt-2 w-full rounded-2xl border border-[#d5c4ad] bg-[#fffdfb] px-4 py-3 outline-none" />
                </label>
                <label className="text-sm font-medium text-[#413a35]">
                  Upload image
                  <input type="file" accept="image/*" onChange={(event) => handleImageUpload("course", course.id, undefined, event.target.files?.[0])} className="mt-2 block w-full rounded-2xl border border-[#d5c4ad] bg-[#fffdfb] px-4 py-3 outline-none" />
                </label>
              </div>

              <div className="mt-4 flex items-center justify-center overflow-hidden rounded-2xl border border-[#e7d8c6] bg-[#f9f3ec]">
                <img src={course.imageUrl || previewImage} alt={course.name} className="h-32 w-full object-cover" />
              </div>

              <div className="mt-5">
                <div className="mb-3 flex items-center justify-between">
                  <h2 className="text-lg font-semibold">Options</h2>
                  <button type="button" onClick={() => addOption(course.id)} className="rounded-xl border border-[#d7c8b6] bg-white px-3 py-2 text-sm font-medium">Add option</button>
                </div>

                <div className="space-y-4">
                  {(course.options ?? []).map((option: any) => (
                    <div key={option.id} className="rounded-2xl border border-[#f0e6db] bg-[#fffdfb] p-4">
                      <div className="space-y-4">
                        {availableLanguages.map((lang) => (
                          <div key={`${course.id}-${option.id}-${lang}`} className="rounded-xl border border-[#f4eadf] bg-white p-3">
                            <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-[#8e6b49]">{lang}</div>
                            <div className="grid gap-4 md:grid-cols-2">
                              <label className="text-sm font-medium text-[#413a35]">
                                {lang.toUpperCase()} name
                                <input
                                  value={readLanguageValue(option, lang, "name")}
                                  onChange={(event) => updateOptionTranslation(course.id, option.id, lang, "name", event.target.value)}
                                  className="mt-2 w-full rounded-2xl border border-[#d5c4ad] bg-[#fffdfb] px-4 py-3 outline-none"
                                />
                              </label>
                              <label className="text-sm font-medium text-[#413a35]">
                                {lang.toUpperCase()} description
                                <textarea
                                  value={readLanguageValue(option, lang, "description")}
                                  onChange={(event) => updateOptionTranslation(course.id, option.id, lang, "description", event.target.value)}
                                  className="mt-2 min-h-20 w-full rounded-2xl border border-[#d5c4ad] bg-[#fffdfb] px-4 py-3 outline-none"
                                />
                              </label>
                            </div>
                          </div>
                        ))}
                      </div>

                      <div className="mt-4 grid gap-4 md:grid-cols-2">
                        <label className="text-sm font-medium text-[#413a35]">
                          Image URL
                          <input value={readImageValue(option) ?? ""} onChange={(event) => updateOption(course.id, option.id, "imageUrl", event.target.value)} className="mt-2 w-full rounded-2xl border border-[#d5c4ad] bg-[#fffdfb] px-4 py-3 outline-none" />
                        </label>
                        <label className="text-sm font-medium text-[#413a35]">
                          Upload image
                          <input type="file" accept="image/*" onChange={(event) => handleImageUpload("option", course.id, option.id, event.target.files?.[0])} className="mt-2 block w-full rounded-2xl border border-[#d5c4ad] bg-[#fffdfb] px-4 py-3 outline-none" />
                        </label>
                        <label className="text-sm font-medium text-[#413a35] md:col-span-2">
                          Allergens
                          <input value={(option.allergens ?? []).join(", ")} onChange={(event) => updateOption(course.id, option.id, "allergens", event.target.value.split(",").map((item) => item.trim()).filter(Boolean))} className="mt-2 w-full rounded-2xl border border-[#d5c4ad] bg-[#fffdfb] px-4 py-3 outline-none" />
                        </label>
                      </div>

                      <div className="mt-3 flex items-center gap-4">
                        <label className="flex items-center gap-2 text-sm font-medium text-[#413a35]">
                          <input type="checkbox" checked={Boolean(option.active)} onChange={(event) => updateOption(course.id, option.id, "active", event.target.checked)} />
                          Active
                        </label>
                      </div>

                      <div className="mt-4 flex items-center justify-center overflow-hidden rounded-2xl border border-[#e7d8c6] bg-[#f9f3ec]">
                        <img src={option.imageUrl || previewImage} alt={option.name} className="h-24 w-full object-cover" />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-6 flex justify-end">
          <button type="button" onClick={addCourse} className="rounded-2xl border border-[#d7c8b6] bg-white px-5 py-3 font-semibold">Add course</button>
        </div>
      </div>
    </main>
  );
}
