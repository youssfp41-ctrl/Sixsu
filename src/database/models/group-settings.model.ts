import { Schema, model, Document } from "mongoose";

export interface IGroupSettings {
  threadId:         string;
  protectName:      boolean;
  lockedName:       string;
  protectNicknames: boolean;
  nicknames:        Record<string, string>;
  botNickname:      string;
  lockdown:         boolean;
  prefix:           string;
  updatedAt:        Date;
}

export interface GroupSettingsDocument extends IGroupSettings, Document {}

const GroupSettingsSchema = new Schema<GroupSettingsDocument>(
  {
    threadId:         { type: String, required: true, unique: true, index: true },
    protectName:      { type: Boolean, default: false },
    lockedName:       { type: String,  default: "" },
    protectNicknames: { type: Boolean, default: false },
    nicknames:        { type: Schema.Types.Mixed, default: {} },
    botNickname:      { type: String,  default: "" },
    lockdown:         { type: Boolean, default: false },
    prefix:           { type: String,  default: "" },
    updatedAt:        { type: Date,    default: () => new Date() },
  },
  { versionKey: false }
);

export const GroupSettingsModel = model<GroupSettingsDocument>(
  "GroupSettings",
  GroupSettingsSchema
);
