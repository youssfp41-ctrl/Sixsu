import { BanModel, IBan } from "../models/ban.model";
import { LoggerManager } from "../../logger/LoggerManager";

const log = LoggerManager.getLogger("BanRepository");

export type BanEntry = {
  userId:    string;
  reason?:   string;
  bannedAt:  Date;
  expiresAt: Date | null;
  bannedBy?: string;
};

export class BanRepository {
  async findActive(): Promise<BanEntry[]> {
    try {
      const now  = new Date();
      const docs = await BanModel.find({
        $or: [
          { expiresAt: null },
          { expiresAt: { $gt: now } },
        ],
      }).lean().exec();
      return docs.map((d) => ({
        userId:    d.userId,
        reason:    d.reason,
        bannedAt:  d.bannedAt,
        expiresAt: d.expiresAt,
        bannedBy:  d.bannedBy,
      }));
    } catch (err) {
      throw new Error(
        `[BanRepository.findActive] ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  async upsert(entry: BanEntry): Promise<void> {
    try {
      await BanModel.findOneAndUpdate(
        { userId: entry.userId },
        {
          $set: {
            reason:    entry.reason,
            bannedAt:  entry.bannedAt,
            expiresAt: entry.expiresAt,
            bannedBy:  entry.bannedBy,
          },
          $setOnInsert: { userId: entry.userId },
        },
        { upsert: true }
      ).exec();
      log.debug("Ban upserted.", { userId: entry.userId });
    } catch (err) {
      throw new Error(
        `[BanRepository.upsert] ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  async remove(userId: string): Promise<boolean> {
    try {
      const result = await BanModel.deleteOne({ userId }).exec();
      return result.deletedCount > 0;
    } catch (err) {
      throw new Error(
        `[BanRepository.remove] ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  async purgeExpired(): Promise<number> {
    try {
      const result = await BanModel.deleteMany({
        expiresAt: { $ne: null, $lte: new Date() },
      }).exec();
      if (result.deletedCount > 0) {
        log.info(`BanRepository: purged ${result.deletedCount} expired ban(s).`);
      }
      return result.deletedCount;
    } catch (err) {
      throw new Error(
        `[BanRepository.purgeExpired] ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }
}
