import mongoose from "mongoose";
import { connectToDatabase } from "@/lib/db/connect";
import { MenuCourseModel } from "@/lib/models/menu-course";
import { MenuOptionModel } from "@/lib/models/menu-option";
import { RestaurantDateModel } from "@/lib/models/restaurant-date";

const MENU = [
  {
    order: 1,
    name: "Amuse Bouche",
    description: "Seasonal bite prepared by the chef",
    required: true,
    active: true,
    options: [{ name: "Chef's Selection", description: "The kitchen's curated first bite.", allergens: ["Gluten"], active: true }],
  },
  {
    order: 2,
    name: "Starter",
    description: "A bright and refreshing opening course",
    required: true,
    active: true,
    options: [
      { name: "Citrus Cured Salmon", description: "Served with dill and pickled shallot.", allergens: ["Fish", "Sesame"], active: true },
      { name: "Roasted Tomato Velouté", description: "Silky soup with basil oil.", allergens: ["Dairy"], active: true },
    ],
  },
  {
    order: 3,
    name: "Soup",
    description: "Comforting seasonal soup",
    required: true,
    active: true,
    options: [
      { name: "Mushroom Velouté", description: "Wild mushrooms and truffle cream.", allergens: ["Dairy"], active: true },
      { name: "Carrot Ginger Broth", description: "Lightly spiced and aromatic.", allergens: ["None"], active: true },
    ],
  },
  {
    order: 4,
    name: "Main Course",
    description: "Signature entrée selection",
    required: true,
    active: true,
    options: [
      { name: "Duck Magret", description: "Crisp skin, cherry jus and baby vegetables.", allergens: ["Tree Nuts"], active: true },
      { name: "Sea Bream", description: "Charred lemon, fennel and saffron.", allergens: ["Fish"], active: true },
    ],
  },
  {
    order: 5,
    name: "Dessert",
    description: "Classic finishing course",
    required: true,
    active: true,
    options: [
      { name: "Chocolate Ganache", description: "Dark chocolate with cocoa nib crumble.", allergens: ["Dairy", "Soy"], active: true },
      { name: "Crème Brûlée", description: "Vanilla bean custard with caramel top.", allergens: ["Dairy"], active: true },
    ],
  },
  {
    order: 6,
    name: "Petit Four",
    description: "A final sweet finish",
    required: true,
    active: true,
    options: [{ name: "Chef's Selection", description: "A sweet end curated by the kitchen.", allergens: ["Gluten"], active: true }],
  },
];

const RESTAURANT_DATES = [
  { date: "2026-08-18", isOpen: true, capacity: 40, reservedSeats: 12 },
  { date: "2026-08-19", isOpen: true, capacity: 40, reservedSeats: 24 },
  { date: "2026-08-20", isOpen: false, capacity: 40, reservedSeats: 0 },
  { date: "2026-08-21", isOpen: true, capacity: 40, reservedSeats: 38 },
  { date: "2026-08-22", isOpen: true, capacity: 40, reservedSeats: 40 },
  { date: "2026-08-23", isOpen: true, capacity: 40, reservedSeats: 8 },
];

async function main() {
  if (!process.env.MONGODB_URI) {
    console.log("MONGODB_URI is not configured; seed skipped.");
    return;
  }

  await connectToDatabase();

  await MenuOptionModel.deleteMany({});
  await MenuCourseModel.deleteMany({});
  await RestaurantDateModel.deleteMany({});

  const createdCourses = await Promise.all(
    MENU.map((course) => MenuCourseModel.create({ order: course.order, name: course.name, description: course.description, required: course.required, active: course.active })),
  );

  for (const course of MENU) {
    const createdCourse = createdCourses.find((entry) => entry.name === course.name);
    if (!createdCourse) continue;

    await MenuOptionModel.insertMany(
      course.options.map((option) => ({
        courseId: String(createdCourse._id),
        name: option.name,
        description: option.description,
        allergens: option.allergens,
        active: option.active,
      })),
    );
  }

  await RestaurantDateModel.insertMany(RESTAURANT_DATES.map((date) => ({
    date: date.date,
    isOpen: date.isOpen,
    capacity: date.capacity,
    reservedSeats: date.reservedSeats,
  })));

  console.log("Database seed complete.");
  await mongoose.disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
