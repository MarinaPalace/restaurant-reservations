/**
 * Which menu a course belongs to. Absent means the everyday menu, so courses
 * saved before premium existed need no migration.
 */
export type MenuKind = "standard" | "premium";

export type MenuTranslation = {
  name?: string;
  description?: string;
  ingredients?: string;
};

export type MenuOption = {
  id: string;
  courseId: string;
  name: string;
  description: string;
  allergens: string[];
  active: boolean;
  imageUrl?: string;
  /**
   * What is in the dish. Optional, and hidden from guests when blank, so
   * options that predate this field are unaffected.
   */
  ingredients?: string;
  /** Shown to guests as a badge. Absent on older options, which reads false. */
  vegan?: boolean;
  translations?: Record<string, MenuTranslation>;
};

export type MenuCourse = {
  id: string;
  /** Absent reads as "standard". */
  menu?: MenuKind;
  order: number;
  name: string;
  description: string;
  required: boolean;
  active: boolean;
  imageUrl?: string;
  translations?: Record<string, MenuTranslation>;
  options: MenuOption[];
};

/**
 * How a date is persisted. `remainingSeats` is deliberately absent: it is
 * always derived from capacity and reservedSeats so the two can never drift.
 */
export type StoredRestaurantDate = {
  date: string;
  isOpen: boolean;
  capacity: number;
  reservedSeats: number;
  /** Strict arrival time for the sitting, "HH:MM" in the restaurant's timezone. */
  serviceTime?: string;
  /** When the sitting ends. Falls back to a fixed length when unset. */
  serviceEndTime?: string;
  /**
   * Reserved for invited guests booking from the premium menu. Such an evening
   * is hidden from the everyday flow and is the only kind selectable at
   * /premium.
   */
  premium?: boolean;
};

export type RestaurantDateAvailability = StoredRestaurantDate & {
  remainingSeats: number;
};

export type ReservationSelection = {
  guestIndex?: number;
  courseId: string;
  courseName: string;
  optionId: string;
  optionName: string;
};

export type ReservationStatus = "confirmed" | "cancelled";

/** Which app the guest prefers to be messaged on, when they leave a phone number. */
export type MessagingApp = "phone" | "whatsapp" | "viber" | "telegram";

export type ReservationContact = {
  method: "email" | "phone";
  email?: string;
  phone?: string;
  messagingApp?: MessagingApp;
};

export type ReservationRecord = {
  _id?: string;
  reservationNumber: string;
  /** Absent reads as "standard". */
  kind?: MenuKind;
  /**
   * A label, not a number: the hotel has rooms like L10 and HA3. Blank for a
   * premium booking, where the guest is not staying yet and gives a name.
   */
  roomNumber: string;
  /** Who the booking is for, when there is no room to name them by. */
  guestName?: string;
  guestCount: number;
  date: string;
  selections: ReservationSelection[];
  /** How to reach the guest. Optional so bookings made before this existed still load. */
  contact?: ReservationContact;
  /** Arrival time copied from the date when the booking was made. */
  time?: string;
  /** End of the sitting, copied from the date alongside `time`. */
  endTime?: string;
  /** Allergies or anything else the kitchen should know. */
  notes?: string;
  /**
   * Rooms dining together share this id. It is the reservation number of
   * whoever booked first, so guests can read it out to each other.
   */
  tableGroupId?: string;
  /** Assigned by staff in the dashboard; blank until someone sets it. */
  tableNumber?: string;
  status: ReservationStatus;
  /**
   * The pass-key this booking was made with. It is what lets the guest come
   * back and change or cancel it — the reservation number cannot serve that
   * purpose, because guests hand it to other rooms to share a table.
   *
   * Absent on bookings taken by staff and on everything made before pass-keys
   * existed.
   */
  passKeyId?: string;
  /**
   * Who cancelled, and when. A denormalised copy of the audit entry so the
   * record explains itself — in the dashboard, in a CSV export, or read
   * straight out of the database — without joining the log.
   */
  cancellation?: CancellationRecord;
  createdAt?: string;
  updatedAt?: string;
};

export function withRemainingSeats(date: StoredRestaurantDate): RestaurantDateAvailability {
  return {
    ...date,
    remainingSeats: Math.max(date.capacity - date.reservedSeats, 0),
  };
}

/* ------------------------------------------------------------------ *
 * Who did something
 * ------------------------------------------------------------------ */

