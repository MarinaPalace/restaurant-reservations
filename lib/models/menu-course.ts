import mongoose, { Schema } from "mongoose";

const menuCourseSchema = new Schema(
  {
    // Added later; documents without it read as the standard menu.
    menu: { type: String, enum: ["standard", "premium"], default: "standard" },
    order: { type: Number, required: true },
    name: { type: String, required: true },
    description: { type: String, default: "" },
    required: { type: Boolean, required: true, default: true },
    active: { type: Boolean, required: true, default: true },
    addOn: { type: Boolean, required: true, default: false },
    imageUrl: { type: String, default: "" },
    translations: { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: true },
);

export const MenuCourseModel =
  mongoose.models.MenuCourse || mongoose.model("MenuCourse", menuCourseSchema);
