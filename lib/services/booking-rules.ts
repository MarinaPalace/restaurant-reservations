import type { MenuCourse, RestaurantDateAvailability, ReservationSelection } from "@/types/booking";

export type ReservationValidationInput = {
  roomNumber: number;
  guestCount: number;
  date: string;
  selections: ReservationSelection[];
  restaurantDate: RestaurantDateAvailability | null;
  menu: MenuCourse[];
};

export function getRemainingSeats(date: RestaurantDateAvailability | null) {
  if (!date) {
    return 0;
  }

  return Math.max(date.capacity - date.reservedSeats, 0);
}

export function validateReservationRequest(input: ReservationValidationInput) {
  if (!Number.isInteger(input.roomNumber) || input.roomNumber <= 0) {
    return { ok: false, error: "Please enter a valid room number." };
  }

  if (!Number.isInteger(input.guestCount) || input.guestCount < 1 || input.guestCount > 6) {
    return { ok: false, error: "Please select a valid guest count." };
  }

  if (!input.date || !/^\d{4}-\d{2}-\d{2}$/.test(input.date)) {
    return { ok: false, error: "Please choose a valid dinner date." };
  }

  if (!input.restaurantDate) {
    return { ok: false, error: "Unfortunately, this date is no longer available. Please select another date." };
  }

  if (!input.restaurantDate.isOpen) {
    return { ok: false, error: "Unfortunately, this date is no longer available. Please select another date." };
  }

  const remainingSeats = getRemainingSeats(input.restaurantDate);
  if (remainingSeats <= 0 || remainingSeats < input.guestCount) {
    return { ok: false, error: "Unfortunately, this date is fully booked. Please choose another evening." };
  }

  const validOptions = new Map<string, Set<string>>();
  for (const course of input.menu) {
    const optionIds = new Set(course.options.filter((option) => option.active).map((option) => option.id));
    validOptions.set(course.id, optionIds);
  }

  const requiredCourses = input.menu.filter((course) => course.required);
  const hasGuestAssignment = input.selections.some((selection) => selection.guestIndex !== undefined);

  if (!hasGuestAssignment) {
    const selectedByCourse = new Map<string, ReservationSelection>();

    for (const selection of input.selections) {
      const course = input.menu.find((item) => item.id === selection.courseId);
      if (!course) {
        return { ok: false, error: "Invalid menu option selected." };
      }

      const validIds = validOptions.get(course.id);
      if (!validIds || !validIds.has(selection.optionId)) {
        return { ok: false, error: "Invalid menu option selected." };
      }

      selectedByCourse.set(course.id, selection);
    }

    const missingCourse = requiredCourses.find((course) => !selectedByCourse.has(course.id));
    if (missingCourse) {
      return { ok: false, error: `Please choose an option for ${missingCourse.name}.` };
    }

    return { ok: true, error: null };
  }

  for (let guestIndex = 0; guestIndex < input.guestCount; guestIndex += 1) {
    const guestSelections = input.selections.filter((selection) => (selection.guestIndex ?? 0) === guestIndex);

    for (const course of requiredCourses) {
      const selected = guestSelections.find((selection) => selection.courseId === course.id);
      if (!selected) {
        return { ok: false, error: `Please choose an option for ${course.name}.` };
      }

      const validIds = validOptions.get(course.id);
      if (!validIds || !validIds.has(selected.optionId)) {
        return { ok: false, error: "Invalid menu option selected." };
      }
    }
  }

  return { ok: true, error: null };
}

export function applyDateAdjustment(date: RestaurantDateAvailability, guestCount: number, mode: "reserve" | "cancel") {
  const adjustment = mode === "reserve" ? guestCount : -guestCount;
  return {
    ...date,
    reservedSeats: Math.max(date.reservedSeats + adjustment, 0),
  };
}
