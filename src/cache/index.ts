export { CacheManager } from "./CacheManager";
export type { CacheManagerOptions } from "./CacheManager";

export { CacheStore } from "./CacheStore";

export { MemoryProvider } from "./providers/MemoryProvider";
export { RedisProvider } from "./providers/RedisProvider";
export { createCacheProvider } from "./providers/createProvider";

export type {
  ICacheProvider,
  CacheEntry,
  CacheStats,
  CacheSetOptions,
} from "./types/ICache";
