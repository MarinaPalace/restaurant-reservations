import type { MenuCourse, StoredRestaurantDate } from "@/types/booking";

export const DEFAULT_MENU: MenuCourse[] = [
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
        translations: {
          fr: { name: "Saumon mariné aux agrumes", description: "Servi avec aneth et échalote confite." },
        },
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
    imageUrl: "",
    translations: {},
    options: [
      {
        id: "option-4",
        courseId: "course-3",
        name: "Mushroom Velouté",
        description: "Wild mushrooms and truffle cream.",
        allergens: ["Dairy"],
        active: true,
        imageUrl: "",
        translations: {},
      },
      {
        id: "option-5",
        courseId: "course-3",
        name: "Carrot Ginger Broth",
        description: "Lightly spiced and aromatic.",
        allergens: [],
        active: true,
        imageUrl: "",
        translations: {},
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
    imageUrl: "",
    translations: {},
    options: [
      {
        id: "option-6",
        courseId: "course-4",
        name: "Duck Magret",
        description: "Crisp skin, cherry jus and baby vegetables.",
        allergens: ["Tree Nuts"],
        active: true,
        imageUrl: "",
        translations: {},
      },
      {
        id: "option-7",
        courseId: "course-4",
        name: "Sea Bream",
        description: "Charred lemon, fennel and saffron.",
        allergens: ["Fish"],
        active: true,
        imageUrl: "",
        translations: {},
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
    imageUrl: "",
    translations: {},
    options: [
      {
        id: "option-8",
        courseId: "course-5",
        name: "Chocolate Ganache",
        description: "Dark chocolate with cocoa nib crumble.",
        allergens: ["Dairy", "Soy"],
        active: true,
        imageUrl: "",
        translations: {},
      },
      {
        id: "option-9",
        courseId: "course-5",
        name: "Crème Brûlée",
        description: "Vanilla bean custard with caramel top.",
        allergens: ["Dairy"],
        active: true,
        imageUrl: "",
        translations: {},
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
    imageUrl: "",
    translations: {},
    options: [
      {
        id: "option-10",
        courseId: "course-6",
        name: "Chef's Selection",
        description: "A sweet end curated by the kitchen.",
        allergens: ["Gluten"],
        active: true,
        imageUrl: "",
        translations: {},
      },
    ],
  },
];

/**
 * Seed availability is generated relative to today so a fresh checkout always
 * has bookable evenings, rather than the hardcoded 2026 dates that silently
 * expire.
 */
export function buildDefaultDates(now = new Date()): StoredRestaurantDate[] {
  return Array.from({ length: 30 }, (_, offset) => {
    const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset, 12);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");

    return {
      date: `${year}-${month}-${day}`,
      // The restaurant is closed on Mondays.
      isOpen: date.getDay() !== 1,
      capacity: 40,
      reservedSeats: 0,
    };
  });
}
