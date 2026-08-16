import mongoose, { Schema } from "mongoose";

const passKeySchema = new Schema(
  {
    // Canonical form only: upper-case, no dashes. Lookups compare against
    // exactly what normalizePassKey produces.
    code: { type: String, required: true, unique: true, index: true },
    roomNumber: { type: String },
    guestName: { type: String },
    nights: { type: Number },
    // A local date key, never an instant — see lib/date.ts.
    expiresOn: { type: String },
    status: { type: String, enum: ["active", "used", "revoked"], required: true, default: "active" },
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
