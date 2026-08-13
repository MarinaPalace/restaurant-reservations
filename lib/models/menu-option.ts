import mongoose, { Schema } from "mongoose";

const menuOptionSchema = new Schema(
  {
    courseId: { type: String, required: true },
    name: { type: String, required: true },
    description: { type: String, default: "" },
    allergens: [{ type: String }],
    active: { type: Boolean, required: true, default: true },
    imageUrl: { type: String, default: "" },
    translations: { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: true },
);

export const MenuOptionModel =
  mongoose.models.MenuOption || mongoose.model("MenuOption", menuOptionSchema);
