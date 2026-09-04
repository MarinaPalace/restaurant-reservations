import type { EveningOverrides } from "@/lib/evening-features";

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
  /**
   * How many hours before the sitting **guests stop choosing tables** for this
   * evening. Absent or 0 means no cutoff at all: tables stay pickable for as
   * long as the booking itself can be made or changed, which is exactly what
   * every evening did before this existed.
   *
   * Its own number rather than `bookingCutoffHours`, because the two answer
   * different questions. Bookings close when the kitchen can no longer take
   * another cover; table selection closes when the floor is laid out, which is
   * usually earlier and sometimes not a concern at all. An evening that does
   * not care leaves it off.
   *
   * Staff are never bound by it, the same as the booking cutoff: reception
   * moves a table at 18:55 because the guest is standing in front of them.
   */
  tableCutoffHours?: number;
  /**
   * What this evening switches on or off for itself — see
   * `lib/evening-features.ts`.
   *
   * **Absent means "whatever the restaurant says"**, and so does an absent
   * field inside it. Every date that existed before this has none, which is
   * why none of them changed behaviour: they all resolve to the defaults, and
   * the defaults are the app exactly as it was.
   *
   * It is what lets one future date run a feature nobody else has yet — open
   * the date, write a pass-key for it, and test against real bookings without
   * turning anything on for tonight.
   */
  features?: EveningOverrides;
  /**
   * Seats a guest is part-way through booking, held while they choose.
   *
   * Added after the fact, so absent reads as 0 — which is what every date
   * written before holds existed meant (rule 2.2). It counts against capacity
   * exactly as `reservedSeats` does, and the two are kept apart on purpose:
   * `reservedSeats` is bookings that exist, this is bookings that might.
   *
   * A hold turns into a booking by moving its seats from here to there in one
   * update, so there is never an instant where they are in neither.
   */
  heldSeats?: number;
  /**
   * When a hold was last taken on this evening.
   *
   * The safety net under `heldSeats`. A hold is released by deleting its
   * document and decrementing the counter, and a crash between those two steps
   * would strand seats nobody holds. Since every hold bumps this and no hold
   * outlives `SEAT_HOLD_MINUTES`, a date with held seats, no live holds and
   * nothing taken for longer than that is stranded rather than busy — and the
   * sweep may safely put the seats back.
   */
  heldSeatsTouchedAt?: string;
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
   * What staff want to remember about this booking. **Never shown to guests.**
   *
   * A different thing from `notes`, which the guest wrote and the kitchen acts
   * on. This is written *about* the booking by whoever is on the floor — "asked
   * for the window next time", "celebrating an anniversary", "was unhappy with
   * the wine" — and some of it would be mortifying to send to the person it is
   * about.
   *
   * Which is why it is not enough for the guest screens not to render it: every
   * guest-facing route strips it through `toGuestReservation`, because a guest
   * can open the network tab and a screen is not a boundary. See
   * `lib/guest-reservation.ts`.
   */
  staffNote?: string;
  /**
   * Rooms dining together share this id. It is the reservation number of
   * whoever booked first, so guests can read it out to each other.
   */
  tableGroupId?: string;
  /** Assigned by staff in the dashboard; blank until someone sets it. */
  tableNumber?: string;
  /**
   * The plan table this booking holds a claim on.
   *
   * Stored beside `tableNumber` rather than instead of it, because they answer
   * different questions. The number is what everybody *calls* the table and is
   * what the sheet, the board and `groupRoomRowsByTable` read; this is the
   * plan's own stable id, and it is what a cancellation releases.
   *
   * A label can be renamed in the designer — resolving the claim back through
   * one at cancellation time would release whichever table happens to answer to
   * that string today, which may be a different table entirely, or none.
   *
   * Absent on every booking taken before table selection, on every booking made
   * with it off, and on any table a member of staff typed in by hand.
   */
  tableId?: string;
  /**
   * Every plan table this booking holds, when it holds more than one.
   *
   * A restaurant of four-tops cannot seat five at a table, so two get pushed
   * together — `docs/floor-plan.md` §21. `tableId` stays the first of them, so
   * everything written before combinations existed keeps reading a single id
   * and finding one there (rule 2.2: additive, never a rename).
   *
   * `tableNumber` is what they are called between them, "7 + 8", which is the
   * string the sheet, the board and `groupRoomRowsByTable` already key on.
   *
   * Absent on every booking with one table or none, which is nearly all of
   * them.
   */
  tableIds?: string[];
  /**
   * Who put this booking on that table.
   *
   * Owner, staff and guest all write the same `tableNumber`, and once written
   * they were indistinguishable — so nobody could tell whether a table could be
   * moved freely or whether a guest had picked it deliberately and would mind.
   * This is the missing half of that: the number says *where*, this says *who
   * decided*.
   *
   * Absent on every booking taken before it existed and on anything with no
   * table at all, which is what makes it additive (rule 2.2). Absent reads as
   * "nobody recorded it", never as a guess.
   */
  tableSource?: TableSource;
  /** When the table was last set, beside who set it. */
  tableSetAt?: string;
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
  /**
   * How many times this booking has been written, counting its creation.
   *
   * The log says what changed; this says **which booking** you are holding. A
   * history of six entries beside a record with no version leaves "is this the
   * one the last entry produced, or has something happened since?" unanswerable,
   * which is the question a version number exists to close.
   *
   * Incremented with `$inc` in the same update as the change it counts (rule
   * 2.7), so two waiters marking different courses cannot lose each other's
   * bump.
   *
   * Absent on every booking written before this existed. Such a booking lands
   * on 1 with its next write, which looks like a creation and is not one — what
   * makes that harmless is that the audit entry for the same write carries the
   * same number, and pairing an entry to the record it produced is the whole
   * job. Both stores agree on this, deliberately.
   */
  version?: number;
  createdAt?: string;
  updatedAt?: string;
};

