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
    /**
     * What this evening switches on for itself. Absent — and an absent field
     * within it — means "whatever the restaurant says", so every date written
     * before this reads as following the defaults.
     *
     * `_id: false` because it is a value on the date, not a document of its
     * own, and `Mixed` would let a stray key through: the reader
     * (`toEveningOverrides`) drops anything it does not recognise anyway, but
     * the store should not carry it in the first place.
     */
    features: {
      type: new Schema(
        {
          tableSelection: { type: String },
          promotions: { type: Boolean },
          selfService: { type: Boolean },
        },
        { _id: false },
      ),
      default: undefined,
    },
  },
  { timestamps: true },
);

export const RestaurantDateModel =
  mongoose.models.RestaurantDate || mongoose.model("RestaurantDate", restaurantDateSchema);
