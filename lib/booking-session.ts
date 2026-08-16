import { isValidDateKey } from "@/lib/date";
import { isValidPassKeyFormat, normalizePassKey } from "@/lib/pass-key";
import { isValidRoomNumber, normalizeRoomNumber } from "@/lib/room";
import { MAX_GUESTS_PER_RESERVATION } from "@/lib/validation/booking";
import type { ReservationRecord, ReservationSelection } from "@/types/booking";

export const BOOKING_STORAGE_KEYS = {
  passKey: "booking-pass-key",
  passKeyExpiresOn: "booking-pass-key-expires",
  passKeyBookedDates: "booking-pass-key-booked-dates",
  passKeyMaxGuests: "booking-pass-key-max-guests",
  roomNumber: "booking-room-number",
  guestCount: "booking-guest-count",
  date: "booking-date",
  selections: "booking-selections",
  language: "booking-language",
  confirmation: "reservation-confirmation",
} as const;

export type BookingSession = {
  /**
   * The key from reception, in canonical form. Held for the length of the
   * booking because the final POST has to present it — it is what proves the
   * person is a guest here.
   */
  passKey: string;
  /**
   * When the key stops working — check-out, normally. Held so the date step
   * can grey out evenings after the stay and say why, rather than letting the
   * guest pick one and be refused at the end.
   */
  passKeyExpiresOn: string;
  /**
   * Evenings this key already has a live booking on. Held so the date step can
   * say so before the guest books a second table by mistake — which is what
   * usually happens when somebody means to change an existing booking.
   */
  passKeyBookedDates: string[];
  /**
   * How many people the hotel booking is for. The guests step offers no more
   * than this, and the server refuses more regardless. 0 means the key carries
   * no limit, which is how every key issued before this reads.
   */
  passKeyMaxGuests: number;
  roomNumber: string;
  /** 0 means "not chosen yet", which is different from a party of one. */
  guestCount: number;
  date: string;
  selections: ReservationSelection[];
  language: string;
};

export const EMPTY_BOOKING_SESSION: BookingSession = {
  passKey: "",
  passKeyExpiresOn: "",
  passKeyBookedDates: [],
  passKeyMaxGuests: 0,
  roomNumber: "",
  guestCount: 0,
  date: "",
  selections: [],
  language: "en",
};

export { isValidRoomNumber } from "@/lib/room";
export { isValidPassKeyFormat } from "@/lib/pass-key";

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
  const passKey = storage.getItem(BOOKING_STORAGE_KEYS.passKey) ?? "";

  const passKeyExpiresOn = storage.getItem(BOOKING_STORAGE_KEYS.passKeyExpiresOn) ?? "";
  const bookedDates = parseJson(storage.getItem(BOOKING_STORAGE_KEYS.passKeyBookedDates));

  const maxGuests = Number(storage.getItem(BOOKING_STORAGE_KEYS.passKeyMaxGuests));

  return {
    passKeyBookedDates: Array.isArray(bookedDates) ? bookedDates.filter(isValidDateKey) : [],
    passKeyMaxGuests:
      Number.isInteger(maxGuests) && maxGuests > 0 && maxGuests <= MAX_GUESTS_PER_RESERVATION
        ? maxGuests
        : 0,
    passKey: isValidPassKeyFormat(passKey) ? normalizePassKey(passKey) : "",
    passKeyExpiresOn: isValidDateKey(passKeyExpiresOn) ? passKeyExpiresOn : "",
    roomNumber: isValidRoomNumber(roomNumber) ? normalizeRoomNumber(roomNumber) : "",
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

  /**
   * Spread first, then normalise. Whitelisting each field meant anything added
   * later was silently dropped — which is how the arrival time went missing
   * and calendar reminders fell back to the default sitting.
   */
  return {
    ...record,
    reservationNumber: String(record.reservationNumber),
    roomNumber: String(record.roomNumber ?? ""),
    guestCount: Number(record.guestCount ?? 1),
    date: String(record.date ?? ""),
    selections: normalizeSelections(record.selections),
    status: record.status === "cancelled" ? "cancelled" : "confirmed",
  };
}

/** Drops choices belonging to guests who are no longer part of the booking. */
export function pruneSelectionsToGuestCount(selections: ReservationSelection[], guestCount: number) {
  return selections.filter((selection) => (selection.guestIndex ?? 0) < guestCount);
}

/**
 * The largest party this session may book for.
 *
 * The pass-key carries the party size from the hotel booking; the guest may
 * come with fewer but never more. A key with nothing recorded — every key
 * issued before that was captured — is bound only by the restaurant's own
 * maximum.
 */
export function allowedGuestCount(session: Pick<BookingSession, "passKeyMaxGuests">): number {
  const limit = session.passKeyMaxGuests;

  return limit > 0 ? Math.min(limit, MAX_GUESTS_PER_RESERVATION) : MAX_GUESTS_PER_RESERVATION;
}

export type BookingStepRequirement = "room" | "guests" | "date" | "selections";

/** The first prerequisite this session is missing, if any. */
export function findMissingRequirement(
  session: BookingSession,
  requirements: BookingStepRequirement[],
): BookingStepRequirement | null {
  for (const requirement of requirements) {
    // The key and the room are entered on the same step, and the booking is
    // refused without both, so either one missing sends the guest back.
    if (requirement === "room" && (!session.roomNumber || !session.passKey)) return "room";
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
