import type { MenuCourse, ReservationRecord, RestaurantDateAvailability } from "@/types/booking";

const restaurantDates: RestaurantDateAvailability[] = [
  { date: "2026-08-18", isOpen: true, capacity: 40, reservedSeats: 12, remainingSeats: 28 },
  { date: "2026-08-19", isOpen: true, capacity: 40, reservedSeats: 24, remainingSeats: 16 },
  { date: "2026-08-20", isOpen: false, capacity: 40, reservedSeats: 0, remainingSeats: 40 },
  { date: "2026-08-21", isOpen: true, capacity: 40, reservedSeats: 38, remainingSeats: 2 },
  { date: "2026-08-22", isOpen: true, capacity: 40, reservedSeats: 40, remainingSeats: 0 },
  { date: "2026-08-23", isOpen: true, capacity: 40, reservedSeats: 8, remainingSeats: 32 },
];

const mockMenu: MenuCourse[] = [
  {
    id: "course-1",
    order: 1,
    name: "Amuse Bouche",
    description: "Seasonal bite prepared by the chef",
    required: true,
    active: true,
    imageUrl: "",
    translations: { fr: { name: "Amuse-Bouche", description: "Bouchée saisonnière" } },
    options: [
      {
        id: "option-1",
        courseId: "course-1",
        name: "Chef's Selection",
        description: "The kitchen's curated first bite.",
        allergens: ["Gluten"],
        active: true,
        imageUrl: "",
        translations: { fr: { name: "Sélection du chef", description: "Une bouchée du chef." } },
      },
    ],
  },
  {
    id: "course-2",
    order: 2,
    name: "Starter",
    description: "A bright and refreshing opening course",
    required: true,
    active: true,
    imageUrl: "",
    translations: { fr: { name: "Entrée", description: "Une entrée légère et rafraîchissante." } },
    options: [
      {
        id: "option-2",
        courseId: "course-2",
        name: "Citrus Cured Salmon",
        description: "Served with dill and pickled shallot.",
        allergens: ["Fish", "Sesame"],
        active: true,
        imageUrl: "",
        translations: { fr: { name: "Saumon mariné aux agrumes", description: "Servi avec aneth et échalote confite." } },
      },
      {
        id: "option-3",
        courseId: "course-2",
        name: "Roasted Tomato Velouté",
        description: "Silky soup with basil oil.",
        allergens: ["Dairy"],
        active: true,
        imageUrl: "",
        translations: { fr: { name: "Velouté de tomate rôtie", description: "Velouté au basilic." } },
      },
    ],
  },
  {
    id: "course-3",
    order: 3,
    name: "Soup",
    description: "Comforting seasonal soup",
    required: true,
    active: true,
    options: [
      {
        id: "option-4",
        courseId: "course-3",
        name: "Mushroom Velouté",
        description: "Wild mushrooms and truffle cream.",
        allergens: ["Dairy"],
        active: true,
      },
      {
        id: "option-5",
        courseId: "course-3",
        name: "Carrot Ginger Broth",
        description: "Lightly spiced and aromatic.",
        allergens: ["None"],
        active: true,
      },
    ],
  },
  {
    id: "course-4",
    order: 4,
    name: "Main Course",
    description: "Signature entrée selection",
    required: true,
    active: true,
    options: [
      {
        id: "option-6",
        courseId: "course-4",
        name: "Duck Magret",
        description: "Crisp skin, cherry jus and baby vegetables.",
        allergens: ["Tree Nuts"],
        active: true,
      },
      {
        id: "option-7",
        courseId: "course-4",
        name: "Sea Bream",
        description: "Charred lemon, fennel and saffron.",
        allergens: ["Fish"],
        active: true,
      },
    ],
  },
  {
    id: "course-5",
    order: 5,
    name: "Dessert",
    description: "Classic finishing course",
    required: true,
    active: true,
    options: [
      {
        id: "option-8",
        courseId: "course-5",
        name: "Chocolate Ganache",
        description: "Dark chocolate with cocoa nib crumble.",
        allergens: ["Dairy", "Soy"],
        active: true,
      },
      {
        id: "option-9",
        courseId: "course-5",
        name: "Crème Brûlée",
        description: "Vanilla bean custard with caramel top.",
        allergens: ["Dairy"],
        active: true,
      },
    ],
  },
  {
    id: "course-6",
    order: 6,
    name: "Petit Four",
    description: "A final sweet finish",
    required: true,
    active: true,
    options: [
      {
        id: "option-10",
        courseId: "course-6",
        name: "Chef's Selection",
        description: "A sweet end curated by the kitchen.",
        allergens: ["Gluten"],
        active: true,
      },
    ],
  },
];

const reservations: ReservationRecord[] = [];

export function getMockRestaurantDates() {
  return restaurantDates.map((date) => ({ ...date }));
}

export function getMockMenuCatalog() {
  return mockMenu.map((course) => ({
    ...course,
    options: course.options.map((option) => ({ ...option })),
  }));
}

export function updateMockMenuCatalog(nextMenu: MenuCourse[]) {
  for (let index = 0; index < mockMenu.length; index += 1) {
    mockMenu[index] = { ...mockMenu[index], ...nextMenu[index] };
    if (nextMenu[index]?.options) {
      mockMenu[index].options = nextMenu[index].options.map((option) => ({ ...option }));
    }
  }
  return getMockMenuCatalog();
}

export function getMockRestaurantDate(date: string) {
  return restaurantDates.find((entry) => entry.date === date) ?? null;
}

export function upsertMockRestaurantDate(date: RestaurantDateAvailability) {
  const matchIndex = restaurantDates.findIndex((entry) => entry.date === date.date);
  if (matchIndex === -1) {
    restaurantDates.push({ ...date });
    return { ...date };
  }

  restaurantDates[matchIndex] = { ...restaurantDates[matchIndex], ...date };
  restaurantDates[matchIndex].remainingSeats = Math.max(
    restaurantDates[matchIndex].capacity - restaurantDates[matchIndex].reservedSeats,
    0,
  );
  return { ...restaurantDates[matchIndex] };
}

export function addMockReservation(record: ReservationRecord) {
  reservations.push({ ...record });
  return { ...record };
}

export function getMockReservation(reservationNumber: string) {
  return reservations.find((reservation) => reservation.reservationNumber === reservationNumber) ?? null;
}

export function updateMockReservation(reservationNumber: string, updates: Partial<ReservationRecord>) {
  const index = reservations.findIndex((reservation) => reservation.reservationNumber === reservationNumber);
  if (index === -1) {
    return null;
  }

  reservations[index] = { ...reservations[index], ...updates };
  return { ...reservations[index] };
}

export function getMockReservationList() {
  return reservations.map((reservation) => ({ ...reservation }));
}

export function getMockStoreStatus() {
  return {
    availableDates: restaurantDates,
    reservationCount: reservations.length,
  };
}
