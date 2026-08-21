import mongoose, { Schema } from "mongoose";

const menuOptionSchema = new Schema(
  {
    courseId: { type: String, required: true },
    name: { type: String, required: true },
    description: { type: String, default: "" },
    allergens: [{ type: String }],
    active: { type: Boolean, required: true, default: true },
    imageUrl: { type: String, default: "" },
    // Added later; documents without them read as undefined/false.
    ingredients: { type: String },
    vegan: { type: Boolean, default: false },
    price: { type: Number, min: 0, default: 0 },
    discountPercent: { type: Number, min: 0, max: 100, default: 0 },
    translations: { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: true },
);

export const MenuOptionModel =
  mongoose.models.MenuOption || mongoose.model("MenuOption", menuOptionSchema);
