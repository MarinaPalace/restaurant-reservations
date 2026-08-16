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

const reservationSchema = new Schema(
  {
    reservationNumber: { type: String, required: true, unique: true, index: true },
    // A string: rooms are labelled L10, HA3, A43 as well as 402. Values
    // stored as numbers by earlier versions are cast on read.
    kind: { type: String, enum: ["standard", "premium"], default: "standard" },
    // Blank for a premium booking, where the guest names themselves instead.
    roomNumber: { type: String, required: false, default: "" },
    guestName: { type: String },
    guestCount: { type: Number, required: true },
    date: { type: String, required: true, index: true },
    selections: [selectionSchema],
    // Optional so reservations taken before contact details existed still load.
    contact: { type: contactSchema, required: false },
    time: { type: String },
    endTime: { type: String },
    notes: { type: String },
    // Shared by rooms dining together; indexed so a group loads in one query.
    tableGroupId: { type: String, index: true },
    tableNumber: { type: String },
    status: { type: String, enum: ["confirmed", "cancelled"], default: "confirmed" },
  },
  { timestamps: true },
);

export const ReservationModel =
  mongoose.models.Reservation || mongoose.model("Reservation", reservationSchema);
