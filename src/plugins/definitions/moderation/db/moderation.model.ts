import { Schema, model, Document } from "mongoose";

export type ModerationAction =
  | "ban" | "unban" | "warn" | "mute" | "unmute" | "kick";

export interface IModerationRecord {
  targetId:    string;
  actorId:     string;
  action:      ModerationAction;
  reason?:     string;
  durationMs?: number;
  expiresAt?:  Date;
  active:      boolean;
}

export interface ModerationDocument extends IModerationRecord, Document {
  createdAt: Date;
  updatedAt: Date;
}

const ModerationSchema = new Schema<ModerationDocument>(
  {
    targetId:   { type: String, required: true, index: true },
    actorId:    { type: String, required: true },
    action:     { type: String, required: true,
                  enum: ["ban","unban","warn","mute","unmute","kick"] },
    reason:     { type: String },
    durationMs: { type: Number },
    expiresAt:  { type: Date },
    active:     { type: Boolean, default: true, index: true },
  },
  { timestamps: true, versionKey: false }
);

ModerationSchema.index({ targetId: 1, action: 1, active: 1 });

export const ModerationModel = model<ModerationDocument>(
  "ModerationRecord",
  ModerationSchema
);
