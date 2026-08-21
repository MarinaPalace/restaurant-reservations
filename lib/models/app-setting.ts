import mongoose, { Schema } from "mongoose";

/**
 * One row per setting, keyed by name.
 *
 * A single document holding every setting would be simpler to read, but two
 * screens saving different settings at the same time would then overwrite each
 * other. A row each means a write only ever touches the setting it is about.
 *
 * Nothing here is required: a setting that has never been saved is absent, and
 * every reader supplies its own default. That is what lets a new setting ship
 * without a migration.
 */
const appSettingSchema = new Schema(
  {
    key: { type: String, required: true, unique: true, index: true },
    value: { type: Schema.Types.Mixed },
  },
  { timestamps: true },
);

export const AppSettingModel =
  mongoose.models.AppSetting || mongoose.model("AppSetting", appSettingSchema);