/**
 * Seats nobody has, counting the ones somebody is in the middle of taking.
 *
 * Held seats are subtracted alongside booked ones, so an evening whose last
 * four seats are being chosen reads as full to everybody else. That is the
 * whole point of holding them: the alternative is what this replaced, where two
 * guests were both told the seats were there and only one of them was right.
 *
 * The guest who owns the hold is the one exception, and it is the caller's to
 * make — the route adds their own held seats back before judging their booking.
 */
export function withRemainingSeats(date: StoredRestaurantDate): RestaurantDateAvailability {
  return {
    ...date,
    remainingSeats: Math.max(date.capacity - date.reservedSeats - (date.heldSeats ?? 0), 0),
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

/**
 * Who chose a table.
 *
 * Narrower than `ActorKind` on purpose: `system` never picks a table, and the
 * distinction that matters on the floor is the one between the owner, a member
 * of staff and the guest themselves. A guest's pick is the one staff should
 * think twice about moving.
 */
export type TableSource = "owner" | "staff" | "guest";

/** What to call each source on screen, and the letter drawn in its ring. */
export const TABLE_SOURCE_LABELS: Record<TableSource, { name: string; letter: string }> = {
  owner: { name: "Chosen by the owner", letter: "O" },
  staff: { name: "Chosen by staff", letter: "S" },
  guest: { name: "Chosen by the guest", letter: "G" },
};

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
  /**
   * Draw the room: add, move and label tables in the floor-plan designer.
   *
   * Additive, and `admin` holds every permission implicitly — including ones
   * added later — so no existing account needs touching. Its own permission
   * rather than folding into `dates:manage`, because laying out the room is a
   * thing done once by whoever runs the floor, not part of keeping the
   * calendar.
   */
  "floorplan:edit",
  /**
   * Read the audit log, and a booking's own history with it.
   *
   * It used to be open to anybody signed in, on the reasoning that a log
   * everybody can see is a log everybody knows is there. That was wrong about
   * *what is in it*: the log names guests, rooms and what they changed, so the
   * whole of it is a guest list — and the account left signed in on a tablet on
   * the floor holds `service:record` and should hold nothing else.
   *
   * Additive, and `admin` holds every permission implicitly, so the owner keeps
   * what they had and an existing staff account has to be granted this
   * deliberately.
   */
  "audit:read",
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
  /**
   * What actually moved, field by field, when this entry is about an edit.
   *
   * Beside `summary` rather than instead of it (rule 2.2): every entry ever
   * written has a summary and must keep rendering, and a UI that wants to draw
   * the change properly should not be parsing prose to do it. Absent on
   * anything that is not an edit, and on every entry written before this
   * existed.
   */
  changes?: AuditChange[];
  /**
   * The version of the thing this entry produced.
   *
   * So a history reads as a sequence rather than a pile: v4 made this, v5 made
   * that, and the record in front of you says which one it is. Absent on
   * entries about things that are not versioned, and on everything written
   * before versions existed.
   */
  version?: number;
};

/**
 * One field that moved. Built by `lib/reservation-changes.ts`, which is where
 * the rules about what counts as a change live.
 */
export type AuditChange = {
  /** The record field, for anything that wants to group or filter later. */
  field: string;
  /** What to call it on screen: "Table", "Party", "Arrival". */
  label: string;
  /** Absent when the field had nothing in it before. */
  from?: string;
  /** Absent when the field was cleared. */
  to?: string;
};
