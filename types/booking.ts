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
  createdAt?: string;
  updatedAt?: string;
};

export function withRemainingSeats(date: StoredRestaurantDate): RestaurantDateAvailability {
  return {
    ...date,
    remainingSeats: Math.max(date.capacity - date.reservedSeats, 0),
  };
}
