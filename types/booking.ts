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

export type RestaurantDateAvailability = {
  date: string;
  isOpen: boolean;
  capacity: number;
  reservedSeats: number;
  remainingSeats: number;
};

export type ReservationSelection = {
  guestIndex?: number;
  courseId: string;
  courseName: string;
  optionId: string;
  optionName: string;
};

export type ReservationRecord = {
  _id?: string;
  reservationNumber: string;
  roomNumber: number;
  guestCount: number;
  date: string;
  selections: ReservationSelection[];
  status: "confirmed" | "cancelled";
  createdAt?: string;
  updatedAt?: string;
};
