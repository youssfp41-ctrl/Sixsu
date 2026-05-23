export interface CacheEntry<T> {
  value:      T;
  expiresAt?: number;
  createdAt:  number;
  hits:       number;
}

export interface CacheStats {
  hits:       number;
  misses:     number;
  sets:       number;
  deletes:    number;
  evictions:  number;
  size:       number;
}

export interface CacheSetOptions {
  ttlMs?: number;
}

export interface ICacheProvider {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T, options?: CacheSetOptions): Promise<void>;
  delete(key: string): Promise<boolean>;
  exists(key: string): Promise<boolean>;
  clear(prefix?: string): Promise<void>;
  size(prefix?: string): Promise<number>;
  stats(): CacheStats;
  start?(): void;
  stop?(): void;
}
