import { CacheStore }     from "../cache/CacheStore";
import { UserRepository } from "../database/repositories/user.repository";
import { ILogger }        from "../logger/types/ILogger";
import { LoggerManager }  from "../logger/LoggerManager";
import { UserDocument }   from "../database/models/user.model";
import {
  IUserService,
  IUserRecord,
  UserRole,
} from "./types/IUserService";

const USER_CACHE_TTL_MS = 5 * 60 * 1_000; // 5 minutes

const cacheKey = (fbId: string) => `profile:${fbId}`;

/**
 * UserService — core layer for user lifecycle management.
 *
 * On every incoming message:
 *   1. Checks the in-process cache (fast path, ~0 ms).
 *   2. On cache miss: atomically upserts the DB record (findOrCreate + increment).
 *   3. Caches the result with a TTL.
 *
 * Cache-hit path fires a background DB refresh (fire-and-forget) so counters
 * stay accurate without blocking the message pipeline.
 *
 * All DB errors are caught and logged — the system degrades gracefully by
 * returning a fallback record rather than crashing the handler.
 */
export class UserService implements IUserService {
  private readonly repo:  UserRepository;
  private readonly cache: CacheStore;
  private readonly log:   ILogger;

  constructor(repo: UserRepository, cache: CacheStore) {
    this.repo  = repo;
    this.cache = cache;
    this.log   = LoggerManager.getLogger("UserService");
  }

  // ── Public API ─────────────────────────────────────────────────────────

  async findOrCreate(fbId: string, name?: string): Promise<IUserRecord> {
    const key = cacheKey(fbId);

    // Fast path — serve from cache
    const cached = await this.cache.get<IUserRecord>(key);
    if (cached) {
      // Bump counters in the background so the pipeline is never blocked
      this.refreshInBackground(fbId, name);
      return cached;
    }

    // Slow path — DB upsert
    const { doc, isNew } = await this.repo.trackActivity(fbId, name);
    const record = this.toRecord(doc, isNew);

    await this.cache.set(key, record, { ttlMs: USER_CACHE_TTL_MS });

    if (isNew) {
      this.log.info("UserService: new user created.", { fbId, name });
    }

    return record;
  }

  async updateProfile(
    fbId: string,
    data: { name?: string; role?: UserRole }
  ): Promise<void> {
    await this.repo.upsertByFbId(fbId, data);
    await this.cache.delete(cacheKey(fbId));
    this.log.info("UserService: profile updated.", { fbId, ...data });
  }

  async getPreference<T>(fbId: string, key: string, defaultValue: T): Promise<T> {
    const cached = await this.cache.get<IUserRecord>(cacheKey(fbId));
    if (cached) {
      const val = cached.preferences[key];
      return (val !== undefined ? val : defaultValue) as T;
    }

    const doc = await this.repo.findByFbId(fbId);
    if (!doc) return defaultValue;

    const val = doc.preferences[key];
    return (val !== undefined ? val : defaultValue) as T;
  }

  async setPreference(fbId: string, key: string, value: unknown): Promise<void> {
    await this.repo.setPreference(fbId, key, value);
    await this.cache.delete(cacheKey(fbId));
    this.log.debug("UserService: preference set.", { fbId, key });
  }

  // ── Internals ─────────────────────────────────────────────────────────

  private toRecord(doc: UserDocument, isNew: boolean): IUserRecord {
    return {
      fbId:         doc.fbId,
      name:         doc.name,
      role:         doc.role,
      isBlocked:    doc.isBlocked,
      lastSeenAt:   doc.lastSeenAt,
      messageCount: doc.messageCount,
      preferences:  (doc.preferences ?? {}) as Record<string, unknown>,
      createdAt:    (doc as unknown as { createdAt?: Date }).createdAt ?? new Date(),
      isNew,
    };
  }

  /**
   * Fire-and-forget background DB refresh.
   * Updates counters in the DB and repopulates the cache so stats stay accurate.
   */
  private refreshInBackground(fbId: string, name?: string): void {
    this.repo.trackActivity(fbId, name)
      .then(({ doc }) =>
        this.cache.set(cacheKey(fbId), this.toRecord(doc, false), { ttlMs: USER_CACHE_TTL_MS })
      )
      .catch((err: unknown) => {
        this.log.warn("UserService: background refresh failed.", {
          fbId,
          error: err instanceof Error ? err.message : String(err),
        });
      });
  }
}
