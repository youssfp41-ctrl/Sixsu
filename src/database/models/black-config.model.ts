import { Schema, model, Document } from "mongoose";

export interface IBlackConfig {
  threadId:    string;
  message:     string;
  intervalSec: number;
  active:      boolean;
  lastSentAt:  Date | null;
  updatedAt:   Date;
}

export interface BlackConfigDocument extends IBlackConfig, Document {}

const BlackConfigSchema = new Schema<BlackConfigDocument>(
  {
    threadId:    { type: String, required: true, unique: true, index: true },
    message:     { type: String,  default: "" },
    intervalSec: { type: Number,  default: 0 },
    active:      { type: Boolean, default: false },
    lastSentAt:  { type: Date,    default: null },
    updatedAt:   { type: Date,    default: () => new Date() },
  },
  { versionKey: false }
);

export const BlackConfigModel = model<BlackConfigDocument>("BlackConfig", BlackConfigSchema);
