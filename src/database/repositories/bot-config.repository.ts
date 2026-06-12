import { BotConfigModel } from "../models/bot-config.model";
import { LoggerManager } from "../../logger/LoggerManager";

const log = LoggerManager.getLogger("BotConfigRepository");

export class BotConfigRepository {
  async get(key: string): Promise<string | null> {
    try {
      const doc = await BotConfigModel.findOne({ key }).lean().exec();
      return doc?.value ?? null;
    } catch (err) {
      throw new Error(
        `[BotConfigRepository.get] ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  async set(key: string, value: string): Promise<void> {
    try {
      await BotConfigModel.findOneAndUpdate(
        { key },
        {
          $set:         { value, updatedAt: new Date() },
          $setOnInsert: { key },
        },
        { upsert: true }
      ).exec();
      log.debug("BotConfig set.", { key, value });
    } catch (err) {
      throw new Error(
        `[BotConfigRepository.set] ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  async getAll(): Promise<Record<string, string>> {
    try {
      const docs = await BotConfigModel.find({}).lean().exec();
      const result: Record<string, string> = {};
      for (const doc of docs) result[doc.key] = doc.value;
      return result;
    } catch (err) {
      throw new Error(
        `[BotConfigRepository.getAll] ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }
}
