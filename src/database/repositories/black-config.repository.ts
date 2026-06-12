import {
  BlackConfigModel,
  IBlackConfig,
  BlackConfigDocument,
} from "../models/black-config.model";
import { LoggerManager } from "../../logger/LoggerManager";

const log = LoggerManager.getLogger("BlackConfigRepository");

export type BlackConfigUpdate = Partial<Omit<IBlackConfig, "threadId" | "updatedAt">>;

export class BlackConfigRepository {
  async findAll(): Promise<BlackConfigDocument[]> {
    try {
      return await BlackConfigModel.find({}).exec();
    } catch (err) {
      throw new Error(
        `[BlackConfigRepository.findAll] ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  async upsert(threadId: string, data: BlackConfigUpdate): Promise<void> {
    try {
      await BlackConfigModel.findOneAndUpdate(
        { threadId },
        {
          $set:         { ...data, updatedAt: new Date() },
          $setOnInsert: { threadId },
        },
        { upsert: true }
      ).exec();
      log.debug("BlackConfig upserted.", { threadId });
    } catch (err) {
      throw new Error(
        `[BlackConfigRepository.upsert] ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  async findByThreadId(threadId: string): Promise<BlackConfigDocument | null> {
    try {
      return await BlackConfigModel.findOne({ threadId }).exec();
    } catch (err) {
      throw new Error(
        `[BlackConfigRepository.findByThreadId] ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  async setActive(threadId: string, active: boolean): Promise<void> {
    try {
      await BlackConfigModel.findOneAndUpdate(
        { threadId },
        {
          $set:         { active, updatedAt: new Date() },
          $setOnInsert: { threadId },
        },
        { upsert: true }
      ).exec();
    } catch (err) {
      throw new Error(
        `[BlackConfigRepository.setActive] ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }
}
