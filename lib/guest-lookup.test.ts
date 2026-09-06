import { describe, expect, it } from "vitest";
import { hasGuestLookupCandidates, parseGuestLookup, unwrapScannedValue } from "@/lib/guest-lookup";

/**
 * What reception has just been handed.
 *
 * Every case here is something a real guest can put in front of the desk: a
 * card held up to a camera, a code read aloud and typed, a hotel reference off
 * the paperwork. A reading this gets wrong is a guest standing at the desk
 * while somebody tells them their booking does not exist.
 */

describe("what came out of the camera", () => {
  /**
   * The printed pass-key card encodes a booking *link*, not a bare code —
   * nothing about the scanned string looks like a key until the `k` is pulled
   * out of it.
   */
  it("takes the key out of a scanned pass-key card", () => {
    expect(unwrapScannedValue("https://dine.example.com/booking?k=VDM-K7QP3-M2XR4")).toBe(
      "VDM-K7QP3-M2XR4",
    );
  });

  it("takes the code out of a scanned invitation card", () => {
    expect(unwrapScannedValue("https://dine.example.com/premium/VDM-K7QP3-M2XR4")).toBe(
      "VDM-K7QP3-M2XR4",
    );
  });

  /** A confirmation card's QR is the number itself, with no URL around it. */
  it("leaves a bare code alone", () => {
    expect(unwrapScannedValue("VDM-3E94B8")).toBe("VDM-3E94B8");
  });

  /**
   * A link with no code in it must not be read as a code called "booking" —
   * that would send reception looking for a guest who does not exist instead
   * of telling them the card did not scan.
   */
  it("does not mistake a route for a code", () => {
    expect(unwrapScannedValue("https://dine.example.com/booking")).toBe(
      "https://dine.example.com/booking",
    );
  });

  it("survives something that is not a URL at all", () => {
    expect(unwrapScannedValue("  10245  ")).toBe("10245");
  });
});

describe("what the desk was given", () => {
  it("reads a reservation number", () => {
    expect(parseGuestLookup("VDM-3E94B8")).toEqual({ reservationNumber: "VDM-3E94B8" });
  });

  it("reads a reservation number typed in lower case", () => {
    expect(parseGuestLookup("vdm-3e94b8")).toEqual({ reservationNumber: "VDM-3E94B8" });
  });

  it("reads a pass-key however it was written", () => {
    expect(parseGuestLookup("VDM-K7QP3-M2XR4").passKey).toBe("K7QP3M2XR4");
    expect(parseGuestLookup("k7qp3 m2xr4").passKey).toBe("K7QP3M2XR4");
    expect(parseGuestLookup("K7QP3M2XR4").passKey).toBe("K7QP3M2XR4");
  });

  it("reads a scanned pass-key card straight through", () => {
    expect(parseGuestLookup("https://dine.example.com/booking?k=VDM-K7QP3-M2XR4").passKey).toBe(
      "K7QP3M2XR4",
    );
  });

  it("reads the hotel's own booking reference", () => {
    expect(parseGuestLookup("10245")).toEqual({ hotelRef: "10245" });
  });

  /**
   * `normalizePassKey` drops anything outside the key alphabet rather than
   * refusing, so without an alphabet check a hotel reference with a dash in it
   * would arrive as a perfectly plausible pass-key and be searched for as one.
   */
  it("does not turn a punctuated hotel reference into a pass-key", () => {
    expect(parseGuestLookup("10-2245").passKey).toBeUndefined();
  });

  /**
   * A reservation number is six characters after the prefix and a pass-key
   * normalises to at least eight, so the two do not collide — asserted rather
   * than assumed, because it is the assumption the single box rests on.
   */
  it("keeps reservation numbers and pass-keys apart", () => {
    expect(parseGuestLookup("VDM-3E94B8").passKey).toBeUndefined();
    expect(parseGuestLookup("VDM-K7QP3-M2XR4").reservationNumber).toBeUndefined();
  });

  it("finds nothing in nonsense, and says so", () => {
    expect(hasGuestLookupCandidates(parseGuestLookup("hello"))).toBe(false);
    expect(hasGuestLookupCandidates(parseGuestLookup(""))).toBe(false);
    expect(hasGuestLookupCandidates(parseGuestLookup("   "))).toBe(false);
  });

  it("finds something in every real form", () => {
    for (const input of ["VDM-3E94B8", "VDM-K7QP3-M2XR4", "10245"]) {
      expect(hasGuestLookupCandidates(parseGuestLookup(input))).toBe(true);
    }
  });
});
