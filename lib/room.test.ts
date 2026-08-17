import { describe, expect, it } from "vitest";
import {
  compareRoomNumbers,
  formatRoomList,
  isValidRoomNumber,
  normalizeRoomNumber,
  roomNumbersMatch,
} from "@/lib/room";

describe("room labels", () => {
  it("accepts the shapes the hotel actually uses", () => {
    for (const room of ["402", "L10", "HA3", "A43", "1", "B-12"]) {
      expect(isValidRoomNumber(room), room).toBe(true);
    }
  });

  it("rejects empty or unreasonable values", () => {
    for (const room of ["", "   ", "402 DROP TABLE", "room#5", "-12", "TOOLONGAROOM1"]) {
      expect(isValidRoomNumber(room), room).toBe(false);
    }
  });

  it("normalises case and surrounding space", () => {
    expect(normalizeRoomNumber("  l10 ")).toBe("L10");
    expect(normalizeRoomNumber("ha3")).toBe("HA3");
  });

  /** Numbers stored by earlier versions must still read as their digits. */
  it("reads a legacy numeric room", () => {
    expect(normalizeRoomNumber(402)).toBe("402");
    expect(isValidRoomNumber(402)).toBe(true);
  });
});

describe("matching a room for ownership checks", () => {
  it("ignores case and spacing", () => {
    expect(roomNumbersMatch("l10", "L10")).toBe(true);
    expect(roomNumbersMatch(" 402 ", "402")).toBe(true);
    expect(roomNumbersMatch("402", 402)).toBe(true);
  });

  it("does not match a different room", () => {
    expect(roomNumbersMatch("L10", "L11")).toBe(false);
    expect(roomNumbersMatch("A43", "HA3")).toBe(false);
  });

  it("never matches on an empty value", () => {
    expect(roomNumbersMatch("", "")).toBe(false);
    expect(roomNumbersMatch(null, undefined)).toBe(false);
    expect(roomNumbersMatch(undefined, "402")).toBe(false);
  });
});

describe("listing the rooms on one booking", () => {
  it("joins them the way the service sheet already shows a shared table", () => {
    expect(formatRoomList("402", ["405", "l10"])).toBe("402 + 405 + L10");
  });

  it("reads a booking with one room as just that room", () => {
    expect(formatRoomList("402")).toBe("402");
    expect(formatRoomList("402", [])).toBe("402");
    expect(formatRoomList("402", undefined)).toBe("402");
  });

  it("drops blanks rather than printing a stray plus", () => {
    expect(formatRoomList("402", ["", "  "])).toBe("402");
    // A premium booking has no room at all; the caller falls back to the name.
    expect(formatRoomList("", [])).toBe("");
  });
});

describe("ordering rooms for the kitchen sheet", () => {
  it("sorts numerically rather than by character code", () => {
    const rooms = ["402", "10", "2", "L10", "L2", "A43"];
    expect(rooms.slice().sort(compareRoomNumbers)).toEqual(["2", "10", "402", "A43", "L2", "L10"]);
  });
});
