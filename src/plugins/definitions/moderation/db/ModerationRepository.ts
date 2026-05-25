import {
  ModerationModel,
  ModerationDocument,
  IModerationRecord,
  ModerationAction,
} from "./moderation.model";
import { BaseRepository } from "../../../../database/repositories/BaseRepository";

export type CreateModerationDTO = Omit<IModerationRecord, "active"> & { active?: boolean };
export type UpdateModerationDTO = Partial<IModerationRecord>;

export class ModerationRepository extends BaseRepository<
  ModerationDocument,
  CreateModerationDTO,
  UpdateModerationDTO
> {
  constructor() {
    super(ModerationModel);
  }

  async getActiveRecord(
    targetId: string,
    action:   ModerationAction
  ): Promise<ModerationDocument | null> {
    return this.findOne({ targetId, action, active: true } as never);
  }

  async deactivateRecords(
    targetId: string,
    action:   ModerationAction
  ): Promise<number> {
    const result = await ModerationModel.updateMany(
      { targetId, action, active: true },
      { $set: { active: false } }
    ).exec();
    return result.modifiedCount;
  }

  async getHistory(targetId: string, limit = 20): Promise<ModerationDocument[]> {
    return ModerationModel
      .find({ targetId })
      .sort({ createdAt: -1 })
      .limit(limit)
      .exec();
  }

  async countActiveWarnings(targetId: string): Promise<number> {
    return this.count({ targetId, action: "warn", active: true } as never);
  }

  async hasActiveRecord(
    targetId: string,
    action:   ModerationAction
  ): Promise<boolean> {
    return this.exists({ targetId, action, active: true } as never);
  }

  async recentActivity(limit = 50): Promise<ModerationDocument[]> {
    return ModerationModel.find().sort({ createdAt: -1 }).limit(limit).exec();
  }
}
