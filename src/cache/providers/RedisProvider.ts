import { ICacheProvider, CacheSetOptions, CacheStats } from "../types/ICache";

/**
 * Redis provider — requires `ioredis` to be installed.
 *
 * Do NOT instantiate directly. Use `RedisProvider.connect(url)` which throws
 * a descriptive error if ioredis is missing, allowing the caller to fall back
 * safely to MemoryProvider.
 *
 * To activate Redis:
 *   1. pnpm add ioredis
 *   2. Set REDIS_URL in your .env
 *   3. The createCacheProvider() factory picks it up automatically — no other changes needed.
 */
export class RedisProvider implements ICacheProvider {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private readonly client: any;

  private readonly counters: CacheStats = {
    hits: 0, misses: 0, sets: 0, deletes: 0, evictions: 0, size: 0,
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private constructor(client: any) {
    this.client = client;
  }

  /**
   * Attempts to create a connected RedisProvider.
   * Throws if `ioredis` is not installed or the connection times out.
   * The caller (createCacheProvider) catches this and falls back to MemoryProvider.
   */
  static async connect(url: string): Promise<RedisProvider> {
    // Dynamic import — throws MODULE_NOT_FOUND if ioredis isn't installed
    let RedisClient: new (url: string) => unknown;
    try {
      const mod = await import("ioredis");
      RedisClient = (mod.default ?? mod) as typeof RedisClient;
    } catch {
      throw new Error(
        "ioredis is not installed. Run `pnpm add ioredis` to enable Redis support."
      );
    }

    const client = new RedisClient(url) as {
      ping(): Promise<string>;
      get(key: string): Promise<string | null>;
      set(key: string, value: string, ...args: unknown[]): Promise<unknown>;
      del(...keys: string[]): Promise<number>;
      exists(...keys: string[]): Promise<number>;
      flushdb(): Promise<unknown>;
      keys(pattern: string): Promise<string[]>;
      dbsize(): Promise<number>;
      quit(): Promise<unknown>;
    };

    await Promise.race([
      client.ping(),
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error("Redis connection timed out after 5s.")),
          5_000
        )
      ),
    ]);

    return new RedisProvider(client);
  }

  async get<T>(key: string): Promise<T | null> {
    const raw: string | null = await this.client.get(key);
    if (raw === null) {
      this.counters.misses++;
      return null;
    }
    this.counters.hits++;
    return JSON.parse(raw) as T;
  }

  async set<T>(key: string, value: T, options?: CacheSetOptions): Promise<void> {
    const serialized = JSON.stringify(value);
    if (options?.ttlMs) {
      await this.client.set(key, serialized, "PX", options.ttlMs);
    } else {
      await this.client.set(key, serialized);
    }
    this.counters.sets++;
  }

  async delete(key: string): Promise<boolean> {
    const count: number = await this.client.del(key);
    if (count > 0) this.counters.deletes++;
    return count > 0;
  }

  async exists(key: string): Promise<boolean> {
    const count: number = await this.client.exists(key);
    return count > 0;
  }

  async clear(prefix?: string): Promise<void> {
    if (!prefix) {
      await this.client.flushdb();
    } else {
      const keys: string[] = await this.client.keys(`${prefix}*`);
      if (keys.length > 0) {
        await this.client.del(...keys);
      }
    }
  }

  async size(prefix?: string): Promise<number> {
    if (!prefix) return this.client.dbsize() as Promise<number>;
    const keys: string[] = await this.client.keys(`${prefix}*`);
    return keys.length;
  }

  stats(): CacheStats {
    return { ...this.counters };
  }

  async stop(): Promise<void> {
    await this.client.quit();
  }
}
