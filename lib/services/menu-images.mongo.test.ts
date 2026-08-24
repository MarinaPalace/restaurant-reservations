import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import mongoose from "mongoose";
import type { MenuCourse, MenuOption } from "@/types/booking";

/**
 * Dish photos are stored on the record as base64 data URLs, which makes the
 * menu documents large and the catalogue expensive to read — and the catalogue
 * is read by almost every page in the app.
 *
 * The rule these protect is simple: **the bytes only move when somebody is
 * actually asking for the picture.** Everything else gets a URL. It is easy to
 * undo by accident, because putting the raw field back changes nothing that is
 * visible on screen — it only makes every page slower.
 *
 * See docs/performance.md §9.
 */

let mongod: MongoMemoryServer;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongod.getUri();
}, 120_000);

afterAll(async () => {
  await mongoose.disconnect();
  await mongod?.stop();
  delete process.env.MONGODB_URI;
});

afterEach(async () => {
  const { collections } = mongoose.connection;
  for (const collection of Object.values(collections)) {
    await collection.deleteMany({});
  }
});

async function loadRestaurant() {
  return import("@/lib/services/restaurant");
}

/** A one-pixel red GIF, as a browser would store an upload. */
const STORED_IMAGE =
  "data:image/gif;base64,R0lGODlhAQABAIAAAP8AAAAAACH5BAAAAAAALAAAAAABAAEAAAICRAEAOw==";

function option(name: string, extra: Partial<MenuOption> = {}): MenuOption {
  return {
    id: "",
    courseId: "",
    name,
    description: "",
    allergens: [],
    active: true,
    imageUrl: "",
    translations: {},
    ...extra,
  };
}

function course(name: string, options: MenuOption[], extra: Partial<MenuCourse> = {}): MenuCourse {
  return {
    id: "",
    order: 1,
    name,
    description: "",
    required: true,
    active: true,
    imageUrl: "",
    translations: {},
    options,
    ...extra,
  };
}

/** A starter whose course and whose dish both carry an uploaded photo. */
async function seedPhotographedMenu() {
  const restaurant = await loadRestaurant();
  await restaurant.saveMenuCatalog(
    [course("Starter", [option("Soup", { imageUrl: STORED_IMAGE })], { imageUrl: STORED_IMAGE })],
    "standard",
  );
  return restaurant;
}

describe("reading the catalogue", () => {
  it("does not carry the image bytes", async () => {
    const restaurant = await seedPhotographedMenu();

    const [dish] = (await restaurant.getFullMenuCatalog("standard"))[0].options;
    const [heading] = await restaurant.getFullMenuCatalog("standard");

    expect(dish.imageUrl ?? "").not.toMatch(/^data:/);
    expect(heading.imageUrl ?? "").not.toMatch(/^data:/);
  });

  it("points at the route that serves the picture, under the record's own id", async () => {
    const restaurant = await seedPhotographedMenu();
    const [heading] = await restaurant.getFullMenuCatalog("standard");

    expect(heading.imageUrl).toContain(`/api/menu/images/${heading.id}`);
    // A version token, so replacing the photo defeats the immutable cache.
    expect(heading.imageUrl).toMatch(/\?v=\d+$/);
  });

  it("leaves an address somebody typed exactly as it was typed", async () => {
    const restaurant = await loadRestaurant();
    await restaurant.saveMenuCatalog(
      [course("Starter", [option("Soup", { imageUrl: "https://example.com/soup.jpg" })])],
      "standard",
    );

    const [dish] = (await restaurant.getFullMenuCatalog("standard"))[0].options;
    expect(dish.imageUrl).toBe("https://example.com/soup.jpg");
  });

  it("reads a dish with no photo as no photo", async () => {
    const restaurant = await loadRestaurant();
    await restaurant.saveMenuCatalog([course("Starter", [option("Soup")])], "standard");

    const [dish] = (await restaurant.getFullMenuCatalog("standard"))[0].options;
    expect(dish.imageUrl).toBe("");
  });

  it("hands the editor an address too — it is a screen, not an exception", async () => {
    const restaurant = await seedPhotographedMenu();

    const { courses } = await restaurant.getMenuCatalogForEditing("standard");

    expect(courses[0].imageUrl).toContain(`/api/menu/images/${courses[0].id}`);
    expect(courses[0].options[0].imageUrl).toContain(
      `/api/menu/images/${courses[0].options[0].id}`,
    );
    expect(courses[0].imageUrl ?? "").not.toMatch(/^data:/);
    expect(courses[0].options[0].imageUrl ?? "").not.toMatch(/^data:/);
  });
});

/**
 * The other half of handing the editor an address: it sends that address back
 * on save, and the photograph has to survive the round trip. Get this wrong and
 * saving a description quietly deletes every picture on the menu.
 */
