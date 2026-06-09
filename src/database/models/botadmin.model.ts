import { Schema, model, Document } from "mongoose";

export interface IBotAdmin {
  fbId:    string;
  addedBy: string;
  addedAt: Date;
  note?:   string;
}

export interface BotAdminDocument extends IBotAdmin, Document {}

const BotAdminSchema = new Schema<BotAdminDocument>(
  {
    fbId:    { type: String, required: true, unique: true, index: true },
    addedBy: { type: String, required: true },
    addedAt: { type: Date, default: () => new Date() },
    note:    { type: String },
  },
  { versionKey: false }
);

export const BotAdminModel = model<BotAdminDocument>("BotAdmin", BotAdminSchema);
