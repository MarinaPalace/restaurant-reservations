import { isPastDateKey } from "@/lib/date";
import { isNoneSelection } from "@/lib/menu-selection";
import { isValidRoomNumber, normalizeRoomNumber } from "@/lib/room";
import { MAX_GUESTS_PER_RESERVATION } from "@/lib/validation/booking";
import type { MenuCourse, RestaurantDateAvailability, ReservationSelection } from "@/types/booking";

export type ReservationValidationInput = {
  roomNumber: string;
  /** Other rooms sharing the table, when staff took the booking from a ticket. */
  additionalRooms?: string[];
  guestCount: number;
  date: string;
  selections: ReservationSelection[];
  restaurantDate: RestaurantDateAvailability | null;
  menu: MenuCourse[];
  now?: Date;
};

export type ReservationValidationResult =
  | { ok: true; error: null; selections: ReservationSelection[] }
  | { ok: false; error: string; selections: null };

export const BOOKING_MESSAGES = {
  invalidRoom: "Please enter a valid room number, for example 402 or L10.",
  invalidGuestCount: "Please select a valid guest count.",
  invalidDate: "Please choose a valid dinner date.",
  pastDate: "That evening has already passed. Please choose an upcoming date.",
  unavailable: "Unfortunately, this date is no longer available. Please select another date.",
  fullyBooked: "Unfortunately, this date is fully booked. Please choose another evening.",
  invalidOption: "Invalid menu option selected.",
  repeatedRoom: "Each room may only be listed once on a booking.",
} as const;

export function getRemainingSeats(date: RestaurantDateAvailability | null) {
  if (!date) {
    return 0;
  }
  return Math.max(date.capacity - date.reservedSeats, 0);
}

function invalid(error: string): ReservationValidationResult {
  return { ok: false, error, selections: null };
}

/**
 * Single source of truth for whether a reservation may be created. The API
 * route delegates to this so the rules that are unit-tested are the same rules
 * that run in production.
 */
export function validateReservationRequest(input: ReservationValidationInput): ReservationValidationResult {
  if (!isValidRoomNumber(input.roomNumber)) {
    return invalid(BOOKING_MESSAGES.invalidRoom);
  }

  /**
   * A ticket may name two or three rooms sharing one table. Each still has to
   * be a real room label, and listing the same room twice is a slip of the pen
   * rather than a party — it would put a room on the sheet twice.
   */
  if (input.additionalRooms?.length) {
    const seen = new Set([normalizeRoomNumber(input.roomNumber)]);

    for (const room of input.additionalRooms) {
      if (!isValidRoomNumber(room)) {
        return invalid(BOOKING_MESSAGES.invalidRoom);
      }

      const normalized = normalizeRoomNumber(room);
      if (seen.has(normalized)) {
        return invalid(BOOKING_MESSAGES.repeatedRoom);
      }
      seen.add(normalized);
    }
  }

  if (
    !Number.isInteger(input.guestCount) ||
    input.guestCount < 1 ||
    input.guestCount > MAX_GUESTS_PER_RESERVATION
  ) {
    return invalid(BOOKING_MESSAGES.invalidGuestCount);
  }

  if (isPastDateKey(input.date, input.now)) {
    return invalid(BOOKING_MESSAGES.pastDate);
  }

  if (!input.restaurantDate || !input.restaurantDate.isOpen) {
    return invalid(BOOKING_MESSAGES.unavailable);
  }

  if (getRemainingSeats(input.restaurantDate) < input.guestCount) {
    return invalid(BOOKING_MESSAGES.fullyBooked);
  }

  const activeOptionsByCourse = new Map(
    input.menu.map((course) => [
      course.id,
      new Set(course.options.filter((option) => option.active).map((option) => option.id)),
    ]),
  );

  /**
   * Older clients sent one flat list with no guestIndex. For a single-guest
   * booking that is unambiguous, so it is normalised to guest 0 rather than
   * rejected.
   */
  const normalizedSelections: ReservationSelection[] = input.selections.map((selection) => ({
    ...selection,
    guestIndex: selection.guestIndex ?? 0,
  }));

  if (normalizedSelections.some((selection) => (selection.guestIndex ?? 0) >= input.guestCount)) {
    return invalid(BOOKING_MESSAGES.invalidGuestCount);
  }

  const requiredCourses = input.menu.filter((course) => course.required && course.active);

  for (const selection of normalizedSelections) {
    const activeOptions = activeOptionsByCourse.get(selection.courseId);
    if (!activeOptions) {
      return invalid(BOOKING_MESSAGES.invalidOption);
    }

    // Declining a course is always allowed, so "None" needs no menu entry.
    if (isNoneSelection(selection)) {
      continue;
    }

    if (!activeOptions.has(selection.optionId)) {
      return invalid(BOOKING_MESSAGES.invalidOption);
    }
  }

  for (let guestIndex = 0; guestIndex < input.guestCount; guestIndex += 1) {
    const guestSelections = normalizedSelections.filter((selection) => selection.guestIndex === guestIndex);

    for (const course of requiredCourses) {
      const chosen = guestSelections.filter((selection) => selection.courseId === course.id);

      if (chosen.length === 0) {
        return invalid(`Please choose an option for ${course.name}.`);
      }

      // Guard against a client sending two choices for the same course.
      if (chosen.length > 1) {
        return invalid(`Please choose only one option for ${course.name}.`);
      }
    }
  }

  return { ok: true, error: null, selections: normalizedSelections };
}

export function applyDateAdjustment(
  date: RestaurantDateAvailability,
  guestCount: number,
  mode: "reserve" | "cancel",
) {
  const adjustment = mode === "reserve" ? guestCount : -guestCount;
  return {
    ...date,
    reservedSeats: Math.max(date.reservedSeats + adjustment, 0),
  };
}