describe("saving what the editor was given", () => {
  it("keeps the photograph when the address comes back unchanged", async () => {
    const restaurant = await seedPhotographedMenu();
    const { courses } = await restaurant.getMenuCatalogForEditing("standard");

    // Exactly what the editor sends after somebody retitles a course.
    await restaurant.saveMenuCatalog(
      [{ ...courses[0], name: "First course" }],
      "standard",
    );

    const [heading] = await restaurant.getFullMenuCatalog("standard");
    expect(heading.name).toBe("First course");
    expect((await restaurant.findMenuImage(heading.id))?.body.byteLength).toBeGreaterThan(0);
  });

  it("keeps the dish photograph too", async () => {
    const restaurant = await seedPhotographedMenu();
    const { courses } = await restaurant.getMenuCatalogForEditing("standard");

    await restaurant.saveMenuCatalog(
      [
        {
          ...courses[0],
          options: [{ ...courses[0].options[0], description: "Warm" }],
        },
      ],
      "standard",
    );

    const [dish] = (await restaurant.getFullMenuCatalog("standard"))[0].options;
    expect(dish.description).toBe("Warm");
    expect((await restaurant.findMenuImage(dish.id))?.body.byteLength).toBeGreaterThan(0);
  });

  it("replaces the photograph when a new one is uploaded over it", async () => {
    const restaurant = await seedPhotographedMenu();
    const { courses } = await restaurant.getMenuCatalogForEditing("standard");
    const before = await restaurant.findMenuImage(courses[0].id);

    // A one-pixel transparent GIF: a different picture from the seeded red one.
    const replacement =
      "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
    await restaurant.saveMenuCatalog([{ ...courses[0], imageUrl: replacement }], "standard");

    const [heading] = await restaurant.getFullMenuCatalog("standard");
    const after = await restaurant.findMenuImage(heading.id);
    expect(after?.body.equals(before!.body)).toBe(false);
  });

  it("clears the photograph when it is removed", async () => {
    const restaurant = await seedPhotographedMenu();
    const { courses } = await restaurant.getMenuCatalogForEditing("standard");

    await restaurant.saveMenuCatalog([{ ...courses[0], imageUrl: "" }], "standard");

    const [heading] = await restaurant.getFullMenuCatalog("standard");
    expect(heading.imageUrl).toBe("");
    expect(await restaurant.findMenuImage(heading.id)).toBeNull();
  });

  it("copies the bytes when one record's address is saved onto another", async () => {
    const restaurant = await seedPhotographedMenu();
    const { courses } = await restaurant.getMenuCatalogForEditing("standard");

    /*
     * What the premium catalogue does when it opens as a copy of the everyday
     * one: a brand new record carrying the original's address. The two must end
     * up with their own bytes, or replacing the premium photo would silently
     * change the everyday menu.
     */
    await restaurant.saveMenuCatalog(
      [{ ...courses[0], id: "draft-course-1", options: [] }],
      "premium",
    );

    const [copied] = await restaurant.getFullMenuCatalog("premium");
    expect(copied.id).not.toBe(courses[0].id);
    expect((await restaurant.findMenuImage(copied.id))?.body.byteLength).toBeGreaterThan(0);
  });
});

describe("serving one picture", () => {
  it("finds a course photo by its id", async () => {
    const restaurant = await seedPhotographedMenu();
    const [heading] = await restaurant.getFullMenuCatalog("standard");

    const image = await restaurant.findMenuImage(heading.id);

    expect(image?.contentType).toBe("image/gif");
    expect(image?.body.byteLength).toBeGreaterThan(0);
  });

  it("finds a dish photo by its id", async () => {
    const restaurant = await seedPhotographedMenu();
    const [dish] = (await restaurant.getFullMenuCatalog("standard"))[0].options;

    expect((await restaurant.findMenuImage(dish.id))?.contentType).toBe("image/gif");
  });

  it("returns nothing for a dish that has no photo", async () => {
    const restaurant = await loadRestaurant();
    await restaurant.saveMenuCatalog([course("Starter", [option("Soup")])], "standard");
    const [dish] = (await restaurant.getFullMenuCatalog("standard"))[0].options;

    expect(await restaurant.findMenuImage(dish.id)).toBeNull();
  });

  /**
   * The id arrives from the URL, so it can be anything at all. An id that is
   * not an ObjectId must miss rather than throw — a 404 is the right answer,
   * and a 500 would be a way to probe the deployment.
   */
  it("misses quietly on an id that could never match", async () => {
    const restaurant = await loadRestaurant();

    expect(await restaurant.findMenuImage("not-an-object-id")).toBeNull();
    expect(await restaurant.findMenuImage("")).toBeNull();
    expect(await restaurant.findMenuImage("../../etc/passwd")).toBeNull();
  });

  it("misses on a well-formed id that is not in either collection", async () => {
    const restaurant = await loadRestaurant();

    expect(await restaurant.findMenuImage(new mongoose.Types.ObjectId().toString())).toBeNull();
  });
});
