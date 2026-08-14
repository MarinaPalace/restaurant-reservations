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

const reservationSchema = new Schema(
  {
    reservationNumber: { type: String, required: true, unique: true, index: true },
    roomNumber: { type: Number, required: true },
    guestCount: { type: Number, required: true },
    date: { type: String, required: true, index: true },
    selections: [selectionSchema],
    status: { type: String, enum: ["confirmed", "cancelled"], default: "confirmed" },
  },
  { timestamps: true },
);

export const ReservationModel =
  mongoose.models.Reservation || mongoose.model("Reservation", reservationSchema);
