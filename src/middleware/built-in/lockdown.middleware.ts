import fs   from "fs";
import path from "path";
import { IMiddleware }   from "../types/IMiddleware";
import { LoggerManager } from "../../logger/LoggerManager";

const log = LoggerManager.getLogger("Middleware/Lockdown");

// ─── File-based fallback ──────────────────────────────────────────────────────

interface StoreData {
  threads: Record<string, boolean>;
}

const DATA_PATH = path.resolve("data/lockdown.json");

function loadFromFile(): StoreData {
  try {
    if (fs.existsSync(DATA_PATH)) {
      return JSON.parse(fs.readFileSync(DATA_PATH, "utf8")) as StoreData;
    }
  } catch {
    log.warn("LockdownStore: failed to load file — starting fresh.");
  }
  return { threads: {} };
}

function saveToFile(data: StoreData): void {
  try {
    const dir = path.dirname(DATA_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2), "utf8");
  } catch (err) {
    log.warn("LockdownStore: failed to write file.", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// ─── MongoDB repo interface (loose coupling) ──────────────────────────────────

interface IGroupSettingsRepository {
  setLockdown(threadId: string, enabled: boolean): Promise<void>;
  getLockedThreadIds(): Promise<string[]>;
}

// ─── LockdownStore ────────────────────────────────────────────────────────────

export class LockdownStore {
  private data: StoreData;
  private repo: IGroupSettingsRepository | null = null;

  constructor() {
    this.data = loadFromFile();
    log.info("LockdownStore initialized.", { lockedThreads: this.lockedCount });
  }

  // ── MongoDB wiring ──────────────────────────────────────────────────────────

  setRepository(repo: IGroupSettingsRepository): void {
    this.repo = repo;
    log.debug("LockdownStore: MongoDB repository attached.");
  }

  async loadFromDatabase(): Promise<void> {
    if (!this.repo) return;
    try {
      const lockedIds = await this.repo.getLockedThreadIds();
      for (const id of lockedIds) {
        this.data.threads[id] = true;
      }
      log.info(`LockdownStore: loaded from MongoDB — ${lockedIds.length} locked thread(s).`);
    } catch (err) {
      log.warn("LockdownStore: failed to load from MongoDB — using file data.", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // ── Mutations ───────────────────────────────────────────────────────────────

  enable(threadId: string): void {
    this.data.threads[threadId] = true;

    if (this.repo) {
      this.repo.setLockdown(threadId, true).catch((err: unknown) => {
        log.warn("LockdownStore: MongoDB enable failed — state active in memory.", {
          threadId,
          error: err instanceof Error ? err.message : String(err),
        });
        saveToFile(this.data);
      });
    } else {
      saveToFile(this.data);
    }

    log.info("Lockdown enabled.", { threadId });
  }

  disable(threadId: string): void {
    this.data.threads[threadId] = false;

    if (this.repo) {
      this.repo.setLockdown(threadId, false).catch((err: unknown) => {
        log.warn("LockdownStore: MongoDB disable failed — state updated in memory.", {
          threadId,
          error: err instanceof Error ? err.message : String(err),
        });
        saveToFile(this.data);
      });
    } else {
      saveToFile(this.data);
    }

    log.info("Lockdown disabled.", { threadId });
  }

  // ── Queries ─────────────────────────────────────────────────────────────────

  isLocked(threadId: string): boolean {
    return this.data.threads[threadId] === true;
  }

  getLockedThreads(): string[] {
    return Object.entries(this.data.threads)
      .filter(([, v]) => v)
      .map(([k]) => k);
  }

  get lockedCount(): number {
    return this.getLockedThreads().length;
  }
}

// ─── Middleware ───────────────────────────────────────────────────────────────

export interface LockdownMiddlewareOptions {
  store: LockdownStore;
}

export function createLockdownMiddleware(opts: LockdownMiddlewareOptions): IMiddleware {
  return {
    name:        "lockdown",
    description: "Silently blocks non-admin commands when lockdown is active for a thread",
    handle: async (ctx, _command, next) => {
      if (!opts.store.isLocked(ctx.thread.id)) {
        await next();
        return;
      }

      // Admins bypass lockdown (ctx.hasRole("admin") now reflects AdminStore too)
      if (ctx.hasRole("admin")) {
        await next();
        return;
      }

      log.debug("Lockdown: blocked non-admin command.", {
        threadId: ctx.thread.id,
        userId:   ctx.user.id,
        cmd:      (ctx.message.text ?? "").slice(0, 60),
      });
      // Silent drop — chain stops here
    },
  };
}
