import { BotAdminModel } from "../models/botadmin.model";
import { LoggerManager } from "../../logger/LoggerManager";

const log = LoggerManager.getLogger("BotAdminRepository");

export class BotAdminRepository {
  async findAll(): Promise<string[]> {
    try {
      const docs = await BotAdminModel.find({}, { fbId: 1 }).lean().exec();
      return docs.map((d) => d.fbId);
    } catch (err) {
      throw new Error(`[BotAdminRepository.findAll] ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async add(fbId: string, addedBy: string, note?: string): Promise<void> {
    try {
      await BotAdminModel.findOneAndUpdate(
        { fbId },
        { $setOnInsert: { fbId, addedBy, addedAt: new Date(), ...(note ? { note } : {}) } },
        { upsert: true }
      ).exec();
      log.debug("BotAdmin added.", { fbId, addedBy });
    } catch (err) {
      throw new Error(`[BotAdminRepository.add] ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async remove(fbId: string): Promise<boolean> {
    try {
      const result = await BotAdminModel.deleteOne({ fbId }).exec();
      const deleted = result.deletedCount > 0;
      if (deleted) log.debug("BotAdmin removed.", { fbId });
      return deleted;
    } catch (err) {
      throw new Error(`[BotAdminRepository.remove] ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async exists(fbId: string): Promise<boolean> {
    try {
      const result = await BotAdminModel.exists({ fbId }).exec();
      return result !== null;
    } catch (err) {
      throw new Error(`[BotAdminRepository.exists] ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async count(): Promise<number> {
    try {
      return await BotAdminModel.countDocuments().exec();
    } catch (err) {
      throw new Error(`[BotAdminRepository.count] ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
