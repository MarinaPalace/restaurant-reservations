import { z } from "zod";
import { isValidDateKey } from "@/lib/date";
import { CURRENCIES } from "@/lib/money";
import { TIME_ZONES } from "@/lib/timezone";
import { PASS_KEY_LENGTH, normalizePassKey } from "@/lib/pass-key";
import { isValidRoomNumber, normalizeRoomNumber } from "@/lib/room";
import { MAX_USES_CAP, MENU_CATALOGS, STAFF_PERMISSIONS } from "@/types/booking";

export const MAX_GUESTS_PER_RESERVATION = 6;

/**
 * Rooms that may be added alongside the first on one booking. A ticket has
 * space for three room numbers, which is also as many parties as a table of six
 * realistically holds.
 */
export const MAX_ADDITIONAL_ROOMS = 2;

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

/**
 * Which dinner. Used for pass-keys and evenings, where "promo" is not an
 * answer — see `MenuKind` in `types/booking.ts`.
 */
export const menuKindSchema = z.enum(["standard", "premium"]);

/** Which catalogue is being read or edited. Promotions are one of the three. */
export const menuCatalogSchema = z.enum(MENU_CATALOGS);

export const restaurantDateSchema = z.object({
  date: dateKeySchema,
  isOpen: z.boolean(),
  capacity: z.number().int().min(0).max(10_000),
  serviceTime: timeSchema.optional(),
  serviceEndTime: timeSchema.optional(),
  premium: z.boolean().optional(),
  /**
   * How many hours before the sitting guest bookings close. Ten days is the
   * cap: beyond that the evening is effectively not bookable online, which is
   * what "closed" is for.
   */
  bookingCutoffHours: z.number().int().min(0).max(240).optional(),
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
 * Promotions taken on the confirmation screen.
 *
 * `reservationNumber` is required here, unlike the schema it extends: a key
 * that booked three dinners has three confirmations, and "which one" cannot be
 * inferred. It still is not what authorises the change — the pass-key is
 * (rule 2.5) — it only says which of that key's bookings is meant.
 *
 * An empty array is valid and means "none, thank you", which is how a guest
 * takes a promotion back off.
 */
export const updateAddOnsSchema = manageReservationSchema.extend({
  reservationNumber: z.string().trim().min(1).max(40),
  /**
   * Which screen is asking.
   *
   * `confirmation` is the one place a promotion can be *taken*. `manage` may
   * only change or drop what the booking already holds — a guest who declined
   * cannot come back a week later and help themselves.
   *
   * Not a security boundary, and not pretending to be one: both screens are
   * driven by the same pass-key, and the holder of that key is the legitimate
   * owner of this booking. It is a rule about what each screen offers, and
   * lying about it gains a guest nothing they could not already do from the
   * confirmation screen. Nobody else's data is reachable either way.
   */
  mode: z.enum(["confirmation", "manage"]).optional(),
  addOns: z
    .array(
      z.object({
        courseId: z.string().min(1).max(64),
        optionId: z.string().min(1).max(64),
      }),
    )
    // One per group, and a catalogue with more groups than this is not a
    // promotion any more. The route also refuses two from the same group.
    .max(24),
});

/**
 * Promotions set by staff. No `mode`: reception is never limited to what the
 * guest already holds — see the route.
 */
export const staffAddOnsSchema = z.object({
  addOns: z
    .array(
      z.object({
        courseId: z.string().min(1).max(64),
        optionId: z.string().min(1).max(64),
      }),
    )
    .max(24),
});

/**
 * One mark from the service board: either a table arriving, or a course going
 * out. Exactly one of the two per request, so a single tap is a single write.
 *
 * `attendance: null` **clears** the record back to unknown. Undoing a mis-tap
 * must not leave a different claim behind — see `docs/service-tracking.md` §7.
 */
export const serviceMarkSchema = z
  .object({
    attendance: z.enum(["seated", "no-show"]).nullable().optional(),
    /** How many actually sat down. Absent reads as the whole party. */
    guests: z.number().int().min(0).max(MAX_GUESTS_PER_RESERVATION).optional(),
    courseId: z.string().min(1).max(64).optional(),
    served: z.boolean().optional(),
  })
  .refine((row) => row.attendance !== undefined || row.courseId !== undefined, {
    message: "Nothing to mark.",
  })
  .refine((row) => row.courseId === undefined || row.served !== undefined, {
    message: "Say whether the course has been served.",
    path: ["served"],
  });

/**
 * Staff booking form. Contact details are optional here: a reservation taken
 * over the phone may not have them, whereas a guest booking online always does.
 */
export const staffReservationSchema = z.object({
  roomNumber: roomNumberSchema,
  /**
   * The other rooms on the table, when a ticket names several. Capped at two
   * beyond the first: three rooms is the most the printed ticket has space for,
   * and a table of six cannot hold more parties than that anyway.
   */
  additionalRooms: z.array(roomNumberSchema).max(MAX_ADDITIONAL_ROOMS).optional(),
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

/**
 * What the menu editor sends when it saves. Named for the body rather than the
 * catalogue so it does not collide with `menuCatalogSchema`, which names
 * *which* catalogue is meant.
 */
export const saveMenuSchema = z.object({
  menu: menuCatalogSchema.optional(),
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
            // Promotions only. A dish carries no price, and absent reads as free.
            price: z.number().min(0).max(1_000_000).optional(),
            discountPercent: z.number().int().min(0).max(100).optional(),
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

/**
 * An invitation's email address.
 *
 * Deliberately permissive beyond the shape: guests come from everywhere, and a
 * stricter pattern rejects addresses that work. The provider is the real judge,
 * and it answers with a reason we record and show.
 */
export const guestEmailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3)
  .max(320)
  .refine((value) => /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(value), "Please enter a valid email address.");

export const issuePassKeySchema = z.object({
  /** `premium` issues an invitation key instead of an in-house one. */
  kind: menuKindSchema.optional(),
  /** The hotel's own booking reference — stable when a guest changes room. */
  reservationRef: z.string().trim().max(20).optional(),
  roomNumber: z.string().trim().max(10).optional(),
  guestName: z.string().trim().max(120).optional(),
  /**
   * Where an invitation is sent. Invitations only: an in-house guest is handed
   * a card at the desk, and the hotel's address for them is not ours to use.
   */
  guestEmail: guestEmailSchema.optional(),
  /** Send the invitation as soon as it is issued. Requires an address. */
  sendInvitation: z.boolean().optional(),
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
})
  /**
   * Asking to send without an address is a slip worth catching here rather than
   * halfway through issuing, and asking to email an in-house key is a
   * misunderstanding of what the two kinds are.
   */
  .refine((row) => !row.sendInvitation || Boolean(row.guestEmail), {
    message: "Add an email address, or untick sending the invitation.",
    path: ["guestEmail"],
  })
  .refine((row) => !row.sendInvitation || row.kind === "premium", {
    message: "Only invitations are emailed. An in-house pass-key is printed as a card.",
    path: ["sendInvitation"],
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
/** Sending an invitation again, optionally to a corrected address. */
export const sendInvitationSchema = z.object({
  email: guestEmailSchema.optional(),
});

export const updatePassKeySchema = z.object({
  /**
   * Rooms change often, and a reference typed wrong at check-in has to be
   * correctable — reception looks keys up by both.
   */
  roomNumber: z.string().trim().max(10).nullable().optional(),
  reservationRef: z.string().trim().max(20).nullable().optional(),
  guestName: z.string().trim().max(120).nullable().optional(),
  /** Correcting the address an invitation bounced off. */
  guestEmail: guestEmailSchema.nullable().optional(),
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

/* ------------------------------------------------------------------ *
 * Settings
 * ------------------------------------------------------------------ */

/**
 * What promotion prices are quoted in. A closed list rather than free text:
 * the value is rendered by `Intl.NumberFormat`, which throws on an ISO code it
 * does not know.
 */
export const currencySchema = z.enum(CURRENCIES);

/** Which clock the restaurant's times are quoted on. A label, not a conversion. */
export const timeZoneSchema = z.enum(TIME_ZONES);

/** Every field optional: a screen may save one setting without knowing the others. */
export const updateSettingsSchema = z
  .object({
    currency: currencySchema.optional(),
    timeZone: timeZoneSchema.optional(),
  })
  .refine((row) => row.currency !== undefined || row.timeZone !== undefined, {
    message: "Nothing to save.",
  });
