import { describe, expect, it } from "vitest";
import {
  DEFAULT_TIME_ZONE,
  TIME_ZONES,
  cityOf,
  describeClockMismatch,
  isTimeZone,
  shortTimeZoneLabel,
  timeZoneLabel,
  toTimeZone,
  utcOffsetLabel,
} from "@/lib/timezone";

/**
 * Naming the clock.
 *
 * The offsets are asserted at two dates on purpose. Sofia is UTC+2 in winter
 * and UTC+3 in summer, so a label written into the copy — or tabulated
 * anywhere — is wrong for half the year. These tests fail if anybody replaces
 * the computation with a constant.
 */

const WINTER = new Date(2026, 0, 15, 12);
const SUMMER = new Date(2026, 6, 15, 12);

describe("offsets", () => {
  it("follows summer time rather than fixing an offset", () => {
    expect(utcOffsetLabel("Europe/Sofia", WINTER)).toBe("UTC+2");
    expect(utcOffsetLabel("Europe/Sofia", SUMMER)).toBe("UTC+3");
  });

  it("reads UTC as UTC rather than as +0", () => {
    expect(utcOffsetLabel("UTC", SUMMER)).toBe("UTC");
  });

  it("handles zones west of Greenwich", () => {
    expect(utcOffsetLabel("Europe/London", WINTER)).toBe("UTC");
    expect(utcOffsetLabel("Europe/London", SUMMER)).toBe("UTC+1");
  });

  it("does not throw on a zone it does not know", () => {
    expect(() => utcOffsetLabel("Not/AZone", SUMMER)).not.toThrow();
  });
});

describe("labels", () => {
  it("names the city and the offset", () => {
    expect(timeZoneLabel("Europe/Sofia", SUMMER)).toBe("Sofia time (UTC+3)");
    expect(shortTimeZoneLabel("Europe/Sofia", SUMMER)).toBe("Sofia, UTC+3");
  });

  it("says UTC plainly", () => {
    expect(timeZoneLabel("UTC", SUMMER)).toBe("UTC");
  });

  it("reads an underscored city name as words", () => {
    expect(cityOf("America/New_York")).toBe("New York");
  });
});

describe("the stored value", () => {
  it("accepts every zone on the list", () => {
    for (const zone of TIME_ZONES) {
      expect(isTimeZone(zone)).toBe(true);
    }
  });

  it("reads anything unrecognised as the default", () => {
    expect(toTimeZone("Mars/Olympus")).toBe(DEFAULT_TIME_ZONE);
    expect(toTimeZone(undefined)).toBe(DEFAULT_TIME_ZONE);
    expect(toTimeZone(7)).toBe(DEFAULT_TIME_ZONE);
  });
});

/**
 * The warning that matters more than the setting.
 *
 * Every time in this app is computed from the server's clock (rule 2.1), so
 * the setting only *names* that clock. A name that disagrees does not shift
 * any time — it mislabels every one of them, confidently, by the difference.
 */
describe("the clock mismatch warning", () => {
  it("says nothing when the zone matches the machine", () => {
    const system = Intl.DateTimeFormat().resolvedOptions().timeZone;
    expect(describeClockMismatch(system, SUMMER)).toBeNull();
  });

  /** Two names for the same offset print identical times, so they are fine. */
  it("says nothing when two zones share an offset", () => {
    expect(describeClockMismatch("Europe/Bucharest", SUMMER)).toBe(
      describeClockMismatch("Europe/Sofia", SUMMER),
    );
  });

  it("warns when the offsets genuinely differ", () => {
    // London and Sofia are never the same offset.
    const opposite = Intl.DateTimeFormat().resolvedOptions().timeZone === "Europe/London" ? "Europe/Sofia" : "Europe/London";
    const warning = describeClockMismatch(opposite, SUMMER);

    if (warning === null) {
      // The machine running the suite happens to share London's offset; the
      // other direction is still worth asserting.
      expect(describeClockMismatch("Europe/Moscow", SUMMER)).toContain("labelled");
      return;
    }

    expect(warning).toContain("server's clock");
    expect(warning).toContain(opposite);
  });
});
