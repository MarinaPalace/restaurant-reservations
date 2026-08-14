/**
 * House identity in one place, so renaming the restaurant is a single edit
 * rather than a search across the app.
 */
export const RESTAURANT_NAME = "Vista Del Mar";

export const RESTAURANT_TAGLINE = "Restaurant";

/**
 * Prefix for newly issued reservation numbers. Numbers issued under an older
 * prefix keep working — lookup is an exact string match and nothing parses
 * this out again.
 */
export const RESERVATION_PREFIX = "VDM";
