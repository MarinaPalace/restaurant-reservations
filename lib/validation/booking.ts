import { z } from "zod";
import { isValidDateKey } from "@/lib/date";
import { PASS_KEY_LENGTH, normalizePassKey } from "@/lib/pass-key";
import { isValidRoomNumber, normalizeRoomNumber } from "@/lib/room";
import { MAX_USES_CAP, STAFF_PERMISSIONS } from "@/types/booking";

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

/**
 * However a guest typed their key — spaced, dashed, lower-case, with or
 * without the VDM prefix — it is reduced to the canonical form before
 * anything compares it.
 */
export const passKeySchema = z
  // The message is set here too, so a request that omits the field entirely
  // gets the sentence written for a guest rather than Zod's "expected string,
  // received undefined".
  .string({ error: "Please enter the pass-key from your check-in slip." })
  .max(64)
  .transform(normalizePassKey)
  .refine((code) => code.length === PASS_KEY_LENGTH, "Please enter the pass-key exactly as it appears on your slip.");

export const createReservationSchema = z.object({
  /**
   * The proof that this person is staying here. Without it the room number is
   * just a number anyone could type.
   */
  passKey: passKeySchema,
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

/**
 * Guest self-service is authorised by the pass-key, not the reservation
 * number. Guests read their reservation number out to other rooms so they can
 * share a table, which would otherwise hand those rooms the power to change or
 * cancel the booking.
 */
export const manageReservationSchema = z.object({
  passKey: passKeySchema,
  /**
   * Which dinner is meant, when a key holds more than one. Optional, because
   * with a single booking there is nothing to disambiguate.
   */
  reservationNumber: z.string().trim().max(40).optional(),
});

export const updateSelectionsSchema = manageReservationSchema.extend({
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
  /** The key from the invitation. Without it, anyone with the URL could book. */
  passKey: passKeySchema,
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

/* ------------------------------------------------------------------ *
 * Staff accounts
 * ------------------------------------------------------------------ */

const staffRoleSchema = z.enum(["admin", "staff"]);

/**
 * Long rather than complicated. A staff password is typed once at the start of
 * a shift on a machine behind the desk, so length is the useful constraint;
 * character-class rules only push people towards "Password1!".
 */
export const STAFF_PASSWORD_MIN_LENGTH = 10;

const staffPasswordSchema = z
  .string()
  .min(STAFF_PASSWORD_MIN_LENGTH, `The password must be at least ${STAFF_PASSWORD_MIN_LENGTH} characters.`)
  .max(200);

const permissionListSchema = z.array(z.enum(STAFF_PERMISSIONS)).max(STAFF_PERMISSIONS.length);

/**
 * Usernames are a sign-in handle, not a display name: no spaces, no case to
 * get wrong. The person's real name is a separate field, and it is that name
 * the audit log shows.
 */
export const staffUsernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3, "The username must be at least 3 characters.")
  .max(40)
  .regex(/^[a-z0-9][a-z0-9._-]*$/, "Use letters, numbers, dots, dashes and underscores only.");

export const createStaffUserSchema = z.object({
  username: staffUsernameSchema,
  name: z.string().trim().min(2, "Please enter the person's name.").max(120),
  password: staffPasswordSchema,
  role: staffRoleSchema.default("staff"),
  permissions: permissionListSchema.default([]),
});

export const updateStaffUserSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  role: staffRoleSchema.optional(),
  permissions: permissionListSchema.optional(),
  active: z.boolean().optional(),
  // Only present when somebody is actually setting a new password.
  password: staffPasswordSchema.optional(),
});

/* ------------------------------------------------------------------ *
 * Pass-keys
 * ------------------------------------------------------------------ */

export const issuePassKeySchema = z.object({
  /** `premium` issues an invitation key instead of an in-house one. */
  kind: menuKindSchema.optional(),
  /** The hotel's own booking reference — stable when a guest changes room. */
  reservationRef: z.string().trim().max(20).optional(),
  roomNumber: z.string().trim().max(10).optional(),
  guestName: z.string().trim().max(120).optional(),
  /** Arrival. The nights, and so the dinners, follow from this and expiry. */
  checkInOn: dateKeySchema.optional(),
  /**
   * The party size on the hotel booking. Capped at the restaurant's own limit
   * because a larger number could not be booked anyway — a bigger group needs
   * a second key.
   */
  maxGuests: z.number().int().min(1).max(MAX_GUESTS_PER_RESERVATION).optional(),
  /**
   * Normally check-out: the key stops working after this evening. Set
   * explicitly by reception rather than derived, so an unusual stay can be
   * described accurately.
   */
  expiresOn: dateKeySchema.optional(),
  /** Dinners the key may book. Defaults to what the stay length earns. */
  maxUses: z.number().int().min(1).max(MAX_USES_CAP).optional(),

  note: z.string().trim().max(200).optional(),
  /**
   * Deliberately giving a key to a guest whose stay is too short. Recorded on
   * the key and in the audit log, so an exception is always traceable.
   */
  allowShortStay: z.boolean().optional(),
});

/**
 * A morning's check-ins, one row each.
 *
 * Reception works from a list of arrivals, and every row is a different guest
 * — so this is a list of distinct keys, not a count of identical ones. Issuing
 * twenty copies of the same room was never what anybody wanted.
 */
export const issuePassKeyBatchSchema = z.object({
  rows: z.array(issuePassKeySchema).min(1).max(40),
});

/**
 * Editing a key already in a guest's hand — the stay-extension case. Only the
 * things that can legitimately change once it is printed.
 */
export const updatePassKeySchema = z.object({
  expiresOn: dateKeySchema.nullable().optional(),
  maxUses: z.number().int().min(1).max(MAX_USES_CAP).optional(),
  /** Party sizes change before arrival, so this stays editable. */
  maxGuests: z.number().int().min(1).max(MAX_GUESTS_PER_RESERVATION).nullable().optional(),
  note: z.string().trim().max(200).optional(),
});

/* ------------------------------------------------------------------ *
 * Cancelling
 * ------------------------------------------------------------------ */

export const cancelReservationSchema = z.object({
  /** What reception was told, kept with the cancellation. */
  reason: z.string().trim().max(300).optional(),
});
