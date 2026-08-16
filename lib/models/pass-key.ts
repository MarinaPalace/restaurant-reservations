import mongoose, { Schema } from "mongoose";

const passKeySchema = new Schema(
  {
    // Canonical form only: upper-case, no dashes. Lookups compare against
    // exactly what normalizePassKey produces.
    code: { type: String, required: true, unique: true, index: true },
    // Absent reads as "standard", so keys issued before this are unaffected.
    kind: { type: String, enum: ["standard", "premium"], default: "standard" },
    roomNumber: { type: String },
    guestName: { type: String },
    nights: { type: Number },
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
  },
  { timestamps: true },
);

export const PassKeyModel = mongoose.models.PassKey || mongoose.model("PassKey", passKeySchema);
