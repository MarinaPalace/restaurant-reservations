import { getLocalDate, getLocalDates, getLocalMenu, saveLocalMenu } from "@/lib/db/local-store";
import { isValidObjectId } from "mongoose";
import { connectToDatabase, isMongoConfigured } from "@/lib/db/connect";
import { MenuCourseModel } from "@/lib/models/menu-course";
import { MenuOptionModel } from "@/lib/models/menu-option";
import { RestaurantDateModel } from "@/lib/models/restaurant-date";
import { sweepExpiredHoldsThrottled } from "@/lib/services/seat-holds";
import { localizeMenuCatalog } from "@/lib/menu-localization";
import { decodeStoredImage, isStoredImage, storedImageIdFrom, toPublicImageUrl } from "@/lib/menu-images";
import { discountedPrice, toCents } from "@/lib/money";
import { toEveningOverrides } from "@/lib/evening-features";
import {
  menuCatalogOf,
  menuKindOf,
  withRemainingSeats,
  type MenuCatalog,
  type MenuCourse,
  type MenuOption,
  type RestaurantDateAvailability,
} from "@/types/booking";

/**
 * Every evening, with what is left of it.
 *
 * Sweeps expired seat holds first, so the calendar a guest is looking at counts
 * only seats somebody is actually still choosing. It is the one read that must
 * do this: the calendar is where a guest decides, and an evening greyed out by
 * three abandoned tabs is the same lie as an evening offered with no room in it.
 *
 * Throttled, because this list is read on every page of the flow and by every
 * screen in the dashboard. Seconds of staleness cannot change an answer when a
 * hold lasts fifteen minutes, and the paths that take seats sweep for real.
 *
 * The sweep is deliberately not in `getRestaurantDate`. That one is called on
 * nearly every request in the app, most of them nowhere near a guest choosing a
 * date, and a stale held seat there costs nothing that the next read of this
 * list does not immediately correct.
 */
