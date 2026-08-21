import { connectToDatabase, isMongoConfigured } from "@/lib/db/connect";
import { getLocalSetting, setLocalSetting } from "@/lib/db/local-admin-store";
import { AppSettingModel } from "@/lib/models/app-setting";
import { DEFAULT_CURRENCY, toCurrency, type Currency } from "@/lib/money";
import { DEFAULT_TIME_ZONE, toTimeZone, type TimeZone } from "@/lib/timezone";

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
