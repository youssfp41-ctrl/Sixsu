import fs   from "fs";
import path from "path";
import { config } from "../config/env";
import { LoggerManager } from "../logger/LoggerManager";

const log = LoggerManager.getLogger("PrefixStore");

const DATA_PATH = path.resolve("data/prefix.json");

interface IBotConfigRepository {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
}

function loadSaved(): string | null {
  try {
    if (fs.existsSync(DATA_PATH)) {
      const raw = JSON.parse(fs.readFileSync(DATA_PATH, "utf8")) as { prefix?: string };
      if (typeof raw.prefix === "string" && raw.prefix.length > 0) {
        return raw.prefix;
      }
    }
  } catch { /* ignore — use env default */ }
  return null;
}

class PrefixStore {
  private _prefix: string;
  private repo: IBotConfigRepository | null = null;

  constructor() {
    const saved  = loadSaved();
    this._prefix = saved ?? config.bot.prefix ?? "/";
  }

  get(): string {
    return this._prefix;
  }

  set(newPrefix: string): void {
    this._prefix = newPrefix;
    this._persistToFile();

    if (this.repo) {
      this.repo.set("prefix", newPrefix).catch((err: unknown) => {
        log.warn("PrefixStore: MongoDB set failed — saved to file only.", {
          error: err instanceof Error ? err.message : String(err),
        });
      });
    }
  }

  /**
   * Wire MongoDB repository after DB connects.
   * Loads the stored prefix from DB — overrides file/env value if present.
   * Seeds DB with current value when no DB entry exists yet.
   */
  async loadFromDatabase(repo: IBotConfigRepository): Promise<void> {
    this.repo = repo;

    try {
      const stored = await repo.get("prefix");

      if (stored && stored.length > 0) {
        this._prefix = stored;
        log.info(`PrefixStore: prefix loaded from MongoDB: "${stored}"`);
      } else {
        await repo.set("prefix", this._prefix);
        log.info(`PrefixStore: prefix seeded to MongoDB: "${this._prefix}"`);
      }
    } catch (err) {
      log.warn("PrefixStore: MongoDB load failed — using file/env value.", {
        prefix: this._prefix,
        error:  err instanceof Error ? err.message : String(err),
      });
    }
  }

  private _persistToFile(): void {
    try {
      const dir = path.dirname(DATA_PATH);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(DATA_PATH, JSON.stringify({ prefix: this._prefix }, null, 2), "utf8");
    } catch { /* best effort */ }
  }
}

export const prefixStore = new PrefixStore();
