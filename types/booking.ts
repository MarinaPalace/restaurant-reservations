/**
 * Which dinner a booking is. Two values, and only two: an evening is either
 * everyday or invitation-only, and a pass-key belongs to one of those flows.
 *
 * Deliberately *not* widened to include the promotions catalogue. `MenuKind`
 * is also the type of `PassKeyRecord.kind` and of a date's premium flag, and a
 * pass-key for "promo" is not a thing that can exist. Which catalogue a course
 * sits in is `MenuCatalog` below — a different question with a different set
 * of answers.
 */
export type MenuKind = "standard" | "premium";

/**
 * Which catalogue a course belongs to.
 *
 * - `standard` — the everyday dinner menu. Absent reads as this, so courses
 *   saved before any of the others existed need no migration.
 * - `premium` — the invitation-only dinner menu.
 * - `promo` — products offered once, on the confirmation screen. Not a dinner:
 *   nobody books an evening from it, and it never appears in the booking flow.
 *
 * Promotions are a catalogue rather than a flag on a dinner course because
 * that is what makes them isolated by construction. The first version marked a
 * course `addOn` and then had to remember to filter it out of every dinner
 * query; one missed filter and a bottle of wine appears as a starter. Here the
 * dinner menu asks for `standard` and promotions simply are not in the answer.
 */
export const MENU_CATALOGS = ["standard", "premium", "promo"] as const;

export type MenuCatalog = (typeof MENU_CATALOGS)[number];

/**
 * Which catalogue a course is in.
 *
 * The `addOn` arm reads courses from the first version of promotions, which
 * marked a course on the everyday menu instead of giving it its own. Those
 * courses move to the promotions catalogue on read, so no migration is needed
 * — and `saveMenuCatalog` writes the `menu` field and clears the flag the next
 * time either catalogue is saved, so the compatibility arm goes quiet on its
 * own.
 *
 * It lives here rather than in `lib/services/restaurant.ts` because the
 * dashboard needs it in the browser, and that module pulls in Mongoose.
 */
export function menuCatalogOf(course: Pick<MenuCourse, "menu" | "addOn">): MenuCatalog {
  if (course.menu === "premium" || course.menu === "promo") {
    return course.menu;
  }
  return course.addOn ? "promo" : "standard";
}

/** True when this catalogue is a dinner one, and so has evenings and pass-keys. */
export function isDinnerCatalog(catalog: MenuCatalog): catalog is MenuKind {
  return catalog !== "promo";
}

/**
 * Which dinner a course is served at, or `null` when it is not a dinner course
 * at all.
 *
 * Callers that column up an evening's dishes must use this rather than
 * defaulting the unknown to `standard`: a promotions course answered
 * "standard" under the old two-value reading, and every bottle of wine grew a
 * column on the everyday service sheet.
 */
export function menuKindOf(course: Pick<MenuCourse, "menu" | "addOn">): MenuKind | null {
  const catalog = menuCatalogOf(course);
  return isDinnerCatalog(catalog) ? catalog : null;
}

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
  /**
   * What the product costs, before any discount, in the restaurant's currency.
   *
   * Only promotions charge for anything — a dinner course is part of the stay —
   * so this is absent on every dish, and absent reads as free. A promotion at
   * zero is a legitimate thing to offer: a welcome glass still has to be
   * chosen, and choosing it is what tells the kitchen to pour it.
   */
  price?: number;
  /**
   * How much is taken off `price`, as a percentage from 0 to 100.
   *
   * Stored rather than a second price so the screen can show both — the
   * original struck through and the discounted one beside it. A guest offered
   * "30.00" learns nothing; a guest offered "40.00 30.00 −25%" learns they are
   * being given something.
   */
  discountPercent?: number;
  translations?: Record<string, MenuTranslation>;
};

