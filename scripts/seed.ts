import mongoose from "mongoose";
import { connectToDatabase } from "@/lib/db/connect";
import { MenuCourseModel } from "@/lib/models/menu-course";
import { MenuOptionModel } from "@/lib/models/menu-option";
import { RestaurantDateModel } from "@/lib/models/restaurant-date";
import { DEFAULT_MENU, buildDefaultDates } from "@/lib/db/seed-data";

/**
 * Seeds MongoDB from the same definitions the local JSON store uses, so both
 * backends start from an identical menu and set of dates.
 */
async function main() {
  if (!process.env.MONGODB_URI) {
    console.log("MONGODB_URI is not configured; seed skipped.");
    console.log("Without it the app uses the local JSON store, which seeds itself on first run.");
    return;
  }

  await connectToDatabase();

  await MenuOptionModel.deleteMany({});
  await MenuCourseModel.deleteMany({});
  await RestaurantDateModel.deleteMany({});

  for (const course of DEFAULT_MENU) {
    const createdCourse = await MenuCourseModel.create({
      order: course.order,
      name: course.name,
      description: course.description,
      required: course.required,
      active: course.active,
      imageUrl: course.imageUrl ?? "",
      // Previously dropped, which meant a seeded database had no translations.
      translations: course.translations ?? {},
    });

    await MenuOptionModel.insertMany(
      course.options.map((option) => ({
        courseId: String(createdCourse._id),
        name: option.name,
        description: option.description,
        allergens: option.allergens,
        active: option.active,
        imageUrl: option.imageUrl ?? "",
        translations: option.translations ?? {},
      })),
    );
  }

  // Dates are generated relative to today rather than hardcoded, so a seeded
  // database always has bookable evenings.
  await RestaurantDateModel.insertMany(buildDefaultDates());

  console.log(`Seeded ${DEFAULT_MENU.length} courses and 30 days of availability.`);
  await mongoose.disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
