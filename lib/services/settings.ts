import { connectToDatabase, isMongoConfigured } from "@/lib/db/connect";
import { getLocalSetting, setLocalSetting } from "@/lib/db/local-admin-store";
import { AppSettingModel } from "@/lib/models/app-setting";
import { DEFAULT_CURRENCY, toCurrency, type Currency } from "@/lib/money";
import { DEFAULT_TIME_ZONE, toTimeZone, type TimeZone } from "@/lib/timezone";
import {
  DEFAULT_FLOOR_PLAN_MODE,
  EMPTY_PLAN,
  resolveFloorPlanMode,
  toFloorPlan,
  toFloorPlanMode,
  type FloorPlan,
  type FloorPlanMode,
} from "@/lib/floor-plan";

/**
 * Settings the restaurant can change without a deploy.
 *
 * There is exactly one so far. It is a store rather than an environment
 * variable because the person who decides what currency the wine list is
 * quoted in works at reception, not on the deployment, and an environment
 * variable is only changeable by whoever holds the hosting account.
 *
 * Every setting reads through a `get…` that supplies its own default, so a
 * store with nothing in it — a fresh install, or a database that has never
 * seen this key — behaves exactly like one holding the default.
 */

const CURRENCY_KEY = "promo.currency";
const TIME_ZONE_KEY = "restaurant.timeZone";
const FLOOR_PLAN_KEY = "restaurant.floorPlan";
const FLOOR_PLAN_MODE_KEY = "restaurant.floorPlanMode";

async function readSetting(key: string): Promise<unknown> {
  if (!isMongoConfigured()) {
    return getLocalSetting(key);
  }

  await connectToDatabase();
  const row = await AppSettingModel.findOne({ key }).lean();
  return (row as { value?: unknown } | null)?.value;
}

async function writeSetting(key: string, value: unknown): Promise<void> {
  if (!isMongoConfigured()) {
    await setLocalSetting(key, value);
    return;
  }

  await connectToDatabase();
  await AppSettingModel.updateOne({ key }, { $set: { value } }, { upsert: true });
}

/** What promotion prices are quoted in. Anything unrecognised reads as the default. */
export async function getCurrency(): Promise<Currency> {
  try {
    return toCurrency(await readSetting(CURRENCY_KEY));
  } catch (error) {
    // A price must still render if the settings store is unreachable.
    console.error("[settings] failed to read the currency", error);
    return DEFAULT_CURRENCY;
  }
}

export async function setCurrency(currency: Currency): Promise<Currency> {
  const safe = toCurrency(currency);
  await writeSetting(CURRENCY_KEY, safe);
  return safe;
}

/**
 * Which clock the restaurant's times are quoted on.
 *
 * A label only — see `lib/timezone.ts`. Nothing in this app converts between
 * zones, and this setting must never start being used as if it did.
 */
export async function getTimeZone(): Promise<TimeZone> {
  try {
    return toTimeZone(await readSetting(TIME_ZONE_KEY));
  } catch (error) {
    console.error("[settings] failed to read the time zone", error);
    return DEFAULT_TIME_ZONE;
  }
}

export async function setTimeZone(timeZone: TimeZone): Promise<TimeZone> {
  const safe = toTimeZone(timeZone);
  await writeSetting(TIME_ZONE_KEY, safe);
  return safe;
}

/**
 * The room as staff drew it.
 *
 * One document, because it is small and is read whole. Anything unreadable —
 * absent, half-written, or shaped like something else entirely — reads as an
 * empty plan rather than throwing, which is what makes "no plan yet" and "a
 * plan of no rooms" the same thing to every caller.
 */
export async function getFloorPlan(): Promise<FloorPlan> {
  try {
    return toFloorPlan(await readSetting(FLOOR_PLAN_KEY));
  } catch (error) {
    // A page that merely mentions the plan must not fail because of it.
    console.error("[settings] failed to read the floor plan", error);
    return EMPTY_PLAN;
  }
}

export async function setFloorPlan(plan: FloorPlan): Promise<FloorPlan> {
  const safe = toFloorPlan(plan);
  await writeSetting(FLOOR_PLAN_KEY, safe);
  return safe;
}

/**
 * Whether guests choose their own table — `docs/floor-plan.md` §4.
 *
 * Stored apart from the plan itself, because they are changed by different
 * acts: the plan is drawn and redrawn as furniture moves, the mode is a policy
 * decided once. Keeping them in one document would mean every save of a
 * half-drawn room carried the policy with it.
 *
 * Off is the default, and an unreadable store reads as off — the safe
 * direction, since off is exactly the app as it was before the plan existed.
 */
export async function getFloorPlanMode(): Promise<FloorPlanMode> {
  try {
    return toFloorPlanMode(await readSetting(FLOOR_PLAN_MODE_KEY));
  } catch (error) {
    console.error("[settings] failed to read the floor plan mode", error);
    return DEFAULT_FLOOR_PLAN_MODE;
  }
}

export async function setFloorPlanMode(mode: FloorPlanMode): Promise<FloorPlanMode> {
  const safe = toFloorPlanMode(mode);
  await writeSetting(FLOOR_PLAN_MODE_KEY, safe);
  return safe;
}

/**
 * The one gate every booking path will ask.
 *
 * Both halves are read together and resolved into a single answer, so that no
 * caller can decide "guests may pick" from the stored mode alone while the
 * plan holds nothing pickable (`resolveFloorPlanMode`). It returns the plan as
 * well, because anything allowed to pick needs the room to pick from and a
 * second read would be a second chance for the two to disagree.
 *
 * Nothing books against this yet: §9 step 3 is the claim, and it is the step
 * that can corrupt data rather than merely annoy somebody.
 */
export async function getTableSelection(): Promise<{ mode: FloorPlanMode; plan: FloorPlan }> {
  const [stored, plan] = await Promise.all([getFloorPlanMode(), getFloorPlan()]);
  return { mode: resolveFloorPlanMode(stored, plan), plan };
}