export type MenuCourse = {
  id: string;
  /** Absent reads as "standard". Read it through `menuCatalogOf`, never directly. */
  menu?: MenuCatalog;
  order: number;
  name: string;
  description: string;
  /**
   * Whether a guest must choose from this course. Always false on a promotions
   * course: a promotion nobody may decline is not a promotion.
   */
  required: boolean;
  active: boolean;
  /**
   * Legacy. The first version of promotions flagged a course on the everyday
   * menu instead of giving promotions their own catalogue. Still read by
   * `menuCatalogOf` so those courses keep working, and cleared on the next
   * save. Nothing new should set it.
   *
   * @deprecated Put the course in the `promo` catalogue instead.
   */
  addOn?: boolean;
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
  /**
   * How many hours before the sitting a **guest** may still book this evening
   * for themselves. Absent reads as 0, which closes bookings when the sitting
   * starts — the same evening it always was.
   *
   * Staff are never bound by it. Reception takes a booking for a table that
   * has just walked up to the desk, and a rule that stopped them would only
   * be worked around by writing it on paper.
   */
  bookingCutoffHours?: number;
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

/**
 * A promotion a guest took on the confirmation screen.
 *
 * The prices are copied in rather than looked up from the catalogue later, for
 * the same reason a reservation copies its dish names: the guest was shown a
 * number and agreed to it, and the restaurant re-pricing the wine next week
 * must not silently change what that guest owes. `finalPrice` is stored too,
 * even though it can be derived, so the arithmetic that produced the figure on
 * the screen is the arithmetic on the bill.
 *
 * The persisted field is still `addOns` — it exists in live documents under
 * that name, and rule 2.2 says schema changes are additive, never renames.
 */
export type ReservationAddOn = {
  courseId: string;
  courseName: string;
  optionId: string;
  optionName: string;
  /** Before the discount, as shown struck through. */
  price: number;
  /** 0 when the product is offered at its usual price. */
  discountPercent: number;
  /** What the guest actually pays: `price` less `discountPercent`, to a cent. */
  finalPrice: number;
};

/**
 * Did they come?
 *
 * A **permanent record**, unlike `ReservationServiceProgress` below. Nobody
 * asks in March whether the soup went out at 20:14; everybody asks in March how
 * many people did not turn up.
 *
 * **Absent is unknown** — neither seated nor no-show — and nothing may read it
 * as either. On a busy night nobody taps anything, and a rule that treated
 * silence as "did not turn up" would record the whole room as no-shows and
 * poison every number built on it. See `docs/service-tracking.md` §7.
 */
export type ReservationAttendance = {
  status: "seated" | "no-show";
  at: string;
  /** Who marked it. A no-show is disputable, so it names somebody. */
  byName: string;
  /** How many actually sat down. Absent reads as the whole party. */
  guests?: number;
};

/**
 * How far through the evening this table is.
 *
 * **Operational, not a record.** Worthless the next morning, never audited, and
 * never shown for a past date.
 *
 * A map rather than a list of booleans: it answers "what is still to go out" by
 * subtraction from the menu, it cannot drift out of order, and the timestamps
 * are what make a "waiting forty minutes" flag possible later without another
 * schema change.
 */
export type ReservationServiceProgress = {
  /**
   * Course id → when that course went out to this table.
   *
   * **Legacy, and read-only from now on.** The first version of the board
   * tracked whole courses. `servedGuests` below replaced it because a table of
   * four rarely gets its four plates at once, and because an allergy note says
   * "guest 2", not "the starter". Records written by that version still read
   * correctly: a course with a timestamp here counts as fully served.
   */
  servedAt?: Record<string, string>;
  /**
   * Course id → guest index → when *that guest's* plate went out.
   *
   * Nested maps rather than an array of indices, and deliberately: each guest
   * is its own key, so `$set`/`$unset` touches one plate and two waiters
   * marking different guests on the same course cannot lose each other. An
   * array would be a read-modify-write, which is exactly what rule 2.7 says
   * not to do.
   *
   * The guest index is per **booking**, so a shared table is unambiguous —
   * both bookings have a guest 0, and they live under different reservations.
   */
  servedGuests?: Record<string, Record<string, string>>;
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
  /**
   * The other rooms sitting at this table.
   *
   * A ticket filled in at reception carries two or three room numbers and a
   * single line of dish counts — one table, several rooms, and no way to say
   * which room ordered which dish. Splitting that into a booking per room would
   * mean inventing per-room guest counts nobody wrote down, so it stays one
   * booking with the rooms listed. Absent on every booking made before this and
   * on anything with one room, which is nearly all of them.
   */
  additionalRooms?: string[];
  /** Who the booking is for, when there is no room to name them by. */
  guestName?: string;
  guestCount: number;
  date: string;
  selections: ReservationSelection[];
  /**
   * Promotions taken on the confirmation screen. Absent on every booking made
   * before promotions existed, and on every booking that declined them.
   */
  addOns?: ReservationAddOn[];
  /** Did they come? Permanent; absent is unknown, never "seated". */
  attendance?: ReservationAttendance;
  /** How far through their courses. Operational; absent is "nothing served". */
  service?: ReservationServiceProgress;
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
  /**
   * Read the analytics page. Additive, and `admin` holds every permission
   * implicitly — including ones added later — so no existing account needs
   * touching. Separate from `dates:manage` because reading the numbers and
   * changing the calendar are different jobs.
   */
  "analytics:view",
  /**
   * Run the service board: mark tables arrived and courses served.
   *
   * Its own permission so a waiter's account can hold this and nothing else —
   * no cancellations, no menu, no pass-keys. That is the account left signed
   * in on a tablet on the floor, and it should be able to do as little as
   * possible.
   */
  "service:record",
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
 * How many dinners a stay earns: one per five nights, capped at three.
 * 5 nights → 1, 10 → 2, 15 or more → 3. Reception can override at issue and
 * change it later when a stay is extended.
 */
export const MAX_USES_CAP = 3;

/** Whole nights between two local date keys, or undefined if either is missing. */
export function nightsBetween(checkIn?: string, checkOut?: string): number | undefined {
  if (!checkIn || !checkOut) {
    return undefined;
  }

  // Parsed at midday so a daylight-saving shift cannot move the count.
  const from = new Date(`${checkIn}T12:00:00`).getTime();
  const to = new Date(`${checkOut}T12:00:00`).getTime();

  if (Number.isNaN(from) || Number.isNaN(to) || to <= from) {
    return undefined;
  }

  return Math.round((to - from) / 86_400_000);
}

export function suggestedUsesForNights(nights: number | undefined): number {
  if (!nights || nights < MINIMUM_STAY_NIGHTS) {
    return 1;
  }
  return Math.min(Math.floor(nights / MINIMUM_STAY_NIGHTS), MAX_USES_CAP);
}

/**
 * `active` may still be spent, `used` is fully spent, and `revoked` was
 * withdrawn by staff.
 *
 * Only `revoked` is really stored — "used" is derived by comparing `usedCount`
 * with `maxUses`, so a key with two dinners left cannot drift out of step with
 * its own counter. Expiry is derived too, from `expiresOn`, so no scheduled job
 * is needed to keep keys honest.
 */
export type PassKeyStatus = "active" | "used" | "revoked";

export type PassKeyRecord = {
  _id?: string;
  id: string;
  /** Canonical form: upper-case, no dashes. Compare against this. */
  code: string;
  /**
   * Which flow the key belongs to. A `premium` key books invitation evenings
   * from the premium menu and nothing else; a `standard` key is the reverse.
   * Absent reads as `standard`, so keys issued before invitations had their
   * own keys are unaffected.
   */
  kind?: MenuKind;
  /**
   * The hotel's own booking reference — five digits, and the thing that does
   * *not* change when a guest is moved to another room. This is how reception
   * finds a key again, which is why it is asked for rather than the room.
   */
  reservationRef?: string;
  /** The room at check-in. A note for reception — guests confirm their own
   * room when booking, because they may since have been moved. */
  roomNumber?: string;
  guestName?: string;
  /** Arrival. Keys are often written a day or two before the guest lands. */
  checkInOn?: string;
  /**
   * Nights booked at the hotel, which is what earns the key. Derived from
   * check-in and check-out rather than typed, so the two cannot disagree.
   */
  nights?: number;
  /** Last date the key works — check-out. Absent means no expiry. */
  expiresOn?: string;
  /**
   * How many people the hotel booking is for.
   *
   * Reception knows this before the guest arrives, so the key carries it and
   * the booking flow will not offer a larger table. Fewer is always fine —
   * people drop out of dinner all the time — but more is not, because the
   * seats were never held for them. Absent means "no limit beyond the usual
   * maximum", which is how every key issued before this reads.
   */
  maxGuests?: number;
  /**
   * How many dinners this key may book, and how many it has. Both are absent
   * on keys issued before multi-use existed, where absent reads as a single
   * use — so nothing needed migrating.
   */
  maxUses: number;
  usedCount: number;
  status: PassKeyStatus;
  /** Every booking made with this key, in the order they were made. */
  reservationNumbers: string[];
  issuedById?: string;
  issuedByName?: string;
  issuedAt?: string;
  usedAt?: string;
  revokedAt?: string;
  /** Why a short stay was allowed a key, or anything else worth recording. */
  note?: string;
  /**
   * Where an invitation is sent.
   *
   * Only invitation keys have one: an in-house guest is handed a printed card at
   * the desk, so there is nobody to email. Kept on the key rather than looked up
   * elsewhere because it is the address the invitation actually went to, which
   * has to stay readable afterwards — "did she ever get it, and where?" is the
   * question reception asks, and a corrected typo must not erase the answer.
   */
  guestEmail?: string;
  /** The last attempt to deliver this invitation. Absent = never sent. */
  invitation?: InvitationDelivery;
};

/**
 * What happened the last time an invitation was sent, and how many times it has
 * been tried.
 *
 * One record rather than a list: reception needs "did it go, and where to?", not
 * an audit trail — the audit log already carries a line per send. `attempts`
 * survives because a key that has been emailed four times is usually a sign the
 * address is wrong, which is worth seeing at the desk.
 */
export type InvitationDelivery = {
  /** Email today. Viber, Telegram and WhatsApp are the reason this is named. */
  channel: "email";
  /** The address it was sent to, as sent. */
  to: string;
  at: string;
  status: "sent" | "failed";
  /** The provider's id for the message, for chasing it up with them. */
  messageId?: string;
  /** Why it failed, in the provider's words. Never shown to a guest. */
  error?: string;
  attempts: number;
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
  | "settings:save"
  | "reservation:attendance"
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
