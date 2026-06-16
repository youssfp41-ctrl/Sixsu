import { UserModel, UserDocument, IUser } from '../models/user.model';
import { BaseRepository }                   from './BaseRepository';

export type CreateUserDTO = Pick<IUser, 'fbId'> & Partial<Omit<IUser, 'fbId'>>;
export type UpdateUserDTO = Partial<Omit<IUser, 'fbId'>>;

export interface TrackActivityResult {
  doc:   UserDocument;
  isNew: boolean;
}

export class UserRepository extends BaseRepository<
  UserDocument,
  CreateUserDTO,
  UpdateUserDTO
> {
  constructor() {
    super(UserModel);
  }

  async findByFbId(fbId: string): Promise<UserDocument | null> {
    return this.findOne({ fbId });
  }

  /**
   * Atomically upserts the user record on every incoming message.
   *
   * NOTE: rawResult is intentionally NOT used.
   * In Mongoose v9 with upsert:true, rawResult.value returns null for new inserts
   * even with returnDocument:'after' — known Mongoose v8/v9 behaviour.
   * Without rawResult, findOneAndUpdate returns the document directly (always
   * non-null after a successful upsert with returnDocument:'after').
   * isNew is inferred from messageCount === 1 (schema default 0 + first $inc = 1).
   */
  async trackActivity(
    fbId:  string,
    name?: string
  ): Promise<TrackActivityResult> {
    try {
      const nameSet = name ? { name } : {};

      const doc = await UserModel.findOneAndUpdate(
        { fbId },
        {
          $setOnInsert: { fbId, role: 'user', preferences: {} },
          $set:         { lastSeenAt: new Date(), ...nameSet },
          $inc:         { messageCount: 1 },
        },
        { upsert: true, returnDocument: 'after', runValidators: true }
      ).exec();

      if (!doc) {
        throw new Error(`findOneAndUpdate returned no document for fbId=${fbId}`);
      }

      const isNew = doc.messageCount === 1;
      return { doc, isNew };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`[UserRepository.trackActivity] ${msg}`);
    }
  }

  async upsertByFbId(
    fbId: string,
    data: UpdateUserDTO = {}
  ): Promise<UserDocument> {
    try {
      const doc = await UserModel.findOneAndUpdate(
        { fbId },
        {
          $set:         { ...data, lastSeenAt: new Date() },
          $setOnInsert: { fbId },
        },
        { upsert: true, returnDocument: 'after', runValidators: true }
      ).exec();
      return doc!;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`[UserRepository.upsertByFbId] ${msg}`);
    }
  }

  async setBlocked(fbId: string, blocked: boolean): Promise<boolean> {
    try {
      const result = await UserModel.updateOne(
        { fbId },
        { $set: { isBlocked: blocked } }
      ).exec();
      return result.modifiedCount > 0;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`[UserRepository.setBlocked] ${msg}`);
    }
  }

  async isBlocked(fbId: string): Promise<boolean> {
    try {
      const result = await UserModel.exists({ fbId, isBlocked: true }).exec();
      return result !== null;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`[UserRepository.isBlocked] ${msg}`);
    }
  }

  async setPreference(
    fbId:  string,
    key:   string,
    value: unknown
  ): Promise<boolean> {
    try {
      const result = await UserModel.updateOne(
        { fbId },
        { $set: { [`preferences.${key}`]: value } }
      ).exec();
      return result.modifiedCount > 0;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`[UserRepository.setPreference] ${msg}`);
    }
  }

  async setRole(fbId: string, role: IUser['role']): Promise<boolean> {
    try {
      const result = await UserModel.updateOne(
        { fbId },
        { $set: { role } }
      ).exec();
      return result.modifiedCount > 0;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`[UserRepository.setRole] ${msg}`);
    }
  }
}