export async function getRestaurantDates(): Promise<RestaurantDateAvailability[]> {
  await sweepExpiredHoldsThrottled();

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
      bookingCutoffHours: Number(date.bookingCutoffHours ?? 0),
      /**
       * Seats a guest is part-way through taking. Carried, because
       * `withRemainingSeats` subtracts it — leaving it out here does not make
       * the calendar generous, it makes it **wrong**, offering seats somebody
       * is in the middle of booking.
       *
       * This is the trap `readStoredConfirmation` already carries a note about:
       * a reader that whitelists fields silently drops anything added later,
       * and the drop looks exactly like the field not existing.
       */
      heldSeats: Number(date.heldSeats ?? 0),
      /**
       * Dropped here since it was added, on `master` too — the same trap, one
       * field along. Two consequences, both silent: `canGuestChooseTable` saw 0
       * and never closed table selection, and because the admin calendar is
       * seeded from this list and sends every field back on save, the next edit
       * of any field on an evening wrote the cutoff back to 0.
       */
      tableCutoffHours: Number(date.tableCutoffHours ?? 0),
      // Absent stays absent: it is "follow the restaurant", not "off".
      features: toEveningOverrides(date.features),
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
    bookingCutoffHours: Number(record.bookingCutoffHours ?? 0),
    // Carried for the same reason as above: `remainingSeats` is derived from
    // it, and the booking route judges availability on that.
    heldSeats: Number(record.heldSeats ?? 0),
    // And this one, which had been dropped since it was added — see the list
    // reader above for what that cost.
    tableCutoffHours: Number(record.tableCutoffHours ?? 0),
    features: toEveningOverrides(record.features),
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

/**
 * Whether the stored `imageUrl` is an uploaded photo rather than an address
 * somebody typed, decided inside the database so the value need not be read.
 */
const IMAGE_IS_STORED = {
  $eq: [{ $substrCP: [{ $ifNull: ["$imageUrl", ""] }, 0, 5] }, "data:"],
};

/**
 * The cacheable URL for a photo, built in the database from the id and the
 * modification time.
 *
 * Uploaded photos live on the record as base64 data URLs, and the catalogue is
 * read by nearly every page in the app. Reading it the obvious way pulled every
 * one of those pictures out of Mongo and into the function — where
 * `toPublicImageUrl` immediately threw the bytes away and emitted a short URL
 * instead. The response was small; the read behind it was megabytes, and on a
 * deployment whose functions sit on another continent from its database that
 * was the slowest thing in the app by a wide margin. A 31KB page took 72
 * seconds, nearly all of it after the first byte.
 *
 * So the URL is assembled here and the bytes never move. `/api/menu/images`
 * still serves the picture itself, one document at a time.
 *
 * The version token is `updatedAt` rather than a hash of the image, because the
 * image is precisely what is being avoided. It changes whenever the record is
 * saved, which is a superset of when the photo changes — editing a description
 * costs one re-download of an already-cached picture, which nobody will notice.
 */
const PUBLIC_IMAGE_URL = {
  $cond: [
    IMAGE_IS_STORED,
    {
      $concat: [
        "/api/menu/images/",
        { $toString: "$_id" },
        "?v=",
        { $toString: { $toLong: { $ifNull: ["$updatedAt", new Date(0)] } } },
      ],
    },
    { $ifNull: ["$imageUrl", ""] },
  ],
};

/**
 * Never carries image bytes. There is no option to ask for them and that is
 * deliberate: the menu editor was the last caller that did, and reading the
 * photographs in order to throw them away is the exact shape of the bug in
 * docs/performance.md §9. A picture is fetched by asking for the picture.
 */
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

  const [courses, options] = await Promise.all([
    MenuCourseModel.aggregate([{ $sort: { order: 1 } }, { $set: { imageUrl: PUBLIC_IMAGE_URL } }]),
    MenuOptionModel.aggregate([{ $set: { imageUrl: PUBLIC_IMAGE_URL } }]),
  ]);

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
 * This reads the *one* record asked for. It used to load the entire catalogue
 * and scan it, which meant a page showing twenty dishes fetched twenty photos,
 * and each of those twenty requests dragged all twenty pictures out of the
 * database to return one of them — the whole menu moved once per image on the
 * page. That is quadratic in the number of photos and it was happening on the
 * guest booking flow.
 */
export async function findMenuImage(id: string) {
  if (!isMongoConfigured()) {
    // A file read the process already has; scanning it costs nothing. The
    // local store holds the data URLs directly, so they are already here.
    for (const course of await loadFullCatalog()) {
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

  await connectToDatabase();

  // An id that is not an ObjectId cannot match either collection, and asking
  // would throw rather than miss.
  if (!isValidObjectId(id)) {
    return null;
  }

  const stored = await readStoredImageUrl(id);
  return stored ? decodeStoredImage(stored) : null;
}

/**
 * The raw data URL held under an id, or null.
 *
 * A course and an option can never share an id, so the order here is only
 * about which is asked first. `imageUrl` is the sole field read: it is the one
 * field that is large, and these are the only two places that want it — this
 * is what serves a picture, and what copies one from another record.
 */
async function readStoredImageUrl(id: string): Promise<string | null> {
  if (!isValidObjectId(id)) {
    return null;
  }

  for (const model of [MenuCourseModel, MenuOptionModel]) {
    const record = (await model.findById(id).select("imageUrl").lean()) as { imageUrl?: string } | null;

    if (record && isStoredImage(record.imageUrl)) {
      return record.imageUrl as string;
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
  /**
   * The editor gets picture *addresses*, like every other screen.
   *
   * It used to ask for the data URLs, on the grounds that it is the one screen
   * that has to hand the current photo back to the uploader. True, but it does
   * not have to hold the bytes to do that: an `img` pointed at
   * `/api/menu/images/<id>` shows the same picture, and saving sends the
   * address back, which `saveMenuCatalog` reads as "unchanged".
   *
   * Asking for the bytes meant every photograph on the menu — thirty of them,
   * around half a megabyte each, a third larger again as base64 — was read out
   * of the database, serialized into the page, and sent to whoever opened the
   * editor. It is the same read that made the guest-facing menu take 72
   * seconds before `PUBLIC_IMAGE_URL` was introduced; this screen was simply
   * never moved over with it.
   */
  const courses = await getFullMenuCatalog(menu);

  // Only the premium menu opens as a copy. An empty promotions catalogue opens
  // blank on purpose: a wine list seeded with the starters would have to be
  // emptied before it could be filled.
  if (courses.length > 0 || menu !== "premium") {
    return { courses, isDraft: false };
  }

  // Also addresses; the copy resolves them to real bytes when it is saved, so
  // the two catalogues never share a photograph either could later replace.
  const standard = await getFullMenuCatalog("standard");

  if (standard.length === 0) {
    return { courses: [], isDraft: false };
  }

  return { courses: draftMenuCopy(standard, "premium"), isDraft: true };
}

/**
 * What to write for `imageUrl`, given what the editor sent back.
 *
 * The editor is handed `/api/menu/images/<id>` rather than the bytes, so most
 * saves carry a reference to a photograph that is already stored. Three cases:
 *
 * - **A reference to this same record** — the photo was not touched. Nothing is
 *   written at all: the field is left off the update, so the stored bytes stay
 *   where they are and never travel in either direction. This is the ordinary
 *   case, and it is the whole point.
 * - **A reference to a different record** — the premium catalogue opening as a
 *   copy of the everyday one. The photo has to be read once and written onto
 *   the new record, because the two must not share bytes that either could
 *   later replace.
 * - **Anything else** — a fresh upload, an address typed by staff, or an empty
 *   string clearing the picture. Written as given.
 *
 * A reference that resolves to nothing leaves the field alone rather than
 * clearing it. Losing a photograph is worse than keeping one that a broken
 * link failed to describe.
 */
async function imageUpdateFor(
  incoming: string | undefined,
  ownId: string,
): Promise<{ imageUrl?: string }> {
  const referenced = storedImageIdFrom(incoming);

  if (!referenced) {
    return { imageUrl: incoming ?? "" };
  }

  if (referenced === ownId) {
    return {};
  }

  const copied = await readStoredImageUrl(referenced);
  return copied ? { imageUrl: copied } : {};
}

/**
 * The same question for the local JSON store, which holds the data URLs
 * directly and can answer it without reading anything.
 */
function localImageUpdateFor(
  incoming: string | undefined,
  ownId: string,
  stored: Map<string, string>,
): string {
  const referenced = storedImageIdFrom(incoming);

  if (!referenced) {
    return incoming ?? "";
  }

  return stored.get(referenced) ?? stored.get(ownId) ?? "";
}

/** Every image the local store currently holds, by the id holding it. */
async function localImagesById(): Promise<Map<string, string>> {
  const stored = new Map<string, string>();

  for (const course of await getLocalMenu()) {
    if (course.imageUrl) {
      stored.set(course.id, course.imageUrl);
    }

    for (const option of course.options ?? []) {
      if (option.imageUrl) {
        stored.set(option.id, option.imageUrl);
      }
    }
  }

  return stored;
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
    const stored = await localImagesById();
    const others = (await getLocalMenu()).filter((course) => menuCatalogOf(course) !== menu);
    const resolved = tagged.map((course) => ({
      ...course,
      imageUrl: localImageUpdateFor(course.imageUrl, course.id, stored),
      options: (course.options ?? []).map((option) => ({
        ...option,
        imageUrl: localImageUpdateFor(option.imageUrl, option.id, stored),
      })),
    }));
    const saved = await saveLocalMenu([...others, ...resolved]);
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
      ...(await imageUpdateFor(course.imageUrl, course.id)),
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
        ...(await imageUpdateFor(option.imageUrl, option.id)),
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

  /**
   * Addresses, not bytes. The editor replaces its state with whatever comes
   * back, so returning the data URLs meant every photograph on the menu made
   * the round trip a second time — up in the save and down again in its reply,
   * for pictures the person had not touched.
   */
  return getFullMenuCatalog(menu);
}
