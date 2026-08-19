import { getLocalDate, getLocalDates, getLocalMenu, saveLocalMenu } from "@/lib/db/local-store";
import { connectToDatabase, isMongoConfigured } from "@/lib/db/connect";
import { MenuCourseModel } from "@/lib/models/menu-course";
import { MenuOptionModel } from "@/lib/models/menu-option";
import { RestaurantDateModel } from "@/lib/models/restaurant-date";
import { localizeMenuCatalog } from "@/lib/menu-localization";
import { decodeStoredImage, isStoredImage, toPublicImageUrl } from "@/lib/menu-images";
import {
  menuKindOf,
  withRemainingSeats,
  type MenuCourse,
  type MenuKind,
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
      premium: Boolean(date.premium),
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
    premium: Boolean(record.premium),
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
    price: Number(option.price ?? 0),
    discountPercent: Number(option.discountPercent ?? 0),
    translations: (option.translations as MenuCourse["translations"]) ?? {},
  };
}

function toMenuCourse(course: MongoDocument, options: MongoDocument[]): MenuCourse {
  return {
    id: String(course._id),
    menu: course.menu === "premium" ? "premium" : "standard",
    order: Number(course.order),
    name: String(course.name),
    description: String(course.description ?? ""),
    required: Boolean(course.required),
    active: Boolean(course.active),
    addOn: Boolean(course.addOn),
    imageUrl: typeof course.imageUrl === "string" ? course.imageUrl : "",
    translations: (course.translations as MenuCourse["translations"]) ?? {},
    options: options.filter((option) => String(option.courseId) === String(course._id)).map(toMenuOption),
  };
}

/**
 * The full catalogue including inactive entries — for the admin editor, which
 * has to be able to see and re-enable what it switched off.
 */
/**
 * Absent reads as the everyday menu, so older courses need no migration. It is
 * defined in `types/booking.ts` — the dashboard needs it in the browser, and
 * this module pulls in Mongoose — and re-exported here for existing callers.
 */
export { menuKindOf };

export async function getFullMenuCatalog(menu?: MenuKind): Promise<MenuCourse[]> {
  const all = await loadFullCatalog();
  return menu ? all.filter((course) => menuKindOf(course) === menu) : all;
}

async function loadFullCatalog(): Promise<MenuCourse[]> {
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
export async function getMenuCatalog(language = "en", menu: MenuKind = "standard"): Promise<MenuCourse[]> {
  const catalog = await getFullMenuCatalog(menu);

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
 * A copy of the everyday menu, as an unsaved draft, for filling the premium
 * catalogue the first time.
 *
 * Every id is dropped and replaced with a `draft-` one. That is the whole
 * point: the two catalogues must never share an id, or editing a premium dish
 * would silently rewrite the everyday one, and a reservation's `optionId`
 * would no longer say which menu it came from. `saveMenuCatalog` mints real
 * ids for `draft-` entries on save.
 *
 * Nothing is written here. The editor shows the copy, the person adjusts it,
 * and it exists only once they press save — so opening the page to look does
 * not create a menu nobody asked for.
 */
export function draftMenuCopy(courses: MenuCourse[], menu: MenuKind): MenuCourse[] {
  return courses.map((course, courseIndex) => {
    const courseId = `draft-course-${courseIndex + 1}`;

    return {
      ...course,
      id: courseId,
      menu,
      options: (course.options ?? []).map((option, optionIndex) => ({
        ...option,
        id: `draft-option-${courseIndex + 1}-${optionIndex + 1}`,
        courseId,
      })),
    };
  });
}

/**
 * What the premium editor opens with.
 *
 * An empty premium catalogue starts as a copy of the everyday menu rather than
 * a blank page, because the two are mostly the same and typing the whole thing
 * out again is how they drift apart. `isDraft` tells the editor to say so.
 */
export async function getMenuCatalogForEditing(
  menu: MenuKind,
): Promise<{ courses: MenuCourse[]; isDraft: boolean }> {
  const courses = await getFullMenuCatalog(menu);

  if (courses.length > 0 || menu !== "premium") {
    return { courses, isDraft: false };
  }

  const standard = await getFullMenuCatalog("standard");

  if (standard.length === 0) {
    return { courses: [], isDraft: false };
  }

  return { courses: draftMenuCopy(standard, "premium"), isDraft: true };
}

/**
 * Saves the menu while preserving existing ids, so reservations that reference
 * a course or option keep pointing at the same item. The previous version
 * deleted the whole collection and re-created it, which orphaned every
 * historical reservation.
 */
export async function saveMenuCatalog(courses: MenuCourse[], menu: MenuKind = "standard"): Promise<MenuCourse[]> {
  // Each menu is saved on its own; the editor only ever sends one of them,
  // and the other must survive untouched.
  const tagged = courses.map((course) => ({ ...course, menu }));

  if (!isMongoConfigured()) {
    const others = (await getLocalMenu()).filter((course) => menuKindOf(course) !== menu);
    const saved = await saveLocalMenu([...others, ...tagged]);
    return saved.filter((course) => menuKindOf(course) === menu);
  }

  await connectToDatabase();

  const keptCourseIds: string[] = [];
  const keptOptionIds: string[] = [];

  for (const course of tagged) {
    const courseFields = {
      menu,
      order: course.order,
      name: course.name,
      description: course.description,
      required: course.required,
      active: course.active,
      addOn: Boolean(course.addOn),
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
        price: Math.max(0, Number(option.price ?? 0)),
        discountPercent: Math.min(100, Math.max(0, Number(option.discountPercent ?? 0))),
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

  /**
   * Pruning is scoped to this menu. Courses on the other menu have ids that are
   * not in `keptCourseIds`, and deleting by that alone would wipe them.
   */
  const menuFilter = menu === "standard" ? { menu: { $ne: "premium" } } : { menu: "premium" };
  const survivingCourses = await MenuCourseModel.find(menuFilter).select("_id").lean();
  const survivingIds = survivingCourses.map((course) => String(course._id));

  await MenuCourseModel.deleteMany({ ...menuFilter, _id: { $nin: keptCourseIds } });
  await MenuOptionModel.deleteMany({
    courseId: { $in: survivingIds.filter((id) => !keptCourseIds.includes(id)) },
  });
  await MenuOptionModel.deleteMany({ courseId: { $in: keptCourseIds }, _id: { $nin: keptOptionIds } });

  return getFullMenuCatalog(menu);
}
