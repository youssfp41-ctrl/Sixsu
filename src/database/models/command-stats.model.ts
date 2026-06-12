import { Schema, model, Document } from "mongoose";

export interface ICommandStats {
  commandName: string;
  threadId?:   string;
  count:       number;
  lastUsedAt:  Date;
}

export interface CommandStatsDocument extends ICommandStats, Document {}

const CommandStatsSchema = new Schema<CommandStatsDocument>(
  {
    commandName: { type: String, required: true },
    threadId:    { type: String },
    count:       { type: Number, default: 0 },
    lastUsedAt:  { type: Date,   default: () => new Date() },
  },
  { versionKey: false, timestamps: false }
);

CommandStatsSchema.index({ commandName: 1, threadId: 1 }, { unique: true, sparse: true });
CommandStatsSchema.index({ count: -1 });

export const CommandStatsModel = model<CommandStatsDocument>("CommandStats", CommandStatsSchema);
