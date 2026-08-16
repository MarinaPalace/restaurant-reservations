import mongoose, { Schema } from "mongoose";

/**
 * The trail of who did what. Append-only: nothing in the app updates or
 * deletes an entry, which is the whole point of having it.
 */
const auditEntrySchema = new Schema(
  {
    action: { type: String, required: true, index: true },
    actorKind: { type: String, enum: ["staff", "guest", "system"], required: true },
    actorId: { type: String },
    actorName: { type: String, required: true },
    reservationNumber: { type: String, index: true },
    summary: { type: String, required: true },
  },
  { timestamps: true },
);

export const AuditEntryModel =
  mongoose.models.AuditEntry || mongoose.model("AuditEntry", auditEntrySchema);
