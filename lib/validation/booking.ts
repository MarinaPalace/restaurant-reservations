import { z } from "zod";
import { isValidDateKey } from "@/lib/date";

export const MAX_GUESTS_PER_RESERVATION = 6;

const dateKeySchema = z.string().refine(isValidDateKey, "Please choose a valid dinner date.");

export const reservationSelectionSchema = z.object({
  guestIndex: z.number().int().nonnegative().optional(),
  courseId: z.string().min(1),
  courseName: z.string().min(1),
  optionId: z.string().min(1),
  optionName: z.string().min(1),
});

export const reservationContactSchema = z.object({
  method: z.enum(["email", "phone"]),
  email: z.string().max(320).optional(),
  phone: z.string().max(32).optional(),
  messagingApp: z.enum(["phone", "whatsapp", "viber", "telegram"]).optional(),
});

export const createReservationSchema = z.object({
  roomNumber: z.coerce.number().int().positive(),
  guestCount: z.number().int().min(1).max(MAX_GUESTS_PER_RESERVATION),
  date: dateKeySchema,
  selections: z.array(reservationSelectionSchema).min(1),
  // Optional here so a missing contact is reported by describeContactProblem,
  // which words it for a guest rather than echoing a schema error.
  contact: reservationContactSchema.optional(),
});

export type CreateReservationInput = z.infer<typeof createReservationSchema>;

export const restaurantDateSchema = z.object({
  date: dateKeySchema,
  isOpen: z.boolean(),
  capacity: z.number().int().min(0).max(10_000),
});

const menuTranslationSchema = z.object({
  name: z.string().optional(),
  description: z.string().optional(),
});

export const menuCatalogSchema = z.object({
  courses: z
    .array(
      z.object({
        id: z.string().optional(),
        order: z.number().int().min(1),
        name: z.string().min(1, "Every course needs a name."),
        description: z.string().default(""),
        required: z.boolean().default(true),
        active: z.boolean().default(true),
        imageUrl: z.string().default(""),
        translations: z.record(z.string(), menuTranslationSchema).optional(),
        options: z.array(
          z.object({
            id: z.string().optional(),
            courseId: z.string().optional(),
            name: z.string().min(1, "Every option needs a name."),
            description: z.string().default(""),
            allergens: z.array(z.string()).default([]),
            active: z.boolean().default(true),
            imageUrl: z.string().default(""),
            translations: z.record(z.string(), menuTranslationSchema).optional(),
          }),
        ),
      }),
    )
    .max(50),
});

export const adminLoginSchema = z.object({
  username: z.string().min(1).max(200),
  password: z.string().min(1).max(200),
});
