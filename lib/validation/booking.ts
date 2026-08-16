import { z } from "zod";
import { isValidDateKey } from "@/lib/date";
import { isValidRoomNumber, normalizeRoomNumber } from "@/lib/room";

export const MAX_GUESTS_PER_RESERVATION = 6;

/**
 * Rooms are labels such as L10, HA3 or 402. Stored upper-cased so lookups do
 * not depend on how the guest typed it.
 */
export const roomNumberSchema = z
  .string()
  .transform(normalizeRoomNumber)
  .refine(isValidRoomNumber, "Please enter a valid room number, for example 402 or L10.");

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
  roomNumber: roomNumberSchema,
  guestCount: z.number().int().min(1).max(MAX_GUESTS_PER_RESERVATION),
  date: dateKeySchema,
  selections: z.array(reservationSelectionSchema).min(1),
  // Optional here so a missing contact is reported by describeContactProblem,
  // which words it for a guest rather than echoing a schema error.
  contact: reservationContactSchema.optional(),
  notes: z.string().trim().max(500).optional(),
  /** Reservation number of the party this booking wants to share a table with. */
  joinReservationNumber: z.string().trim().max(40).optional(),
});

export type CreateReservationInput = z.infer<typeof createReservationSchema>;

export const timeSchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):([0-5]\d)$/, "Please enter a time as HH:MM.");

export const menuKindSchema = z.enum(["standard", "premium"]);

export const restaurantDateSchema = z.object({
  date: dateKeySchema,
  isOpen: z.boolean(),
  capacity: z.number().int().min(0).max(10_000),
  serviceTime: timeSchema.optional(),
  serviceEndTime: timeSchema.optional(),
  premium: z.boolean().optional(),
});

export const updateSelectionsSchema = z.object({
  roomNumber: roomNumberSchema,
  selections: z.array(reservationSelectionSchema).min(1),
});

/**
 * Staff booking form. Contact details are optional here: a reservation taken
 * over the phone may not have them, whereas a guest booking online always does.
 */
export const staffReservationSchema = z.object({
  roomNumber: roomNumberSchema,
  guestCount: z.number().int().min(1).max(MAX_GUESTS_PER_RESERVATION),
  date: dateKeySchema,
  selections: z.array(reservationSelectionSchema),
  contact: reservationContactSchema.optional(),
  notes: z.string().trim().max(500).optional(),
  tableNumber: z.string().trim().max(20).optional(),
});

/** Every field is optional: staff may change only what they need to. */
export const staffReservationPatchSchema = staffReservationSchema.partial();

export const tableAssignmentSchema = z.object({
  tableNumber: z.string().trim().max(20),
});

const menuTranslationSchema = z.object({
  name: z.string().optional(),
  description: z.string().optional(),
  ingredients: z.string().optional(),
});

export const menuCatalogSchema = z.object({
  menu: menuKindSchema.optional(),
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
            // Optional so a menu saved without them keeps whatever it had.
            ingredients: z.string().max(500).optional(),
            vegan: z.boolean().optional(),
            translations: z.record(z.string(), menuTranslationSchema).optional(),
          }),
        ),
      }),
    )
    .max(50),
});

/**
 * An invited guest is not staying yet, so there is no room to identify them
 * by. They give a name instead, and contact details are required — it is the
 * only way to reach them before they arrive.
 */
export const premiumReservationSchema = z.object({
  guestName: z.string().trim().min(2, "Please enter your name.").max(120),
  guestCount: z.number().int().min(1).max(MAX_GUESTS_PER_RESERVATION),
  date: dateKeySchema,
  selections: z.array(reservationSelectionSchema).min(1),
  contact: reservationContactSchema,
  notes: z.string().trim().max(500).optional(),
});

export const adminLoginSchema = z.object({
  username: z.string().min(1).max(200),
  password: z.string().min(1).max(200),
});
