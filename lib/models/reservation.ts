import mongoose, { Schema } from "mongoose";

const selectionSchema = new Schema(
  {
    // Without this field Mongoose silently strips it, and every per-guest
    // choice collapses into one anonymous list on the kitchen report.
    guestIndex: { type: Number, required: true, min: 0 },
    courseId: { type: String, required: true },
    courseName: { type: String, required: true },
    optionId: { type: String, required: true },
    optionName: { type: String, required: true },
  },
  { _id: false },
);

const addOnSchema = new Schema(
  {
    courseId: { type: String, required: true },
    courseName: { type: String, required: true },
    optionId: { type: String, required: true },
    optionName: { type: String, required: true },
    price: { type: Number, required: true, min: 0 },
    discountPercent: { type: Number, required: true, min: 0, max: 100 },
    finalPrice: { type: Number, required: true, min: 0 },
  },
  { _id: false },
);

const contactSchema = new Schema(
  {
    method: { type: String, enum: ["email", "phone"], required: true },
    email: { type: String },
    phone: { type: String },
    // Only meaningful alongside a phone number.
    messagingApp: { type: String, enum: ["phone", "whatsapp", "viber", "telegram"] },
  },
  { _id: false },
);

/**
 * A snapshot of who cancelled, kept on the booking itself so the record
 * explains itself without joining the audit log.
 */
const cancellationSchema = new Schema(
  {
    at: { type: String, required: true },
    actorKind: { type: String, enum: ["staff", "guest", "system"], required: true },
    actorId: { type: String },
    actorName: { type: String, required: true },
    reason: { type: String },
  },
  { _id: false },
);

const reservationSchema = new Schema(
  {
    reservationNumber: { type: String, required: true, unique: true, index: true },
    // A string: rooms are labelled L10, HA3, A43 as well as 402. Values
    // stored as numbers by earlier versions are cast on read.
    kind: { type: String, enum: ["standard", "premium"], default: "standard" },
    // Blank for a premium booking, where the guest names themselves instead.
    roomNumber: { type: String, required: false, default: "" },
    // The other rooms on the same table, from a ticket that named several.
    // Absent on everything booked before this, which reads as one room.
    additionalRooms: { type: [String], required: false },
    guestName: { type: String },
    guestCount: { type: Number, required: true },
    date: { type: String, required: true, index: true },
    selections: [selectionSchema],
    addOns: [addOnSchema],
    /**
     * Did they come? A permanent record. Absent is unknown — never "seated",
     * never "no-show". See `docs/service-tracking.md` §2.
     */
    attendance: {
      type: new Schema(
        {
          status: { type: String, enum: ["seated", "no-show"], required: true },
          at: { type: String, required: true },
          byName: { type: String, required: true },
          guests: { type: Number, min: 0 },
        },
        { _id: false },
      ),
      required: false,
    },
    /**
     * Course id -> when it went out. Operational, not a record; `Mixed` because
     * the keys are menu ids, which Mongoose cannot type ahead of time.
     */
    service: {
      type: new Schema(
        {
          /** Legacy whole-course marks; still read. */
          servedAt: { type: Schema.Types.Mixed, default: {} },
          /** Course id -> guest index -> when that plate went out. */
          servedGuests: { type: Schema.Types.Mixed, default: {} },
        },
        { _id: false },
      ),
      required: false,
    },
    // Optional so reservations taken before contact details existed still load.
    contact: { type: contactSchema, required: false },
    time: { type: String },
    endTime: { type: String },
    notes: { type: String },
    // Shared by rooms dining together; indexed so a group loads in one query.
    tableGroupId: { type: String, index: true },
    tableNumber: { type: String },
    status: { type: String, enum: ["confirmed", "cancelled"], default: "confirmed" },
    // The pass-key the guest booked with, and their credential for changing
    // it later. Indexed so "this key's booking" is one query. Absent on staff
    // bookings and on everything made before pass-keys existed.
    passKeyId: { type: String, index: true },
    cancellation: { type: cancellationSchema, required: false },
  },
  { timestamps: true },
);

// The staff lists sort newest-first on `createdAt` (added by `timestamps`).
// Without this index that sort is a blocking in-memory stage on a full-collection
// scan — and fails outright past 32MB. See docs/performance.md §3.1.
reservationSchema.index({ createdAt: -1 });

export const ReservationModel =
  mongoose.models.Reservation || mongoose.model("Reservation", reservationSchema);