/**
 * `staff` is a named account, `guest` is somebody acting with a pass-key, and
 * `system` covers automatic action with nobody behind it.
 */
export type ActorKind = "staff" | "guest" | "system";

export type Actor = {
  kind: ActorKind;
  /** Staff user id, or the pass-key id when a guest acted. */
  id?: string;
  /** What to show in the log: a staff name, or the guest's room. */
  name: string;
};

export type CancellationRecord = {
  at: string;
  actorKind: ActorKind;
  actorId?: string;
  actorName: string;
  /** Optional free text, e.g. what reception was told on the phone. */
  reason?: string;
};

/* ------------------------------------------------------------------ *
 * Staff accounts and permissions
 * ------------------------------------------------------------------ */

/**
 * Everything a staff account can be allowed to do. Checked in the API route,
 * never only in the UI — hiding a button is not access control.
 */
export const STAFF_PERMISSIONS = [
  "reservations:create",
  "reservations:edit",
  "reservations:cancel",
  "reservations:restore",
  "reservations:delete",
  "menu:edit",
  "dates:manage",
  "passkeys:issue",
  "users:manage",
] as const;

export type StaffPermission = (typeof STAFF_PERMISSIONS)[number];

/**
 * `admin` holds every permission implicitly, including ones added in a later
 * release, so a new capability is never silently granted to everyone but is
 * never withheld from the owner either.
 */
export type StaffRole = "admin" | "staff";

export type StaffUserRecord = {
  _id?: string;
  id: string;
  /** Lower-cased for comparison; what the person types to sign in. */
  username: string;
  /** Shown in the audit log, so a cancellation names a person. */
  name: string;
  role: StaffRole;
  /** Ignored for admins, who hold everything. */
  permissions: StaffPermission[];
  /** A disabled account keeps its history but cannot sign in. */
  active: boolean;
  createdAt?: string;
  updatedAt?: string;
  lastLoginAt?: string;
  createdByName?: string;
  /**
   * True for the account backed by ADMIN_USERNAME / ADMIN_PASSWORD_HASH. It
   * lives in the environment rather than the database, cannot be edited or
   * deleted from the panel, and exists so a deployment with no accounts yet
   * can still be signed into.
   */
  isEnvironmentAccount?: boolean;
};

/* ------------------------------------------------------------------ *
 * Pass-keys
 * ------------------------------------------------------------------ */

/**
 * The stay length that entitles a guest to dinner. Reception cannot issue a
 * key below it without deliberately overriding, which is recorded.
 */
export const MINIMUM_STAY_NIGHTS = 5;

/**
 * `active` may be spent on a booking, `used` has been, and `revoked` was
 * withdrawn by staff. Expiry is deliberately *not* a status: it is derived
 * from `expiresOn` so no scheduled job is needed to keep keys honest.
 */
export type PassKeyStatus = "active" | "used" | "revoked";

export type PassKeyRecord = {
  _id?: string;
  id: string;
  /** Canonical form: upper-case, no dashes. Compare against this. */
  code: string;
  /** The room at check-in. A note for reception — guests confirm their own
   * room when booking, because they may since have been moved. */
  roomNumber?: string;
  guestName?: string;
  /** Nights booked at the hotel, which is what earns the key. */
  nights?: number;
  /** Last date the key works, normally check-out. Absent means no expiry. */
  expiresOn?: string;
  status: PassKeyStatus;
  /** The booking it was spent on, while it is spent. */
  reservationNumber?: string;
  issuedById?: string;
  issuedByName?: string;
  issuedAt?: string;
  usedAt?: string;
  revokedAt?: string;
  /** Why a short stay was allowed a key, or anything else worth recording. */
  note?: string;
};

/* ------------------------------------------------------------------ *
 * Audit log
 * ------------------------------------------------------------------ */

export type AuditAction =
  | "reservation:create"
  | "reservation:update"
  | "reservation:cancel"
  | "reservation:restore"
  | "reservation:delete"
  | "reservation:table"
  | "passkey:issue"
  | "passkey:revoke"
  | "user:create"
  | "user:update"
  | "user:delete"
  | "menu:save"
  | "date:update";

export type AuditEntry = {
  _id?: string;
  id: string;
  at: string;
  action: AuditAction;
  actorKind: ActorKind;
  actorId?: string;
  actorName: string;
  /** Set for anything done to a booking, so its history loads in one query. */
  reservationNumber?: string;
  /** One line, already worded for a human reading the log. */
  summary: string;
};
