import { CommandStatsModel } from "../models/command-stats.model";
import { LoggerManager } from "../../logger/LoggerManager";

const log = LoggerManager.getLogger("CommandStatsRepository");

export interface CommandStatsSummary {
  commandName: string;
  count:       number;
  lastUsedAt:  Date;
}

export class CommandStatsRepository {
  async increment(commandName: string, threadId?: string): Promise<void> {
    try {
      const filter = threadId
        ? { commandName, threadId }
        : { commandName, threadId: { $exists: false } };

      await CommandStatsModel.findOneAndUpdate(
        filter,
        {
          $inc:         { count: 1 },
          $set:         { lastUsedAt: new Date() },
          $setOnInsert: { commandName, ...(threadId ? { threadId } : {}) },
        },
        { upsert: true }
      ).exec();
    } catch (err) {
      log.warn("CommandStats increment failed.", {
        commandName,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  async getTopCommands(limit = 10): Promise<CommandStatsSummary[]> {
    try {
      const docs = await CommandStatsModel.aggregate<{
        _id: string;
        count: number;
        lastUsedAt: Date;
      }>([
        { $group: { _id: "$commandName", count: { $sum: "$count" }, lastUsedAt: { $max: "$lastUsedAt" } } },
        { $sort: { count: -1 } },
        { $limit: limit },
      ]).exec();
      return docs.map((d) => ({ commandName: d._id, count: d.count, lastUsedAt: d.lastUsedAt }));
    } catch (err) {
      throw new Error(
        `[CommandStatsRepository.getTopCommands] ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  async getByThread(threadId: string, limit = 10): Promise<CommandStatsSummary[]> {
    try {
      const docs = await CommandStatsModel
        .find({ threadId }, { commandName: 1, count: 1, lastUsedAt: 1 })
        .sort({ count: -1 })
        .limit(limit)
        .lean()
        .exec();
      return docs.map((d) => ({
        commandName: d.commandName,
        count:       d.count,
        lastUsedAt:  d.lastUsedAt,
      }));
    } catch (err) {
      throw new Error(
        `[CommandStatsRepository.getByThread] ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }
}
