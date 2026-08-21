import mongoose, { Schema } from "mongoose";

const restaurantDateSchema = new Schema(
  {
    date: { type: String, required: true, unique: true },
    isOpen: { type: Boolean, required: true, default: true },
    capacity: { type: Number, required: true, default: 0 },
    reservedSeats: { type: Number, required: true, default: 0 },
    // Strict arrival time, "HH:MM".
    serviceTime: { type: String },
    serviceEndTime: { type: String },
    premium: { type: Boolean, default: false },
    /**
     * Added later; absent reads as 0, which closes guest bookings when the
     * sitting starts. Staff are never bound by it.
     */
    bookingCutoffHours: { type: Number, min: 0, max: 240 },
  },
  { timestamps: true },
);

export const RestaurantDateModel =
  mongoose.models.RestaurantDate || mongoose.model("RestaurantDate", restaurantDateSchema);
