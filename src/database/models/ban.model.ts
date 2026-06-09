import { Schema, model, Document } from "mongoose";

export interface IBan {
  userId:    string;
  reason?:   string;
  bannedAt:  Date;
  expiresAt: Date | null;
  bannedBy?: string;
}

export interface BanDocument extends IBan, Document {}

const BanSchema = new Schema<BanDocument>(
  {
    userId:    { type: String, required: true, unique: true, index: true },
    reason:    { type: String },
    bannedAt:  { type: Date, default: () => new Date() },
    expiresAt: { type: Date, default: null },
    bannedBy:  { type: String },
  },
  { versionKey: false }
);

export const BanModel = model<BanDocument>("Ban", BanSchema);
