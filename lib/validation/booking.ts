import { z } from "zod";

export const roomNumberSchema = z
  .string()
  .trim()
  .min(1, "Please enter a valid room number.")
  .refine((value) => /^\d+$/.test(value), "Please enter a valid room number.");

export const guestCountSchema = z
  .number()
  .int()
  .min(1, "Please select at least one guest.")
  .max(6, "Guest count is not available for this reservation.");

export const reservationSelectionSchema = z.object({
  guestIndex: z.number().int().nonnegative().optional(),
  courseId: z.string().min(1),
  courseName: z.string().min(1),
  optionId: z.string().min(1),
  optionName: z.string().min(1),
});

export const createReservationSchema = z.object({
  roomNumber: z.coerce.number().int().positive(),
  guestCount: guestCountSchema,
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  selections: z.array(reservationSelectionSchema).min(1),
});

export const dateAvailabilitySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  isOpen: z.boolean(),
  capacity: z.number().int().nonnegative(),
  reservedSeats: z.number().int().nonnegative(),
  remainingSeats: z.number().int().nonnegative(),
});
