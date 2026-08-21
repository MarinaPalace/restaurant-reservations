import mongoose, { Schema } from "mongoose";

const menuCourseSchema = new Schema(
  {
    // Added later; documents without it read as the everyday menu.
    menu: { type: String, enum: ["standard", "premium", "promo"], default: "standard" },
    order: { type: Number, required: true },
    name: { type: String, required: true },
    description: { type: String, default: "" },
    required: { type: Boolean, required: true, default: true },
    active: { type: Boolean, required: true, default: true },
    /**
     * Legacy. The first version of promotions marked a course on the everyday
     * menu rather than giving promotions a catalogue of their own. Still read
     * by `menuCatalogOf`, so those documents keep working without a migration,
     * and written as `false` on every save. Nothing new should set it.
     *
     * @deprecated Use `menu: "promo"`.
     */
    addOn: { type: Boolean, required: true, default: false },
    imageUrl: { type: String, default: "" },
    translations: { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: true },
);

export const MenuCourseModel =
  mongoose.models.MenuCourse || mongoose.model("MenuCourse", menuCourseSchema);
