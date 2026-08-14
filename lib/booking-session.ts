import { isValidDateKey } from "@/lib/date";
import { MAX_GUESTS_PER_RESERVATION } from "@/lib/validation/booking";
import type { ReservationRecord, ReservationSelection } from "@/types/booking";

export const BOOKING_STORAGE_KEYS = {
  roomNumber: "booking-room-number",
  guestCount: "booking-guest-count",
  date: "booking-date",
  selections: "booking-selections",
  language: "booking-language",
  confirmation: "reservation-confirmation",
} as const;

export type BookingSession = {
  roomNumber: string;
  /** 0 means "not chosen yet", which is different from a party of one. */
  guestCount: number;
  date: string;
  selections: ReservationSelection[];
  language: string;
};

export const EMPTY_BOOKING_SESSION: BookingSession = {
  roomNumber: "",
  guestCount: 0,
  date: "",
  selections: [],
  language: "en",
};

export function isValidRoomNumber(value: string) {
  return /^\d{1,6}$/.test(value.trim());
}

export function parseGuestCount(raw: string | null | undefined): number {
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > MAX_GUESTS_PER_RESERVATION) {
    return 0;
  }
  return value;
}

/**
 * Accepts both the current array format and the older object-keyed format
 * that earlier builds wrote to sessionStorage, so a guest mid-booking during a
 * deploy does not lose their choices.
 */
export function normalizeSelections(value: unknown): ReservationSelection[] {
  const entries = Array.isArray(value)
    ? value
    : value && typeof value === "object"
      ? Object.values(value as Record<string, unknown>)
      : [];

  return entries
    .filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === "object")
    .map((entry) => ({
      guestIndex: Number.isInteger(Number(entry.guestIndex)) ? Number(entry.guestIndex) : 0,
      courseId: String(entry.courseId ?? ""),
      courseName: String(entry.courseName ?? ""),
      optionId: String(entry.optionId ?? ""),
      optionName: String(entry.optionName ?? ""),
    }))
    .filter((entry) => entry.courseId && entry.optionId);
}

function parseJson(raw: string | null): unknown {
  if (!raw) {
    return null;
  }
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function readBookingSession(storage: Storage | null | undefined): BookingSession {
  if (!storage) {
    return EMPTY_BOOKING_SESSION;
  }

  const roomNumber = storage.getItem(BOOKING_STORAGE_KEYS.roomNumber) ?? "";
  const date = storage.getItem(BOOKING_STORAGE_KEYS.date) ?? "";

  return {
    roomNumber: isValidRoomNumber(roomNumber) ? roomNumber.trim() : "",
    guestCount: parseGuestCount(storage.getItem(BOOKING_STORAGE_KEYS.guestCount)),
    date: isValidDateKey(date) ? date : "",
    selections: normalizeSelections(parseJson(storage.getItem(BOOKING_STORAGE_KEYS.selections))),
    language: storage.getItem(BOOKING_STORAGE_KEYS.language) || "en",
  };
}

export function readStoredConfirmation(storage: Storage | null | undefined): ReservationRecord | null {
  if (!storage) {
    return null;
  }

  const parsed = parseJson(storage.getItem(BOOKING_STORAGE_KEYS.confirmation));
  if (!parsed || typeof parsed !== "object") {
    return null;
  }

  const record = parsed as Partial<ReservationRecord>;
  if (!record.reservationNumber) {
    return null;
  }

  return {
    reservationNumber: String(record.reservationNumber),
    roomNumber: Number(record.roomNumber ?? 0),
    guestCount: Number(record.guestCount ?? 1),
    date: String(record.date ?? ""),
    selections: normalizeSelections(record.selections),
    status: record.status === "cancelled" ? "cancelled" : "confirmed",
    createdAt: record.createdAt,
  };
}

/** Drops choices belonging to guests who are no longer part of the booking. */
export function pruneSelectionsToGuestCount(selections: ReservationSelection[], guestCount: number) {
  return selections.filter((selection) => (selection.guestIndex ?? 0) < guestCount);
}

export type BookingStepRequirement = "room" | "guests" | "date" | "selections";

/** The first prerequisite this session is missing, if any. */
export function findMissingRequirement(
  session: BookingSession,
  requirements: BookingStepRequirement[],
): BookingStepRequirement | null {
  for (const requirement of requirements) {
    if (requirement === "room" && !session.roomNumber) return "room";
    if (requirement === "guests" && session.guestCount < 1) return "guests";
    if (requirement === "date" && !session.date) return "date";
    if (requirement === "selections" && session.selections.length === 0) return "selections";
  }
  return null;
}

export const REQUIREMENT_ROUTES: Record<BookingStepRequirement, string> = {
  room: "/booking",
  guests: "/booking/guests",
  date: "/booking/date",
  selections: "/booking/menu",
};
