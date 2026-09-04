import mongoose, { Schema } from "mongoose";

/**
 * Seats a guest is in the middle of taking.
 *
 * One document per booking in progress. It exists so that the seats are gone
 * from the moment the guest says how many they are and which evening — not at
 * the end, after they have chosen six dishes and been told the evening filled
 * up while they read.
 *
 * ## It is the counter that stops the overselling, not this document
 *
 * The atomic gate is the conditional `$inc` on the date's `heldSeats`, the same
 * shape rule 2.7 already uses for `reservedSeats`. This document is the
 * *receipt*: what the counter is holding, for whom, and until when. The counter
 * decides the race; the receipt is how the seats find their way back.
 *
 * ## Deliberately no TTL index
 *
 * Mongo would happily expire these for us and that is exactly the wrong thing:
 * it would delete the receipt without decrementing the counter, and the seats
 * would be held by nobody, for ever. Expiry is swept explicitly by
 * `sweepExpiredHolds`, which deletes the document and gives the seats back in
 * the same breath.
 */
const seatHoldSchema = new Schema(
  {
    /** Opaque, unguessable, and the only thing the guest's browser keeps. */
    holdId: { type: String, required: true, unique: true },
    /** Local calendar key, never a UTC instant (rule 2.1). */
    date: { type: String, required: true },
    /** Seats held. What gets given back, exactly, whatever else changes. */
    guests: { type: Number, required: true, min: 1 },
    /**
     * The pass-key this hold belongs to.
     *
     * A key may hold seats on one evening at a time: taking a second hold
     * releases the first, so a guest walking back and forth between the
     * calendar and the menu cannot quietly shut an evening on their own.
     */
    passKeyId: { type: String, required: true },
    /** When the seats go back to the room. A UTC instant, unlike `date`. */
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true },
);

seatHoldSchema.index({ passKeyId: 1 });
// Sweeping asks "what has expired on this evening", and nothing else.
seatHoldSchema.index({ date: 1, expiresAt: 1 });

export const SeatHoldModel = mongoose.models.SeatHold || mongoose.model("SeatHold", seatHoldSchema);
