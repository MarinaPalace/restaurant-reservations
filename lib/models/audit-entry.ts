import mongoose, { Schema } from "mongoose";

/**
 * The trail of who did what. Append-only: nothing in the app updates or
 * deletes an entry, which is the whole point of having it.
 */
/**
 * One field that moved. Stored beside the summary rather than instead of it, so
 * every entry ever written still renders and nothing has to parse prose to draw
 * a change properly.
 */
const auditChangeSchema = new Schema(
  {
    field: { type: String, required: true },
    label: { type: String, required: true },
    from: { type: String },
    to: { type: String },
  },
  { _id: false },
);

const auditEntrySchema = new Schema(
  {
    action: { type: String, required: true, index: true },
    actorKind: { type: String, enum: ["staff", "guest", "system"], required: true },
    actorId: { type: String },
    actorName: { type: String, required: true },
    reservationNumber: { type: String, index: true },
    summary: { type: String, required: true },
    changes: { type: [auditChangeSchema], required: false },
    /** The version of the record this entry produced. */
    version: { type: Number },
  },
  { timestamps: true },
);

export const AuditEntryModel =
  mongoose.models.AuditEntry || mongoose.model("AuditEntry", auditEntrySchema);
