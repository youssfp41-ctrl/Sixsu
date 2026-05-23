import { ICacheProvider, CacheEntry, CacheSetOptions, CacheStats } from "../types/ICache";

const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;

export class MemoryProvider implements ICacheProvider {
  private readonly store = new Map<string, CacheEntry<unknown>>();
  private timer: ReturnType<typeof setInterval> | null = null;

  private counters: CacheStats = {
    hits:      0,
    misses:    0,
    sets:      0,
    deletes:   0,
    evictions: 0,
    size:      0,
  };

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.evictExpired(), CLEANUP_INTERVAL_MS);
    if (this.timer.unref) this.timer.unref();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.store.clear();
  }

  async get<T>(key: string): Promise<T | null> {
    const entry = this.store.get(key) as CacheEntry<T> | undefined;

    if (!entry) {
      this.counters.misses++;
      return null;
    }

    if (this.isExpired(entry)) {
      this.store.delete(key);
      this.counters.misses++;
      this.counters.evictions++;
      return null;
    }

    entry.hits++;
    this.counters.hits++;
    return entry.value;
  }

  async set<T>(key: string, value: T, options: CacheSetOptions = {}): Promise<void> {
    const entry: CacheEntry<T> = {
      value,
      createdAt: Date.now(),
      hits:      0,
      expiresAt: options.ttlMs ? Date.now() + options.ttlMs : undefined,
    };

    this.store.set(key, entry as CacheEntry<unknown>);
    this.counters.sets++;
    this.counters.size = this.store.size;
  }

  async delete(key: string): Promise<boolean> {
    const deleted = this.store.delete(key);
    if (deleted) {
      this.counters.deletes++;
      this.counters.size = this.store.size;
    }
    return deleted;
  }

  async exists(key: string): Promise<boolean> {
    const entry = this.store.get(key);
    if (!entry) return false;
    if (this.isExpired(entry)) {
      this.store.delete(key);
      return false;
    }
    return true;
  }

  async clear(prefix?: string): Promise<void> {
    if (!prefix) {
      this.store.clear();
    } else {
      for (const key of this.store.keys()) {
        if (key.startsWith(prefix)) this.store.delete(key);
      }
    }
    this.counters.size = this.store.size;
  }

  async size(prefix?: string): Promise<number> {
    if (!prefix) return this.store.size;
    let count = 0;
    for (const key of this.store.keys()) {
      if (key.startsWith(prefix)) count++;
    }
    return count;
  }

  stats(): CacheStats {
    return { ...this.counters, size: this.store.size };
  }

  private isExpired(entry: CacheEntry<unknown>): boolean {
    return entry.expiresAt !== undefined && Date.now() > entry.expiresAt;
  }

  private evictExpired(): void {
    const now = Date.now();
    for (const [key, entry] of this.store.entries()) {
      if (entry.expiresAt !== undefined && now > entry.expiresAt) {
        this.store.delete(key);
        this.counters.evictions++;
      }
    }
    this.counters.size = this.store.size;
  }
}
