import { unstable_cache } from "next/cache";
import { getMenuCatalog } from "@/lib/services/restaurant";

/** Everything cached from the menu is dropped together, under this name. */
export const MENU_CACHE_TAG = "menu-catalog";

/**
 * The guest-facing catalogue, held between requests.
 *
 * Every route in this app renders per request and cannot do otherwise: the
 * root layout settles the language from a cookie. So the menu screen will
 * always be built fresh — but it does not have to ask the database for the
 * same unchanged catalogue every time, in front of a guest who is waiting to
 * see it. Almost every guest here is a first and only visit, so that query sat
 * in front of the whole page for practically all of them.
 *
 * The untranslated catalogue is what is cached, which is also what the page
 * sends: it is localized in the browser, so one cached copy serves every
 * language.
 *
 * Freshness comes from the tag rather than the clock — publishing a menu drops
 * this — and the window is only a backstop for a change that reaches the
 * database some other way, such as a restore or an edit made against Atlas
 * directly.
 *
 * Deliberately kept out of `restaurant.ts`. `unstable_cache` throws where no
 * incremental cache exists, which is every test that reads the catalogue
 * directly, and a service that can only be called from inside a Next server is
 * a worse service. Caching is a decision about one screen, so it lives at the
 * edge of that screen.
 */
export const getCachedMenuCatalog = unstable_cache(() => getMenuCatalog(), ["guest-menu-catalog"], {
  tags: [MENU_CACHE_TAG],
  revalidate: 300,
});
