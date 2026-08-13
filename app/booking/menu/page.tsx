"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { readStoredGuestCount } from "@/lib/booking-session";
import type { MenuCourse, MenuOption, ReservationSelection } from "@/types/booking";

function normalizeSelections(value: unknown): ReservationSelection[] {
  if (Array.isArray(value)) {
    return value as ReservationSelection[];
  }

  if (!value || typeof value !== "object") {
    return [];
  }

  const legacyEntries = Object.values(value as Record<string, Record<string, unknown>>);
  return legacyEntries.map((entry) => ({
    guestIndex: Number((entry as { guestIndex?: number }).guestIndex ?? 0),
    courseId: String((entry as { courseId?: string }).courseId ?? ""),
    courseName: String((entry as { courseName?: string }).courseName ?? ""),
    optionId: String((entry as { optionId?: string }).optionId ?? ""),
    optionName: String((entry as { optionName?: string }).optionName ?? ""),
  }));
}

const defaultLanguage = "en";

export default function MenuPage() {
  const router = useRouter();
  const [courses, setCourses] = useState<MenuCourse[]>([]);
  const [language, setLanguage] = useState(defaultLanguage);
  const [guestCount, setGuestCount] = useState<number>(1);
  const [activeGuestIndex, setActiveGuestIndex] = useState<number>(0);
  const [selected, setSelected] = useState<ReservationSelection[]>([]);
  const [error, setError] = useState("");
  const previewImage = "https://hips.hearstapps.com/hmg-prod/images/c33b2259-8c6b-4308-bc6f-5373d8a6600d.jpeg";

  const availableLanguages = useMemo(() => {
    const discovered = new Set<string>([defaultLanguage]);
    for (const course of courses) {
      Object.keys(course.translations ?? {}).forEach((lang) => discovered.add(lang.toLowerCase()));
      course.options.forEach((option) => Object.keys(option.translations ?? {}).forEach((lang) => discovered.add(lang.toLowerCase())));
    }
    return Array.from(discovered).sort((a, b) => (a === defaultLanguage ? -1 : b === defaultLanguage ? 1 : a.localeCompare(b)));
  }, [courses]);

  useEffect(() => {
    if (typeof window !== "undefined") {
      const nextGuestCount = readStoredGuestCount(window.sessionStorage);
      setGuestCount(nextGuestCount);
      setActiveGuestIndex((previous) => Math.min(previous, Math.max(nextGuestCount - 1, 0)));

      try {
        const savedEntries = window.sessionStorage.getItem("booking-selections");
        setSelected(savedEntries ? normalizeSelections(JSON.parse(savedEntries)) : []);
      } catch {
        setSelected([]);
      }

      const storedLanguage = window.sessionStorage.getItem("booking-language") ?? defaultLanguage;
      setLanguage(storedLanguage);
    }
  }, []);

  useEffect(() => {
    if (typeof window !== "undefined") {
      window.sessionStorage.setItem("booking-language", language);
    }

    fetch(`/api/menu?language=${encodeURIComponent(language)}`)
      .then((response) => response.json())
      .then((data) => setCourses(Array.isArray(data) ? data : []));
  }, [language]);

  useEffect(() => {
    if (typeof window !== "undefined") {
      window.sessionStorage.setItem("booking-selections", JSON.stringify(selected));
    }
  }, [selected]);

  const requiredCourses = useMemo(() => courses.filter((course) => course.required), [courses]);
  const guestIndexes = useMemo(() => Array.from({ length: guestCount }, (_, index) => index), [guestCount]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const stored = window.sessionStorage.getItem("booking-selections");
    if (!stored) {
      return;
    }

    try {
      const parsed = normalizeSelections(JSON.parse(stored));
      const sanitized = parsed.filter((entry) => (entry.guestIndex ?? 0) < guestCount);
      if (sanitized.length !== parsed.length) {
        setSelected(sanitized);
      }
    } catch {
      // Ignore invalid saved selections.
    }
  }, [guestCount]);

  useEffect(() => {
    if (availableLanguages.length > 0 && !availableLanguages.includes(language)) {
      setLanguage(availableLanguages[0]);
    }
  }, [availableLanguages, language]);

  const chooseOption = (guestIndex: number, course: MenuCourse, option: MenuOption) => {
    const nextSelection = {
      guestIndex,
      courseId: course.id,
      courseName: course.name,
      optionId: option.id,
      optionName: option.name,
    };

    setSelected((previous) => [
      ...previous.filter((entry) => !(entry.guestIndex === guestIndex && entry.courseId === course.id)),
      nextSelection,
    ]);
    setError("");
  };

  const canContinue = guestIndexes.every((guestIndex) =>
    requiredCourses.every((course) => selected.some((entry) => entry.guestIndex === guestIndex && entry.courseId === course.id)),
  );

  const handleContinue = () => {
    const missingGuest = guestIndexes.find((guestIndex) =>
      requiredCourses.some((course) => !selected.some((entry) => entry.guestIndex === guestIndex && entry.courseId === course.id)),
    );

    if (missingGuest !== undefined) {
      setError(`Please complete menu choices for guest ${missingGuest + 1}.`);
      return;
    }

    router.push("/booking/summary");
  };

  return (
    <main className="min-h-screen bg-[#f7f3ee] p-4 text-[#1d1b1a]">
      <div className="mx-auto max-w-3xl py-8">
        <div className="mb-6 text-center">
          <p className="text-xs font-medium uppercase tracking-[0.22em] text-[#8e6b49]">À LA CARTE RESTAURANT</p>
          <h2 className="mt-3 text-3xl font-semibold tracking-tight">Choose your menu</h2>
        </div>

        <div className="mb-6 rounded-[28px] border border-[#e7d8c6] bg-white p-4 shadow-[0_18px_55px_rgba(49,31,13,0.08)]">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <p className="text-[10px] font-medium uppercase tracking-[0.2em] text-[#8e6b49]">Guest menu</p>
              <h3 className="mt-1 text-xl font-semibold">Guest {activeGuestIndex + 1} of {guestCount}</h3>
            </div>
            <div className="flex items-center gap-2 rounded-full bg-[#f5ebde] px-3 py-1 text-xs font-medium text-[#6e4d2e]">
              <span>Language</span>
              <select value={language} onChange={(event) => setLanguage(event.target.value)} className="bg-transparent font-medium outline-none">
                {availableLanguages.map((lang) => (
                  <option key={lang} value={lang}>{lang.toUpperCase()}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            {guestIndexes.map((guestIndex) => {
              const guestComplete = requiredCourses.every((course) => selected.some((entry) => entry.guestIndex === guestIndex && entry.courseId === course.id));
              const isActive = activeGuestIndex === guestIndex;

              return (
                <button
                  key={guestIndex}
                  type="button"
                  onClick={() => setActiveGuestIndex(guestIndex)}
                  className={[
                    "rounded-full border px-3 py-2 text-sm font-medium transition",
                    isActive ? "border-[#1d1b1a] bg-[#1d1b1a] text-white" : guestComplete ? "border-[#cfe5d2] bg-[#edf8f0] text-[#286d42]" : "border-[#dbc9b1] bg-[#fffdfb] text-[#1d1b1a] hover:border-[#8e6b49]",
                  ].join(" ")}
                >
                  Guest {guestIndex + 1}
                </button>
              );
            })}
          </div>
        </div>

        <div className="rounded-[28px] border border-[#e7d8c6] bg-white p-5 shadow-[0_18px_55px_rgba(49,31,13,0.08)]">
          <div className="mb-5 flex items-center justify-between gap-3">
            <h3 className="text-xl font-semibold">Editing for Guest {activeGuestIndex + 1}</h3>
            <span className="rounded-full bg-[#f5ebde] px-3 py-1 text-xs font-medium text-[#6e4d2e]">Required</span>
          </div>

          <div className="space-y-5">
            {courses.map((course) => {
              const selection = selected.find((entry) => entry.guestIndex === activeGuestIndex && entry.courseId === course.id);

              return (
                <div key={`${activeGuestIndex}-${course.id}`} className="rounded-2xl border border-[#f0e6db] bg-[#fffdfb] p-4">
                  <div className="mb-4 flex items-start justify-between gap-4">
                    <div>
                      <p className="text-[10px] font-medium uppercase tracking-[0.2em] text-[#8e6b49]">Course {course.order}</p>
                      <h4 className="mt-1 text-xl font-semibold">{course.name}</h4>
                    </div>
                    {course.required ? <span className="rounded-full bg-[#f5ebde] px-2 py-1 text-[10px] font-medium text-[#6e4d2e]">Required</span> : null}
                  </div>
                  <div className="mb-3 overflow-hidden rounded-2xl border border-[#e7d8c6] bg-[#f8f2ea]">
                    <img src={course.imageUrl || previewImage} alt={course.name} className="h-40 w-full object-cover" />
                  </div>
                  <p className="mb-3 text-sm text-[#695d53]">{course.description}</p>

                  <div className="space-y-3">
                    {course.options.map((option) => {
                      const isSelected = selection?.optionId === option.id;
                      return (
                        <button
                          key={`${activeGuestIndex}-${course.id}-${option.id}`}
                          type="button"
                          onClick={() => chooseOption(activeGuestIndex, course, option)}
                          className={[
                            "w-full rounded-2xl border p-4 text-left transition",
                            isSelected ? "border-[#1d1b1a] bg-[#1d1b1a] text-white shadow-sm" : "border-[#dbc9b1] bg-white text-[#1d1b1a] hover:border-[#8e6b49]",
                          ].join(" ")}
                        >
                          <div className="flex items-start gap-3">
                            <img src={option.imageUrl || previewImage} alt={option.name} className="h-20 w-20 rounded-xl object-cover border border-[#e7d8c6]" />
                            <div className="flex-1">
                              <div className="flex items-start justify-between gap-3">
                                <div>
                                  <div className="text-lg font-semibold">{option.name}</div>
                                  <div className={isSelected ? "mt-1 text-sm text-[#f1e6d7]" : "mt-1 text-sm text-[#695d53]"}>{option.description}</div>
                                </div>
                                {option.allergens.length ? (
                                  <div className={isSelected ? "text-xs text-[#f1e6d7]" : "text-xs text-[#7a6455]"}>{option.allergens.join(" • ")}</div>
                                ) : null}
                              </div>
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {error ? <p className="mt-4 rounded-2xl border border-[#f1d5d1] bg-[#fef3f0] p-3 text-sm font-medium text-[#a63a2d]">{error}</p> : null}

        <div className="mt-6 flex gap-3">
          <button type="button" onClick={() => router.back()} className="flex-1 rounded-2xl border border-[#d7c8b6] bg-white px-5 py-4 text-lg font-semibold text-[#1d1b1a]">Back</button>
          <button
            type="button"
            onClick={handleContinue}
            disabled={!canContinue}
            className="flex-1 rounded-2xl bg-[#1d1b1a] px-5 py-4 text-lg font-semibold text-white disabled:cursor-not-allowed disabled:bg-[#c7b8a4]"
          >
            Continue
          </button>
        </div>
      </div>
    </main>
  );
}
