import { getLocalDate, getLocalDates, getLocalMenu, saveLocalMenu } from "@/lib/db/local-store";
import { connectToDatabase, isMongoConfigured } from "@/lib/db/connect";
import { MenuCourseModel } from "@/lib/models/menu-course";
import { MenuOptionModel } from "@/lib/models/menu-option";
import { RestaurantDateModel } from "@/lib/models/restaurant-date";
import { localizeMenuCatalog } from "@/lib/menu-localization";
import { decodeStoredImage, isStoredImage, toPublicImageUrl } from "@/lib/menu-images";
import { discountedPrice, toCents } from "@/lib/money";
import {
  menuCatalogOf,
  menuKindOf,
  withRemainingSeats,
  type MenuCatalog,
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
    price: toCents(Number(option.price ?? 0)),
    discountPercent: Math.round(Number(option.discountPercent ?? 0)),
    translations: (option.translations as MenuCourse["translations"]) ?? {},
  };
}

function toMenuCourse(course: MongoDocument, options: MongoDocument[]): MenuCourse {
  // `menuCatalogOf` resolves the legacy `addOn` flag, so a course from the
  // first version of promotions reads as a promotions course without anything
  // being written to it.
  const catalog = menuCatalogOf({
    menu: course.menu as MenuCourse["menu"],
    addOn: Boolean(course.addOn),
  });

  return {
    id: String(course._id),
    menu: catalog,
    order: Number(course.order),
    name: String(course.name),
    description: String(course.description ?? ""),
    // A promotion is never compulsory, whatever the stored flag says.
    required: catalog === "promo" ? false : Boolean(course.required),
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
/**
 * Absent reads as the everyday menu, so older courses need no migration. Both
 * are defined in `types/booking.ts` — the dashboard needs them in the browser,
 * and this module pulls in Mongoose — and re-exported here for existing
 * callers.
 */
export { menuCatalogOf, menuKindOf };

export async function getFullMenuCatalog(menu?: MenuCatalog): Promise<MenuCourse[]> {
  const all = await loadFullCatalog();
  return menu ? all.filter((course) => menuCatalogOf(course) === menu) : all;
}

async function loadFullCatalog(): Promise<MenuCourse[]> {
  if (!isMongoConfigured()) {
    // The local store keeps whatever was written to it, so the legacy `addOn`
    // flag is resolved on the way out here too.
    const courses = await getLocalMenu();
    return courses.map((course) => ({
      ...course,
      menu: menuCatalogOf(course),
      required: menuCatalogOf(course) === "promo" ? false : course.required,
    }));
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
export async function getMenuCatalog(language = "en", menu: MenuCatalog = "standard"): Promise<MenuCourse[]> {
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
 * The promotions a guest may be offered, in their language.
 *
 * Separate from `getMenuCatalog("…", "promo")` by one rule: a group with
 * nothing left in it is dropped. An empty group renders as a heading with no
 * choices under it, which reads as a page that failed to load — and it happens
 * naturally, when the last bottle in a group is switched off for the season.
 *
 * Both the confirmation screen and the route that saves a choice read through
 * here, so the two can never disagree about what was on offer.
 */
export async function getPromoCatalog(language = "en"): Promise<MenuCourse[]> {
  const catalog = await getMenuCatalog(language, "promo");
  return catalog.filter((course) => course.options.length > 0);
}

/**
 * What a promotion costs, worked out from the catalogue rather than from
 * anything the browser sent.
 *
 * The client is shown a price and computes the same figure to display, but the
 * figure that is stored is this one — for the same reason dish names are
 * resolved by id (rule 2.6): a request can otherwise claim its own discount.
 */
export function priceOfPromoOption(option: Pick<MenuOption, "price" | "discountPercent">) {
  const price = toCents(Math.max(0, Number(option.price ?? 0)));
  const discountPercent = Math.min(100, Math.max(0, Math.round(Number(option.discountPercent ?? 0))));

  return { price, discountPercent, finalPrice: discountedPrice(price, discountPercent) };
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
export function draftMenuCopy(courses: MenuCourse[], menu: MenuCatalog): MenuCourse[] {
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
  menu: MenuCatalog,
): Promise<{ courses: MenuCourse[]; isDraft: boolean }> {
  const courses = await getFullMenuCatalog(menu);

  // Only the premium menu opens as a copy. An empty promotions catalogue opens
  // blank on purpose: a wine list seeded with the starters would have to be
  // emptied before it could be filled.
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
export async function saveMenuCatalog(
  courses: MenuCourse[],
  menu: MenuCatalog = "standard",
): Promise<MenuCourse[]> {
  /**
   * Each catalogue is saved on its own; the editor only ever sends one of
   * them, and the other two must survive untouched.
   *
   * `addOn: false` is written on every course, not just promotions. It is how
   * the legacy flag is retired: a course the first version marked `addOn` is
   * read as a promotions course, appears in the promotions editor, and the
   * first save there writes `menu: "promo"` and clears the flag. Leaving it set
   * would mean a course matching both the promotions filter and — once `menu`
   * said otherwise — nothing at all.
   */
  const tagged = courses.map((course) => ({
    ...course,
    menu,
    addOn: false,
    // A promotion nobody may decline is not a promotion. Forced here rather
    // than trusted from the client, which is also where the editor hides the
    // checkbox.
    required: menu === "promo" ? false : course.required,
  }));

  if (!isMongoConfigured()) {
    const others = (await getLocalMenu()).filter((course) => menuCatalogOf(course) !== menu);
    const saved = await saveLocalMenu([...others, ...tagged]);
    return saved.filter((course) => menuCatalogOf(course) === menu);
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
      addOn: false,
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
        // Only promotions are priced, and a price that survived being moved
        // out of the promotions catalogue would be charged for a dinner course
        // nobody agreed to pay for.
        price: menu === "promo" ? toCents(Math.max(0, Number(option.price ?? 0))) : 0,
        discountPercent:
          menu === "promo" ? Math.min(100, Math.max(0, Math.round(Number(option.discountPercent ?? 0)))) : 0,
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
   * Pruning is scoped to this catalogue. Courses in the other two have ids that
   * are not in `keptCourseIds`, and deleting by that alone would wipe them —
   * which is rule 2.3, and the bug it is named after.
   *
   * The everyday filter is the awkward one, and it is awkward for a reason:
   * "standard" is the *absence* of a marking, so it cannot be matched by
   * equality. It is everything not marked premium, not marked promo, and not
   * carrying the legacy `addOn` flag — because a course flagged that way is
   * read as a promotion everywhere else, and a filter that disagreed would
   * delete it the next time the everyday menu was saved.
   */
  const menuFilter: Record<string, unknown> =
    menu === "premium"
      ? { menu: "premium" }
      : menu === "promo"
        ? { $or: [{ menu: "promo" }, { addOn: true }] }
        : { menu: { $nin: ["premium", "promo"] }, addOn: { $ne: true } };

  const survivingCourses = await MenuCourseModel.find(menuFilter).select("_id").lean();
  const survivingIds = survivingCourses.map((course) => String(course._id));

  await MenuCourseModel.deleteMany({ ...menuFilter, _id: { $nin: keptCourseIds } });
  await MenuOptionModel.deleteMany({
    courseId: { $in: survivingIds.filter((id) => !keptCourseIds.includes(id)) },
  });
  await MenuOptionModel.deleteMany({ courseId: { $in: keptCourseIds }, _id: { $nin: keptOptionIds } });

  return getFullMenuCatalog(menu);
}
