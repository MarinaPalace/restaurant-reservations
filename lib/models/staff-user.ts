import mongoose, { Schema } from "mongoose";
import { STAFF_PERMISSIONS } from "@/types/booking";

const staffUserSchema = new Schema(
  {
    // Stored lower-cased so sign-in does not depend on how it was typed.
    username: { type: String, required: true, unique: true, index: true },
    passwordHash: { type: String, required: true },
    name: { type: String, required: true },
    role: { type: String, enum: ["admin", "staff"], required: true, default: "staff" },
    // Validated against the catalogue, so a permission removed from the app
    // cannot linger in the database and quietly grant something.
    permissions: [{ type: String, enum: STAFF_PERMISSIONS }],
    active: { type: Boolean, required: true, default: true },
    lastLoginAt: { type: Date },
    createdByName: { type: String },
  },
  { timestamps: true },
);

export const StaffUserModel =
  mongoose.models.StaffUser || mongoose.model("StaffUser", staffUserSchema);
