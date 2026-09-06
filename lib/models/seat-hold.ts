import mongoose, { Schema } from "mongoose";

/**
 * Seats a guest took while they were booking, and what became of them.
 *
 * One document per booking **attempt**. It starts life holding seats out of the
 * room, and ends as a record of how the attempt finished — booked, given back,
 * or abandoned when the fifteen minutes ran out.
 *
 * ## Why it is kept rather than deleted
 *
 * The first version deleted the receipt the moment it was spent or expired,
 * which was tidy and lost the only evidence that anything had happened. Guests
 * regularly come to the desk certain they booked a table when they got as far
 * as the menu and stopped, and nobody could say whether that was true. Now
 * there is a row: this room, this evening, this many people, started at this
 * time, got this far, and never finished.
 *
 * So a hold is **closed, not removed**. `status` is what moves.
 *
 * ## The status change is the atomic gate
 *
 * The seat counter is what stops overselling; this document is what decides
 * *who* gets to move it. Every transition is a conditional update requiring
 * `status: "live"`, so of two requests racing to spend or release the same hold
 * exactly one matches and only that one touches `heldSeats`. That is the same
 * "one winner" property the deleting version had, without the forgetting.
 *
 * ## Deliberately no TTL index
 *
 * Two reasons now. It would expire the seats without giving them back — the
 * counter would hold them for nobody, for ever — and it would throw away the
 * footprint this exists for. Expiry is swept explicitly by `sweepExpiredHolds`,
 * which closes the hold and returns the seats in the same breath.
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
     * A key holds seats on one evening at a time: taking a second hold closes
     * the first, so a guest walking back and forth between the calendar and the
     * menu cannot quietly shut an evening on their own.
     */
    passKeyId: { type: String, required: true },
    /**
     * The room, so an unfinished attempt can be recognised by the person at the
     * desk asking about it. Added after the fact and therefore optional (rule
     * 2.2): a hold written before this reads as a room nobody recorded, which
     * is what it was.
     */
    roomNumber: { type: String },
    /**
     * How far the guest got. The difference between "they glanced at the
     * calendar" and "they were choosing dessert", which is the whole of what
     * makes the record worth keeping.
     */
    step: { type: String },
    /**
     * What became of the attempt.
     *
     * `live` while the seats are held; `booked` once spent on a reservation;
     * `released` when the guest went back to the calendar or moved the hold;
     * `abandoned` when the time ran out with nothing booked.
     *
     * Only `live` holds count against the room. The rest are history.
     */
    status: {
      type: String,
      enum: ["live", "booked", "released", "abandoned"],
      required: true,
      default: "live",
    },
    /** The booking it turned into, when it turned into one. */
    reservationNumber: { type: String },
    /** When the seats go back to the room. A UTC instant, unlike `date`. */
    expiresAt: { type: Date, required: true },
    /** When it stopped being live, whichever way it went. */
    closedAt: { type: Date },
  },
  { timestamps: true },
);

// Sweeping asks "what is still live and out of time", and nothing else.
seatHoldSchema.index({ status: 1, expiresAt: 1 });
// The dashboard asks an evening what happened on it, newest first.
seatHoldSchema.index({ date: 1, status: 1, createdAt: -1 });
seatHoldSchema.index({ passKeyId: 1 });

export const SeatHoldModel = mongoose.models.SeatHold || mongoose.model("SeatHold", seatHoldSchema);
