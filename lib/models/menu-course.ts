import mongoose, { Schema } from "mongoose";

const menuCourseSchema = new Schema(
  {
    order: { type: Number, required: true },
    name: { type: String, required: true },
    description: { type: String, default: "" },
    required: { type: Boolean, required: true, default: true },
    active: { type: Boolean, required: true, default: true },
    imageUrl: { type: String, default: "" },
    translations: { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: true },
);

export const MenuCourseModel =
  mongoose.models.MenuCourse || mongoose.model("MenuCourse", menuCourseSchema);
