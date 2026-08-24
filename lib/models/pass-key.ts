import mongoose, { Schema } from "mongoose";

const passKeySchema = new Schema(
  {
    // Canonical form only: upper-case, no dashes. Lookups compare against
    // exactly what normalizePassKey produces.
    code: { type: String, required: true, unique: true, index: true },
    // Absent reads as "standard", so keys issued before this are unaffected.
    kind: { type: String, enum: ["standard", "premium"], default: "standard" },
    // The hotel's booking reference: stable when a guest changes room.
    reservationRef: { type: String, index: true },
    roomNumber: { type: String },
    guestName: { type: String },
    checkInOn: { type: String },
    nights: { type: Number },
    // The party size on the hotel booking. Absent reads as no extra limit.
    maxGuests: { type: Number, min: 1 },
    // A local date key, never an instant — see lib/date.ts.
    expiresOn: { type: String },
    // Added with multi-use keys. Absent reads as a single use already spent or
    // not, worked out from the legacy `status`, so no migration was needed.
    maxUses: { type: Number, default: 1, min: 1 },
    usedCount: { type: Number, default: 0, min: 0 },
    status: { type: String, enum: ["active", "used", "revoked"], required: true, default: "active" },
    /** Every booking made with this key. Supersedes the single-value field. */
    reservationNumbers: [{ type: String }],
    /** Kept for keys written before multi-use; read, never written. */
    reservationNumber: { type: String, index: true },
    issuedById: { type: String },
    issuedByName: { type: String },
    usedAt: { type: Date },
    revokedAt: { type: Date },
    note: { type: String },
    /**
     * Invitations only: where it was sent, and what happened. Both optional and
     * absent on every key issued before invitations were emailed, which reads
     * as "never sent" — no migration.
     */
    guestEmail: { type: String },
    invitation: {
      type: new Schema(
        {
          channel: { type: String, enum: ["email"], required: true },
          to: { type: String, required: true },
          at: { type: String, required: true },
          status: { type: String, enum: ["sent", "failed"], required: true },
          messageId: { type: String },
          error: { type: String },
          attempts: { type: Number, default: 1, min: 1 },
        },
        { _id: false },
      ),
      required: false,
    },
  },
  { timestamps: true },
);

export const PassKeyModel = mongoose.models.PassKey || mongoose.model("PassKey", passKeySchema);
