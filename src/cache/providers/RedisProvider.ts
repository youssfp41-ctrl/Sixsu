import { ICacheProvider, CacheSetOptions, CacheStats } from "../types/ICache";

/**
 * Redis provider stub — ready for implementation.
 *
 * To activate:
 *   1. npm install ioredis
 *   2. Replace the stub methods with real ioredis calls
 *   3. Pass the RedisProvider to CacheManager.configure()
 *
 * Example:
 *   import Redis from "ioredis";
 *   const client = new Redis(process.env.REDIS_URL);
 */
export class RedisProvider implements ICacheProvider {
  private readonly counters: CacheStats = {
    hits: 0, misses: 0, sets: 0, deletes: 0, evictions: 0, size: 0,
  };

  async get<T>(_key: string): Promise<T | null> {
    throw new Error("RedisProvider: not implemented. Install ioredis and implement this method.");
  }

  async set<T>(_key: string, _value: T, _options?: CacheSetOptions): Promise<void> {
    throw new Error("RedisProvider: not implemented.");
  }

  async delete(_key: string): Promise<boolean> {
    throw new Error("RedisProvider: not implemented.");
  }

  async exists(_key: string): Promise<boolean> {
    throw new Error("RedisProvider: not implemented.");
  }

  async clear(_prefix?: string): Promise<void> {
    throw new Error("RedisProvider: not implemented.");
  }

  async size(_prefix?: string): Promise<number> {
    throw new Error("RedisProvider: not implemented.");
  }

  stats(): CacheStats {
    return { ...this.counters };
  }
}
