import type { RestaurantDateAvailability } from "@/types/booking";

/**
 * What the date editor sends when it saves an evening.
 *
 * ## Why this is a function and not an object literal in the component
 *
 * It used to be a literal, and it listed each field by hand:
 *
 * ```ts
 * body: JSON.stringify({ date, isOpen, capacity, serviceTime, serviceEndTime, premium })
 * ```
 *
 * Then `bookingCutoffHours` was added to the type, the model, the store, the
 * service, the validator and the form — and not to that literal. The field
 * changed on screen, was dropped on the way out, and the server's `0` came
 * straight back and overwrote it. Every layer was right and the save was
 * still silently a no-op.
 *
 * This is the same mistake `readStoredConfirmation` in `lib/booking-session.ts`
 * already carries a comment about, and it has now cost time twice. So:
 * **spread first, then correct.** A field added to `RestaurantDateAvailability`
 * later is carried by default rather than forgotten by default, and the test
 * beside this file fails if a new one is ever dropped.
 *
 * Unknown keys are not a hazard — `restaurantDateSchema` is a Zod object and
 * strips anything it does not declare — so sending too much is safe in a way
 * that sending too little is not.
 */
export function toRestaurantDatePayload(entry: RestaurantDateAvailability) {
  const rest = { ...entry };

  /**
   * Both are derived from capacity and the live bookings. The server owns
   * them — seat accounting is the most delicate code here (rule 2.7) — and it
   * must never be handed a client's idea of how many seats are taken.
   */
  delete (rest as Partial<RestaurantDateAvailability>).reservedSeats;
  delete (rest as Partial<RestaurantDateAvailability>).remainingSeats;

  return {
    ...rest,
    capacity: Number(entry.capacity),
    // An empty time input is "not set", not "00:00" — the schema's time
    // pattern would reject the empty string.
    serviceTime: entry.serviceTime || undefined,
    serviceEndTime: entry.serviceEndTime || undefined,
    premium: Boolean(entry.premium),
    // Absent reads as 0: bookings close when the sitting starts.
    bookingCutoffHours: Math.max(0, Math.round(Number(entry.bookingCutoffHours ?? 0))),
  };
}
