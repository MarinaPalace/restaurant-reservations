/**
 * Which clock the restaurant's times are on, and how to say so.
 *
 * ## Why this is a label and not a conversion
 *
 * Rule 2.1: every date in this app is a **local calendar string**, and every
 * time is read against the machine's own clock. That is deliberate and it
 * works, because the server and the restaurant are in the same place. Nothing
 * here changes that — it does not re-base any arithmetic, and it must not
 * start to.
 *
 * What it fixes is that "19:00" on a confirmation read by a guest who booked
 * from another country says nothing about *which* 19:00. Naming the zone, and
 * its current offset, costs nothing and removes the ambiguity.
 *
 * Because it is only a label, it can disagree with the machine the app runs
 * on — and a label that disagrees is worse than none, since it would state the
 * wrong hour with confidence. `describeClockMismatch` is what the admin screen
 * uses to say so out loud.
 */

/**
 * The zones the hotel may quote in.
 *
 * A short list rather than every IANA name, for the same reason the currency
 * list is short: it is chosen once, from a select, and free text there is a
 * typo that mislabels every time on every screen.
 */
export const TIME_ZONES = [
  "Europe/Sofia",
  "Europe/Bucharest",
  "Europe/Athens",
  "Europe/Berlin",
  "Europe/Warsaw",
  "Europe/Paris",
  "Europe/London",
  "Europe/Moscow",
  "UTC",
] as const;

export type TimeZone = (typeof TIME_ZONES)[number];

/** Where this restaurant is. The app was written for it, per HANDOVER §1. */
export const DEFAULT_TIME_ZONE: TimeZone = "Europe/Sofia";

export function isTimeZone(value: unknown): value is TimeZone {
  return typeof value === "string" && (TIME_ZONES as readonly string[]).includes(value);
}

/** Anything unrecognised reads as the default, so a bad stored value cannot break a screen. */
export function toTimeZone(value: unknown): TimeZone {
  return isTimeZone(value) ? value : DEFAULT_TIME_ZONE;
}

/**
 * The zone's offset right now, as `+03:00`.
 *
 * Computed rather than tabulated because it moves: Sofia is +02:00 in winter
 * and +03:00 in summer, and a hardcoded table is wrong for half the year.
 */
function offsetOf(timeZone: string, at: Date): string {
  try {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "longOffset" }).formatToParts(at);
    const name = parts.find((part) => part.type === "timeZoneName")?.value ?? "";
    // "GMT+03:00", or plain "GMT" at zero.
    const match = /GMT([+-]\d{2}:\d{2})/.exec(name);
    return match ? match[1] : "+00:00";
  } catch {
    return "+00:00";
  }
}

/** `UTC+3`, `UTC+2`, `UTC+5:30`, `UTC` — the short form people actually say. */
export function utcOffsetLabel(timeZone: string, at: Date = new Date()): string {
  const offset = offsetOf(timeZone, at);
  const [hours, minutes] = offset.slice(1).split(":");
  const sign = offset.startsWith("-") ? "−" : "+";
  const hour = Number(hours);

  if (hour === 0 && minutes === "00") {
    return "UTC";
  }

  return minutes === "00" ? `UTC${sign}${hour}` : `UTC${sign}${hour}:${minutes}`;
}

/** The city, without the region: `Europe/Sofia` reads as `Sofia`. */
export function cityOf(timeZone: string): string {
  const city = timeZone.split("/").pop() ?? timeZone;
  return city.replace(/_/g, " ");
}

/**
 * How a time is labelled next to the clock: `Sofia time (UTC+3)`.
 *
 * Both halves earn their place. The city is what a guest recognises; the
 * offset is what somebody in another country can actually convert from.
 */
export function timeZoneLabel(timeZone: string, at: Date = new Date()): string {
  return timeZone === "UTC" ? "UTC" : `${cityOf(timeZone)} time (${utcOffsetLabel(timeZone, at)})`;
}

/** The short form, for places with no room: `Sofia, UTC+3`. */
export function shortTimeZoneLabel(timeZone: string, at: Date = new Date()): string {
  return timeZone === "UTC" ? "UTC" : `${cityOf(timeZone)}, ${utcOffsetLabel(timeZone, at)}`;
}

/** What zone the machine running this thinks it is in. */
export function systemTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

/**
 * Whether the configured zone and the machine's own zone disagree, and by how
 * much.
 *
 * This matters more than it looks. Every time in this app is computed against
 * the machine's clock (rule 2.1), so the configured zone is only a *name* for
 * that clock. If a deployment sits in UTC while the label says Sofia, the
 * confirmation will read "19:00 Sofia time (UTC+3)" for a sitting the server
 * believes starts at 19:00 UTC — two hours out, stated confidently. Returns
 * `null` when they agree, which is the normal case.
 */
export function describeClockMismatch(configured: string, at: Date = new Date()): string | null {
  const system = systemTimeZone();

  if (system === configured) {
    return null;
  }

  const systemOffset = offsetOf(system, at);
  const configuredOffset = offsetOf(configured, at);

  // Two names for the same offset — Sofia and Bucharest, say — are not a
  // problem: every time this app prints would be identical either way.
  if (systemOffset === configuredOffset) {
    return null;
  }

  return (
    `This server's clock is set to ${system} (${utcOffsetLabel(system, at)}), but times are being ` +
    `labelled ${configured} (${utcOffsetLabel(configured, at)}). Every time shown to a guest is ` +
    `worked out from the server's clock, so they are being labelled with the wrong zone. Either set ` +
    `TZ=${configured} on the deployment, or change the setting to match the server.`
  );
}
