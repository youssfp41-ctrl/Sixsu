import { ISystem } from "../core/interfaces/ISystem";
import { ICacheProvider, CacheStats } from "./types/ICache";
import { MemoryProvider } from "./providers/MemoryProvider";
import { CacheStore } from "./CacheStore";
import { LoggerManager } from "../logger/LoggerManager";

export interface CacheManagerOptions {
  provider?: ICacheProvider;
}

export class CacheManager implements ISystem {
  readonly name = "cache";

  private provider: ICacheProvider;
  private readonly stores = new Map<string, CacheStore>();
  private readonly log    = LoggerManager.getLogger("CacheManager");

  constructor(options: CacheManagerOptions = {}) {
    this.provider = options.provider ?? new MemoryProvider();
  }

  async initialize(): Promise<void> {
    this.provider.start?.();
    this.log.info("Cache initialized.", { provider: this.provider.constructor.name });
  }

  async destroy(): Promise<void> {
    this.provider.stop?.();
    this.stores.clear();
    this.log.info("Cache destroyed.");
  }

  /**
   * Swap the underlying provider at runtime (e.g. switch to Redis).
   * All existing CacheStore instances will automatically use the new provider.
   */
  useProvider(provider: ICacheProvider): void {
    this.provider.stop?.();
    this.provider = provider;
    this.provider.start?.();

    for (const [ns, store] of this.stores.entries()) {
      this.stores.set(ns, new CacheStore(this.provider, ns));
      void store;
    }

    this.log.info("Cache provider swapped.", { provider: provider.constructor.name });
  }

  /**
   * Returns a namespaced CacheStore. Creates it once and reuses it.
   */
  store(namespace: string): CacheStore {
    if (!this.stores.has(namespace)) {
      this.stores.set(namespace, new CacheStore(this.provider, namespace));
    }
    return this.stores.get(namespace)!;
  }

  stats(): CacheStats {
    return this.provider.stats();
  }

  async clear(): Promise<void> {
    await this.provider.clear();
    this.log.warn("All cache entries cleared.");
  }
}
