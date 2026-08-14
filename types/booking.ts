export type MenuTranslation = {
  name?: string;
  description?: string;
};

export type MenuOption = {
  id: string;
  courseId: string;
  name: string;
  description: string;
  allergens: string[];
  active: boolean;
  imageUrl?: string;
  translations?: Record<string, MenuTranslation>;
};

export type MenuCourse = {
  id: string;
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
  roomNumber: number;
  guestCount: number;
  date: string;
  selections: ReservationSelection[];
  /** How to reach the guest. Optional so bookings made before this existed still load. */
  contact?: ReservationContact;
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
