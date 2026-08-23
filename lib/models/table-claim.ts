import mongoose, { Schema } from "mongoose";

/**
 * Who is sitting at which table, on which evening.
 *
 * One document per (evening, table) — **not** one per booking. A table shared
 * by two rooms is one claim carrying both reservation numbers and the sum of
 * their guests, which is the same idea `tableGroupId` already expresses.
 *
 * ## The unique index is the point, not decoration
 *
 * `docs/floor-plan.md` §2 warns against solving this with a unique index, and
 * that warning is about a different thing: a unique index on the *booking's*
 * table would make sharing impossible. Here it is on the **claim**, where one
 * row per table per evening is exactly right — and it is what makes the
 * conditional upsert safe. Two claims racing on an empty table both attempt an
 * insert; the index lets exactly one through and the loser gets a duplicate-key
 * error it can retry against the document that now exists.
 *
 * Without it, both inserts would succeed and the table would be double-booked
 * with no error anywhere.
 */
const tableClaimSchema = new Schema(
  {
    /** Local calendar key, never a UTC instant (rule 2.1). */
    date: { type: String, required: true },
    /** The plan table's stable id, not its label — labels get renamed. */
    tableId: { type: String, required: true },
    /** Guests already seated at it. The thing that gets exhausted. */
    guests: { type: Number, required: true, default: 0 },
    /** The bookings sharing it. Normally one. */
    reservationNumbers: { type: [String], default: [] },
  },
  { timestamps: true },
);

tableClaimSchema.index({ date: 1, tableId: 1 }, { unique: true });

export const TableClaimModel =
  mongoose.models.TableClaim || mongoose.model("TableClaim", tableClaimSchema);
