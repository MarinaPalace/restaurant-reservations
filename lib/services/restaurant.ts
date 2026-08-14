import { getLocalDate, getLocalDates, getLocalMenu, saveLocalMenu } from "@/lib/db/local-store";
import { connectToDatabase, isMongoConfigured } from "@/lib/db/connect";
import { MenuCourseModel } from "@/lib/models/menu-course";
import { MenuOptionModel } from "@/lib/models/menu-option";
import { RestaurantDateModel } from "@/lib/models/restaurant-date";
import { localizeMenuCatalog } from "@/lib/menu-localization";
import { decodeStoredImage, isStoredImage, toPublicImageUrl } from "@/lib/menu-images";
import {
  withRemainingSeats,
  type MenuCourse,
  type MenuOption,
  type RestaurantDateAvailability,
} from "@/types/booking";

export async function getRestaurantDates(): Promise<RestaurantDateAvailability[]> {
  if (!isMongoConfigured()) {
    return getLocalDates();
  }

  await connectToDatabase();
  const dates = await RestaurantDateModel.find().sort({ date: 1 }).lean();

  return dates.map((date) =>
    withRemainingSeats({
      date: String(date.date),
      isOpen: Boolean(date.isOpen),
      capacity: Number(date.capacity),
      reservedSeats: Number(date.reservedSeats),
      serviceTime: date.serviceTime ? String(date.serviceTime) : undefined,
      serviceEndTime: date.serviceEndTime ? String(date.serviceEndTime) : undefined,
    }),
  );
}

export async function getRestaurantDate(date: string): Promise<RestaurantDateAvailability | null> {
  if (!isMongoConfigured()) {
    return getLocalDate(date);
  }

  await connectToDatabase();
  const record = await RestaurantDateModel.findOne({ date }).lean();
  if (!record) {
    return null;
  }

  return withRemainingSeats({
    date: String(record.date),
    isOpen: Boolean(record.isOpen),
    capacity: Number(record.capacity),
    reservedSeats: Number(record.reservedSeats),
    serviceTime: record.serviceTime ? String(record.serviceTime) : undefined,
    serviceEndTime: record.serviceEndTime ? String(record.serviceEndTime) : undefined,
  });
}

type MongoDocument = Record<string, unknown>;

function toMenuOption(option: MongoDocument): MenuOption {
  return {
    id: String(option._id),
    courseId: String(option.courseId),
    name: String(option.name),
    description: String(option.description ?? ""),
    allergens: Array.isArray(option.allergens) ? option.allergens.map(String) : [],
    active: Boolean(option.active),
    imageUrl: typeof option.imageUrl === "string" ? option.imageUrl : "",
    ingredients: typeof option.ingredients === "string" ? option.ingredients : "",
    vegan: Boolean(option.vegan),
    translations: (option.translations as MenuCourse["translations"]) ?? {},
  };
}

function toMenuCourse(course: MongoDocument, options: MongoDocument[]): MenuCourse {
  return {
    id: String(course._id),
    order: Number(course.order),
    name: String(course.name),
    description: String(course.description ?? ""),
    required: Boolean(course.required),
    active: Boolean(course.active),
    imageUrl: typeof course.imageUrl === "string" ? course.imageUrl : "",
    translations: (course.translations as MenuCourse["translations"]) ?? {},
    options: options.filter((option) => String(option.courseId) === String(course._id)).map(toMenuOption),
  };
}

/**
 * The full catalogue including inactive entries — for the admin editor, which
 * has to be able to see and re-enable what it switched off.
 */
export async function getFullMenuCatalog(): Promise<MenuCourse[]> {
  if (!isMongoConfigured()) {
    return getLocalMenu();
  }

  await connectToDatabase();
  const courses = await MenuCourseModel.find({}).sort({ order: 1 }).lean();
  const options = await MenuOptionModel.find({}).lean();

  return courses.map((course) => toMenuCourse(course as MongoDocument, options as MongoDocument[]));
}

/**
 * What guests see: active courses and options only, localized.
 *
 * Both this and the admin editor now read the same store, so a saved menu
 * change is immediately visible in the booking flow.
 */
export async function getMenuCatalog(language = "en"): Promise<MenuCourse[]> {
  const catalog = await getFullMenuCatalog();

  const visible = catalog
    .filter((course) => course.active)
    .map((course) => ({
      ...course,
      // Uploaded photos become cacheable URLs rather than inline base64, which
      // keeps this response small even with a picture on every dish.
      imageUrl: toPublicImageUrl(course.id, course.imageUrl),
      options: course.options
        .filter((option) => option.active)
        .map((option) => ({ ...option, imageUrl: toPublicImageUrl(option.id, option.imageUrl) })),
    }))
    .sort((a, b) => a.order - b.order);

  return localizeMenuCatalog(visible, language);
}

/**
 * Finds the bytes behind an uploaded course or option photo.
 *
 * The admin catalogue is used deliberately: it still holds the raw data URLs,
 * whereas the guest catalogue has already had them rewritten to these URLs.
 */
export async function findMenuImage(id: string) {
  const catalog = await getFullMenuCatalog();

  for (const course of catalog) {
    if (course.id === id && isStoredImage(course.imageUrl)) {
      return decodeStoredImage(course.imageUrl as string);
    }

    for (const option of course.options) {
      if (option.id === id && isStoredImage(option.imageUrl)) {
        return decodeStoredImage(option.imageUrl as string);
      }
    }
  }

  return null;
}

/**
 * Saves the menu while preserving existing ids, so reservations that reference
 * a course or option keep pointing at the same item. The previous version
 * deleted the whole collection and re-created it, which orphaned every
 * historical reservation.
 */
export async function saveMenuCatalog(courses: MenuCourse[]): Promise<MenuCourse[]> {
  if (!isMongoConfigured()) {
    return saveLocalMenu(courses);
  }

  await connectToDatabase();

  const keptCourseIds: string[] = [];
  const keptOptionIds: string[] = [];

  for (const course of courses) {
    const courseFields = {
      order: course.order,
      name: course.name,
      description: course.description,
      required: course.required,
      active: course.active,
      imageUrl: course.imageUrl ?? "",
      translations: course.translations ?? {},
    };

    const isExisting = Boolean(course.id) && /^[a-f\d]{24}$/i.test(course.id);
    const savedCourse = isExisting
      ? await MenuCourseModel.findByIdAndUpdate(course.id, courseFields, { returnDocument: "after" })
      : await MenuCourseModel.create(courseFields);

    if (!savedCourse) {
      continue;
    }

    const courseId = String(savedCourse._id);
    keptCourseIds.push(courseId);

    for (const option of course.options ?? []) {
      const optionFields = {
        courseId,
        name: option.name,
        description: option.description,
        allergens: option.allergens ?? [],
        active: option.active,
        imageUrl: option.imageUrl ?? "",
        ingredients: option.ingredients ?? "",
        vegan: option.vegan ?? false,
        translations: option.translations ?? {},
      };

      const isExistingOption = Boolean(option.id) && /^[a-f\d]{24}$/i.test(option.id);
      const savedOption = isExistingOption
        ? await MenuOptionModel.findByIdAndUpdate(option.id, optionFields, { returnDocument: "after" })
        : await MenuOptionModel.create(optionFields);

      if (savedOption) {
        keptOptionIds.push(String(savedOption._id));
      }
    }
  }

  await MenuOptionModel.deleteMany({ _id: { $nin: keptOptionIds } });
  await MenuCourseModel.deleteMany({ _id: { $nin: keptCourseIds } });

  return getFullMenuCatalog();
}
