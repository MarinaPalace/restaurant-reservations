import {
  DEFAULT_FLOOR_PLAN_MODE,
  isFloorPlanMode,
  resolveFloorPlanMode,
  type FloorPlan,
  type FloorPlanMode,
} from "@/lib/floor-plan";

/**
 * What is switched on for one evening — `docs/evening-features.md`.
 *
 * ## Why an evening and not only the restaurant
 *
 * The restaurant-wide settings say what the place normally does. They are the
 * wrong grain for two ordinary things:
 *
 * - **Trying something out.** A new feature wants one future date to itself —
 *   a date nobody else can see, reachable only by a pass-key written for it —
 *   before it is turned on for every guest who books tonight. Without this the
 *   only way to test is to switch the whole restaurant on and hope.
 * - **Thursday is not Saturday.** A quiet evening with one waiter may not want
 *   guests picking their own table; a private hire may not want the promotions
 *   screen at all. That is a decision per evening, not a policy.
 *
 * ## Absent means inherit, and that is the whole safety argument
 *
 * An evening stores **only what it says differently**. A field that is absent
 * is not "off" — it is "whatever the restaurant says", resolved at read time so
 * that changing the restaurant-wide setting moves every evening that never
 * disagreed with it.
 *
 * Which is why **every date that already exists is untouched**: none of them
 * carry overrides, so all of them resolve to exactly the defaults, and the
 * defaults are exactly what the app did before this module existed —
 * promotions on, self-service on, table selection off. A restaurant that never
 * opens this screen must not be able to tell it was built.
 */

export const EVENING_FEATURES = ["tableSelection", "promotions", "selfService"] as const;
export type EveningFeature = (typeof EVENING_FEATURES)[number];

/**
 * What the restaurant does when an evening does not say otherwise.
 *
 * `promotions` and `selfService` default to **on** because that is what the app
 * has always done, and `tableSelection` to **off** for the same reason. The
 * defaults are not a policy anybody chose; they are the app as it was, written
 * down so that inheriting cannot change behaviour.
 */
export type EveningDefaults = {
  tableSelection: FloorPlanMode;
  promotions: boolean;
  selfService: boolean;
};

/**
 * The two that had no restaurant-wide setting before this.
 *
 * Table selection is deliberately **not** here: it already has its own stored
 * key (`restaurant.floorPlanMode`, `docs/floor-plan.md` §4) and rule 2.2 says
 * schema changes are additive, never renames. Moving it into a new document to
 * make this type tidier would be a migration bought with nothing.
 */
export type EveningToggles = Pick<EveningDefaults, "promotions" | "selfService">;

export const DEFAULT_EVENING_TOGGLES: EveningToggles = { promotions: true, selfService: true };

export const DEFAULT_EVENING_DEFAULTS: EveningDefaults = {
  tableSelection: DEFAULT_FLOOR_PLAN_MODE,
  ...DEFAULT_EVENING_TOGGLES,
};

/**
 * What one evening says differently. **An absent field inherits.**
 *
 * Three states per switch, not two: on, off, and "whatever the restaurant
 * says". A boolean could not tell the third from the second, and an evening
 * that had been silently pinned to today's default would stop following the
 * setting the moment somebody changed it — which is the bug this shape exists
 * to make unrepresentable.
 */
export type EveningOverrides = {
  tableSelection?: FloorPlanMode;
  promotions?: boolean;
  selfService?: boolean;
};

/** What is actually true for an evening, once everything has been resolved. */
export type EveningFeatures = EveningDefaults;

export const EVENING_FEATURE_LABELS: Record<EveningFeature, string> = {
  tableSelection: "Guests choose a table",
  promotions: "Promotions",
  selfService: "Guests manage their own booking",
};

export const EVENING_FEATURE_DESCRIPTIONS: Record<EveningFeature, string> = {
  tableSelection: "Whether guests are shown the room and may pick where they sit.",
  promotions: "The wine and extras offered on the confirmation screen. Staff can always add one afterwards.",
  selfService: "Whether a guest may change or cancel their own booking, or has to telephone reception.",
};

/* ------------------------------------------------------------------ *
 * Reading what was stored
 * ------------------------------------------------------------------ */

function asBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

/**
 * A stored value read back as overrides, whatever it turns out to be.
 *
 * The same contract as `toFloorPlan` and `toFloorPlanMode`: nothing throws, and
 * anything unrecognisable becomes **absent** rather than a guess. Absent is
 * inherit, so the failure mode of an unreadable evening is that it behaves like
 * the restaurant — which is the only safe direction. A guess would be an
 * evening quietly running a policy nobody set.
 *
 * An evening that says nothing comes back `undefined` rather than as an empty
 * object, so "follows the restaurant" has exactly one representation.
 */
