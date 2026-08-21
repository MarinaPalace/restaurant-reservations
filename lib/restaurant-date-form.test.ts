import { describe, expect, it } from "vitest";
import { toRestaurantDatePayload } from "@/lib/restaurant-date-form";
import { restaurantDateSchema } from "@/lib/validation/booking";
import type { RestaurantDateAvailability } from "@/types/booking";

/**
 * What the date editor sends when it saves an evening.
 *
 * These exist because the payload used to be a hand-written literal in the
 * component, and `bookingCutoffHours` was added everywhere except there. The
 * field changed on screen, was dropped on the way out, and the server's `0`
 * came back and overwrote it — a save that silently did nothing, with every
 * layer beneath it correct.
 */

function evening(overrides: Partial<RestaurantDateAvailability> = {}): RestaurantDateAvailability {
  return {
    date: "2026-08-25",
    isOpen: true,
    capacity: 40,
    reservedSeats: 6,
    remainingSeats: 34,
    serviceTime: "19:00",
    serviceEndTime: "22:00",
    premium: false,
    bookingCutoffHours: 4,
    ...overrides,
  };
}

describe("the saved payload", () => {
  /** The bug, named. */
  it("carries the booking cutoff", () => {
    expect(toRestaurantDatePayload(evening()).bookingCutoffHours).toBe(4);
  });

  it("carries a cutoff of zero rather than dropping it", () => {
    expect(toRestaurantDatePayload(evening({ bookingCutoffHours: 0 }))).toHaveProperty(
      "bookingCutoffHours",
      0,
    );
  });

  it("reads an absent cutoff as none", () => {
    expect(toRestaurantDatePayload(evening({ bookingCutoffHours: undefined })).bookingCutoffHours).toBe(0);
  });

  it("rounds and clamps a cutoff typed oddly", () => {
    expect(toRestaurantDatePayload(evening({ bookingCutoffHours: 3.6 })).bookingCutoffHours).toBe(4);
    expect(toRestaurantDatePayload(evening({ bookingCutoffHours: -5 })).bookingCutoffHours).toBe(0);
  });

  it("carries everything else the editor can change", () => {
    const payload = toRestaurantDatePayload(evening({ premium: true, capacity: 12 }));

    expect(payload).toMatchObject({
      date: "2026-08-25",
      isOpen: true,
      capacity: 12,
      serviceTime: "19:00",
      serviceEndTime: "22:00",
      premium: true,
    });
  });

  /**
   * Rule 2.7: seat accounting is the server's. It must never be handed the
   * client's idea of how many seats are taken.
   */
  it("does not send the seat counts", () => {
    const payload = toRestaurantDatePayload(evening());

    expect(payload).not.toHaveProperty("reservedSeats");
    expect(payload).not.toHaveProperty("remainingSeats");
  });

  it("sends an unset time as absent, not as an empty string", () => {
    const payload = toRestaurantDatePayload(evening({ serviceTime: "", serviceEndTime: "" }));

    expect(payload.serviceTime).toBeUndefined();
    expect(payload.serviceEndTime).toBeUndefined();
  });

  it("survives the schema the route validates it with", () => {
    const parsed = restaurantDateSchema.safeParse(toRestaurantDatePayload(evening()));

    expect(parsed.success).toBe(true);
    expect(parsed.data?.bookingCutoffHours).toBe(4);
  });
});

/**
 * The guard for the *next* field, not this one.
 *
 * Everything the route accepts and the editor holds must reach the wire. A
 * field added to the schema and to the form but forgotten in the payload is
 * precisely the bug this file is named after, and it would otherwise be caught
 * only by somebody noticing a save quietly doing nothing.
 */
describe("nothing the route accepts is dropped", () => {
  it("sends every field the schema declares", () => {
    const payload = toRestaurantDatePayload(evening()) as Record<string, unknown>;
    const accepted = Object.keys(restaurantDateSchema.shape);

    const missing = accepted.filter((key) => !(key in payload));
    expect(missing).toEqual([]);
  });

  /**
   * And it does so by *spreading*, not by listing. A literal would pass the
   * test above today and fail it the moment somebody adds a field — which is
   * the whole point, but only if the spread stays.
   */
  it("carries a field the payload builder has never heard of", () => {
    const withFutureField = { ...evening(), somethingAddedLater: "kept" } as RestaurantDateAvailability;
    const payload = toRestaurantDatePayload(withFutureField) as Record<string, unknown>;

    expect(payload.somethingAddedLater).toBe("kept");
  });
});
