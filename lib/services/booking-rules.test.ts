import { describe, expect, it } from "vitest";
import { validateReservationRequest } from "@/lib/services/booking-rules";

const menu = [
  {
    id: "course-1",
    order: 1,
    name: "Amuse Bouche",
    description: "",
    required: true,
    active: true,
    options: [{ id: "opt-1", courseId: "course-1", name: "Chef's Selection", description: "", allergens: [], active: true }],
  },
  {
    id: "course-2",
    order: 2,
    name: "Starter",
    description: "",
    required: true,
    active: true,
    options: [
      { id: "opt-2", courseId: "course-2", name: "Option A", description: "", allergens: [], active: true },
      { id: "opt-3", courseId: "course-2", name: "Option B", description: "", allergens: [], active: true },
    ],
  },
  {
    id: "course-3",
    order: 3,
    name: "Soup",
    description: "",
    required: true,
    active: true,
    options: [
      { id: "opt-4", courseId: "course-3", name: "Soup A", description: "", allergens: [], active: true },
      { id: "opt-5", courseId: "course-3", name: "Soup B", description: "", allergens: [], active: true },
    ],
  },
  {
    id: "course-4",
    order: 4,
    name: "Main Course",
    description: "",
    required: true,
    active: true,
    options: [
      { id: "opt-6", courseId: "course-4", name: "Main A", description: "", allergens: [], active: true },
      { id: "opt-7", courseId: "course-4", name: "Main B", description: "", allergens: [], active: true },
    ],
  },
  {
    id: "course-5",
    order: 5,
    name: "Dessert",
    description: "",
    required: true,
    active: true,
    options: [
      { id: "opt-8", courseId: "course-5", name: "Dessert A", description: "", allergens: [], active: true },
      { id: "opt-9", courseId: "course-5", name: "Dessert B", description: "", allergens: [], active: true },
    ],
  },
  {
    id: "course-6",
    order: 6,
    name: "Petit Four",
    description: "",
    required: true,
    active: true,
    options: [{ id: "opt-10", courseId: "course-6", name: "Chef's Selection", description: "", allergens: [], active: true }],
  },
];

const validSelections = [
  { guestIndex: 0, courseId: "course-1", courseName: "Amuse Bouche", optionId: "opt-1", optionName: "Chef's Selection" },
  { guestIndex: 0, courseId: "course-2", courseName: "Starter", optionId: "opt-2", optionName: "Option A" },
  { guestIndex: 0, courseId: "course-3", courseName: "Soup", optionId: "opt-4", optionName: "Soup A" },
  { guestIndex: 0, courseId: "course-4", courseName: "Main Course", optionId: "opt-6", optionName: "Main A" },
  { guestIndex: 0, courseId: "course-5", courseName: "Dessert", optionId: "opt-8", optionName: "Dessert A" },
  { guestIndex: 0, courseId: "course-6", courseName: "Petit Four", optionId: "opt-10", optionName: "Chef's Selection" },
  { guestIndex: 1, courseId: "course-1", courseName: "Amuse Bouche", optionId: "opt-1", optionName: "Chef's Selection" },
  { guestIndex: 1, courseId: "course-2", courseName: "Starter", optionId: "opt-3", optionName: "Option B" },
  { guestIndex: 1, courseId: "course-3", courseName: "Soup", optionId: "opt-5", optionName: "Soup B" },
  { guestIndex: 1, courseId: "course-4", courseName: "Main Course", optionId: "opt-7", optionName: "Main B" },
  { guestIndex: 1, courseId: "course-5", courseName: "Dessert", optionId: "opt-9", optionName: "Dessert B" },
  { guestIndex: 1, courseId: "course-6", courseName: "Petit Four", optionId: "opt-10", optionName: "Chef's Selection" },
];

describe("reservation validation", () => {
  it("allows a valid reservation", () => {
    const result = validateReservationRequest({
      roomNumber: 1234,
      guestCount: 2,
      date: "2026-08-18",
      selections: validSelections,
      restaurantDate: { date: "2026-08-18", isOpen: true, capacity: 40, reservedSeats: 10, remainingSeats: 30 },
      menu,
    });

    expect(result.ok).toBe(true);
  });

  it("rejects missing required menu selections", () => {
    const result = validateReservationRequest({
      roomNumber: 1234,
      guestCount: 2,
      date: "2026-08-18",
      selections: validSelections.slice(0, 5),
      restaurantDate: { date: "2026-08-18", isOpen: true, capacity: 40, reservedSeats: 10, remainingSeats: 30 },
      menu,
    });

    expect(result.ok).toBe(false);
    expect(result.error).toContain("Please choose an option");
  });

  it("rejects a closed date", () => {
    const result = validateReservationRequest({
      roomNumber: 1234,
      guestCount: 2,
      date: "2026-08-20",
      selections: validSelections,
      restaurantDate: { date: "2026-08-20", isOpen: false, capacity: 40, reservedSeats: 0, remainingSeats: 40 },
      menu,
    });

    expect(result.ok).toBe(false);
    expect(result.error).toContain("no longer available");
  });

  it("rejects a fully booked date", () => {
    const result = validateReservationRequest({
      roomNumber: 1234,
      guestCount: 2,
      date: "2026-08-22",
      selections: validSelections,
      restaurantDate: { date: "2026-08-22", isOpen: true, capacity: 40, reservedSeats: 40, remainingSeats: 0 },
      menu,
    });

    expect(result.ok).toBe(false);
    expect(result.error).toContain("fully booked");
  });

  it("rejects guest count above remaining capacity", () => {
    const result = validateReservationRequest({
      roomNumber: 1234,
      guestCount: 4,
      date: "2026-08-18",
      selections: validSelections,
      restaurantDate: { date: "2026-08-18", isOpen: true, capacity: 40, reservedSeats: 38, remainingSeats: 2 },
      menu,
    });

    expect(result.ok).toBe(false);
    expect(result.error).toContain("fully booked");
  });

  it("rejects invalid menu options", () => {
    const result = validateReservationRequest({
      roomNumber: 1234,
      guestCount: 2,
      date: "2026-08-18",
      selections: [{ ...validSelections[0], optionId: "bad-option" }, ...validSelections.slice(1)],
      restaurantDate: { date: "2026-08-18", isOpen: true, capacity: 40, reservedSeats: 10, remainingSeats: 30 },
      menu,
    });

    expect(result.ok).toBe(false);
    expect(result.error).toContain("Invalid menu option");
  });
});
