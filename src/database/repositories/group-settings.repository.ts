import {
  GroupSettingsModel,
  IGroupSettings,
  GroupSettingsDocument,
} from "../models/group-settings.model";
import { LoggerManager } from "../../logger/LoggerManager";

const log = LoggerManager.getLogger("GroupSettingsRepository");

export type GroupSettingsUpdate = Partial<Omit<IGroupSettings, "threadId" | "updatedAt">>;

export class GroupSettingsRepository {
  async findByThreadId(threadId: string): Promise<GroupSettingsDocument | null> {
    try {
      return await GroupSettingsModel.findOne({ threadId }).exec();
    } catch (err) {
      throw new Error(
        `[GroupSettingsRepository.findByThreadId] ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  async upsert(
    threadId: string,
    data:     GroupSettingsUpdate
  ): Promise<GroupSettingsDocument> {
    try {
      const doc = await GroupSettingsModel.findOneAndUpdate(
        { threadId },
        {
          $set:         { ...data, updatedAt: new Date() },
          $setOnInsert: { threadId },
        },
        { upsert: true, new: true }
      ).exec();
      log.debug("GroupSettings upserted.", { threadId });
      return doc!;
    } catch (err) {
      throw new Error(
        `[GroupSettingsRepository.upsert] ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  async findAll(): Promise<GroupSettingsDocument[]> {
    try {
      return await GroupSettingsModel.find({}).exec();
    } catch (err) {
      throw new Error(
        `[GroupSettingsRepository.findAll] ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  async getLockdown(threadId: string): Promise<boolean> {
    try {
      const doc = await GroupSettingsModel.findOne(
        { threadId },
        { lockdown: 1 }
      ).lean().exec();
      return doc?.lockdown ?? false;
    } catch (err) {
      throw new Error(
        `[GroupSettingsRepository.getLockdown] ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  async setLockdown(threadId: string, enabled: boolean): Promise<void> {
    try {
      await GroupSettingsModel.findOneAndUpdate(
        { threadId },
        {
          $set:         { lockdown: enabled, updatedAt: new Date() },
          $setOnInsert: { threadId },
        },
        { upsert: true }
      ).exec();
    } catch (err) {
      throw new Error(
        `[GroupSettingsRepository.setLockdown] ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  async getLockedThreadIds(): Promise<string[]> {
    try {
      const docs = await GroupSettingsModel.find(
        { lockdown: true },
        { threadId: 1 }
      ).lean().exec();
      return docs.map((d) => d.threadId);
    } catch (err) {
      throw new Error(
        `[GroupSettingsRepository.getLockedThreadIds] ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }
}
