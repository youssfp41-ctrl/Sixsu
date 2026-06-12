import { Schema, model, Document } from "mongoose";

export interface IBotConfig {
  key:       string;
  value:     string;
  updatedAt: Date;
}

export interface BotConfigDocument extends IBotConfig, Document {}

const BotConfigSchema = new Schema<BotConfigDocument>(
  {
    key:       { type: String, required: true, unique: true, index: true },
    value:     { type: String, required: true },
    updatedAt: { type: Date,   default: () => new Date() },
  },
  { versionKey: false }
);

export const BotConfigModel = model<BotConfigDocument>("BotConfig", BotConfigSchema);
