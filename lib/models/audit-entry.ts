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
    reservationNumber: { type: String },
    summary: { type: String, required: true },
    changes: { type: [auditChangeSchema], required: false },
    /** The version of the record this entry produced. */
    version: { type: Number },
  },
  { timestamps: true },
);

/**
 * The log is read newest-first, and it only ever grows.
 *
 * Without an index on `createdAt` the unfiltered view — `/api/admin/audit` with
 * no reservation number — scans the whole collection and sorts it in memory.
 * That is fine at a thousand entries and is not at a million: MongoDB abandons
 * an in-memory sort past 32 MB, so the screen does not get gradually slower, it
 * gets gradually slower and then starts failing.
 *
 * This is the same bug that was found on reservations and fixed by indexing
 * `createdAt` there (docs/performance.md §9). The audit log was missed, because
 * nothing about it is slow yet.
 */
auditEntrySchema.index({ createdAt: -1 });

/**
 * A booking's own history, which is the common read. Compound rather than two
 * separate indexes: this covers the filter *and* the sort in one, and the
 * standalone `reservationNumber` index it replaces was only ever the prefix of
 * this one.
 *
 * An append-only collection pays for every index on every write, so the count
 * is kept to what is actually queried. If a deployment already carries the old
 * single-field index it is now redundant and can be dropped by hand; nothing
 * breaks while it is there.
 */
auditEntrySchema.index({ reservationNumber: 1, createdAt: -1 });

export const AuditEntryModel =
  mongoose.models.AuditEntry || mongoose.model("AuditEntry", auditEntrySchema);