export function toEveningOverrides(value: unknown): EveningOverrides | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const source = value as Record<string, unknown>;

  const overrides: EveningOverrides = {
    tableSelection: isFloorPlanMode(source.tableSelection) ? source.tableSelection : undefined,
    promotions: asBoolean(source.promotions),
    selfService: asBoolean(source.selfService),
  };

  return hasOverrides(overrides) ? stripAbsent(overrides) : undefined;
}

/** Drops the keys that are merely absent, so a stored evening is only what it says. */
function stripAbsent(overrides: EveningOverrides): EveningOverrides {
  return Object.fromEntries(
    Object.entries(overrides).filter(([, value]) => value !== undefined),
  ) as EveningOverrides;
}

export function hasOverrides(overrides: EveningOverrides | undefined): boolean {
  return Boolean(
    overrides &&
      (overrides.tableSelection !== undefined ||
        overrides.promotions !== undefined ||
        overrides.selfService !== undefined),
  );
}

/** The restaurant-wide half that lives in its own document. Unreadable reads as the default. */
export function toEveningToggles(value: unknown): EveningToggles {
  if (!value || typeof value !== "object") {
    return { ...DEFAULT_EVENING_TOGGLES };
  }

  const source = value as Record<string, unknown>;

  return {
    promotions: asBoolean(source.promotions) ?? DEFAULT_EVENING_TOGGLES.promotions,
    selfService: asBoolean(source.selfService) ?? DEFAULT_EVENING_TOGGLES.selfService,
  };
}

/* ------------------------------------------------------------------ *
 * Resolving
 * ------------------------------------------------------------------ */

/**
 * The one answer every caller asks for. Nothing reads a stored switch raw.
 *
 * Three things happen here and they have to happen together, which is the
 * reason this is one function rather than three lookups at the call site:
 *
 * 1. The evening's own answer wins where it has one.
 * 2. Everything else inherits the restaurant.
 * 3. Table selection is then put through `resolveFloorPlanMode`, so an evening
 *    set to "guests must choose" against a plan with nothing bookable in it
 *    comes back **off** rather than asking every guest to pick from an empty
 *    room and then refusing them. Saving refuses that case too, but a plan can
 *    be emptied after the evening was set — so it is resolved on every read
 *    and never trusted from the store (`docs/floor-plan.md` §15).
 */
export function resolveEveningFeatures(
  defaults: EveningDefaults,
  overrides: EveningOverrides | undefined,
  plan: FloorPlan,
): EveningFeatures {
  return {
    tableSelection: resolveFloorPlanMode(overrides?.tableSelection ?? defaults.tableSelection, plan),
    promotions: overrides?.promotions ?? defaults.promotions,
    selfService: overrides?.selfService ?? defaults.selfService,
  };
}

/**
 * Which switches this save actually moves.
 *
 * The route uses it to ask for a permission **per switch changed**, rather than
 * one blanket permission for the whole evening. Turning promotions off for a
 * Thursday and deciding that guests pick their own tables are different
 * decisions by different people, and the floor-plan route already says so:
 * whoever prices the wine list has no business turning table selection on.
 *
 * Comparing resolved-to-absent rather than shallow-equal matters, because
 * "inherit" and "happens to equal the default today" are different states and
 * only one of them follows the restaurant afterwards.
 */
export function changedFeatures(
  before: EveningOverrides | undefined,
  after: EveningOverrides | undefined,
): EveningFeature[] {
  return EVENING_FEATURES.filter((feature) => (before?.[feature] ?? null) !== (after?.[feature] ?? null));
}

/**
 * What this evening says differently, in words, for the audit log and the badge
 * on the calendar. Empty when it simply follows the restaurant.
 */
export function describeOverrides(overrides: EveningOverrides | undefined): string[] {
  if (!overrides) {
    return [];
  }

  const said: string[] = [];

  if (overrides.tableSelection !== undefined) {
    said.push(`table selection ${overrides.tableSelection}`);
  }
  if (overrides.promotions !== undefined) {
    said.push(`promotions ${overrides.promotions ? "on" : "off"}`);
  }
  if (overrides.selfService !== undefined) {
    said.push(`guest self-service ${overrides.selfService ? "on" : "off"}`);
  }

  return said;
}
