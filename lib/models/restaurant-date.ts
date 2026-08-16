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
  },
  { timestamps: true },
);

export const RestaurantDateModel =
  mongoose.models.RestaurantDate || mongoose.model("RestaurantDate", restaurantDateSchema);
