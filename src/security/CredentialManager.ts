import {
  ICredentialLoader,
  CredentialEntry,
  CredentialStatus,
  LoadResult,
} from "./types/ICredential";
import { LoggerManager } from "../logger/LoggerManager";

const log = LoggerManager.getLogger("CredentialManager");

export interface CredentialManagerOptions {
  /** Loaders tried in order — first successful one wins. */
  loaders: ICredentialLoader[];
  /** How long (ms) to cache loaded credentials. 0 = no cache. Default: 5 min */
  cacheTtlMs?: number;
}

interface CacheEntry {
  result:    LoadResult;
  expiresAt: number;
}

export class CredentialManager {
  private readonly loaders:    ICredentialLoader[];
  private readonly cacheTtlMs: number;
  private cache: CacheEntry | null = null;

  constructor(opts: CredentialManagerOptions) {
    this.loaders    = opts.loaders;
    this.cacheTtlMs = opts.cacheTtlMs ?? 5 * 60_000;
  }

  /**
   * Load credentials from the first available source.
   * Returns the cached result if still fresh.
   */
  async load(forceReload = false): Promise<LoadResult> {
    if (!forceReload && this.cache && Date.now() < this.cache.expiresAt) {
      log.info("CredentialManager: returning cached credentials.");
      return this.cache.result;
    }

    for (const loader of this.loaders) {
      const available = await loader.canLoad();
      if (!available) {
        log.info(`CredentialManager: loader "${loader.name}" unavailable, skipping.`);
        continue;
      }

      log.info(`CredentialManager: trying loader "${loader.name}"...`);
      const result = await loader.load();

      if (result.success) {
        log.info(
          `CredentialManager: loaded ${result.credentials.length} credential(s) via "${loader.name}".`
        );
        this.setCache(result);
        return result;
      }

      log.warn(
        `CredentialManager: loader "${loader.name}" failed — ${result.error ?? "unknown error"}.`
      );
    }

    return {
      success:     false,
      credentials: [],
      source:      "UNKNOWN" as LoadResult["source"],
      error:       "All credential loaders failed. Verify your env vars or credentials file.",
    };
  }

  /**
   * Get a single credential value by key.
   * Returns null if not found or invalid.
   */
  async get(key: string): Promise<string | null> {
    const result = await this.load();
    if (!result.success) return null;

    const entry = result.credentials.find(
      (c) => c.key === key && c.status === CredentialStatus.VALID
    );
    return entry?.value ?? null;
  }

  /**
   * Get all valid credentials as a flat key-value map.
   */
  async getAll(): Promise<Record<string, string>> {
    const result = await this.load();
    const map: Record<string, string> = {};

    for (const entry of result.credentials) {
      if (entry.status === CredentialStatus.VALID) {
        map[entry.key] = entry.value;
      }
    }

    return map;
  }

  /** Inject a credential manually (useful in tests). */
  inject(entry: CredentialEntry): void {
    if (!this.cache) {
      this.cache = {
        result:    { success: true, credentials: [], source: entry.source },
        expiresAt: Date.now() + this.cacheTtlMs,
      };
    }
    const existing = this.cache.result.credentials.findIndex((c) => c.key === entry.key);
    if (existing >= 0) {
      this.cache.result.credentials[existing] = entry;
    } else {
      this.cache.result.credentials.push(entry);
    }
  }

  /** Clear the cache and force reload on next access. */
  invalidate(): void {
    this.cache = null;
    log.info("CredentialManager: cache invalidated.");
  }

  private setCache(result: LoadResult): void {
    this.cache = {
      result,
      expiresAt: this.cacheTtlMs > 0 ? Date.now() + this.cacheTtlMs : Infinity,
    };
  }
}
