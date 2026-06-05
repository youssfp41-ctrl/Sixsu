import fs   from "fs";
import path from "path";
import { IMiddleware }   from "../types/IMiddleware";
import { LoggerManager } from "../../logger/LoggerManager";

const log = LoggerManager.getLogger("Middleware/Lockdown");

// ─── Persistent store ─────────────────────────────────────────────────────────

interface StoreData {
  threads: Record<string, boolean>;
}

const DATA_PATH = path.resolve("data/lockdown.json");

function loadData(): StoreData {
  try {
    if (fs.existsSync(DATA_PATH)) {
      return JSON.parse(fs.readFileSync(DATA_PATH, "utf8")) as StoreData;
    }
  } catch {
    log.warn("LockdownStore: failed to load data — starting fresh.");
  }
  return { threads: {} };
}

function saveData(data: StoreData): void {
  const dir = path.dirname(DATA_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2), "utf8");
}

// ─── LockdownStore ────────────────────────────────────────────────────────────

export class LockdownStore {
  private data: StoreData;

  constructor() {
    this.data = loadData();
    log.info("LockdownStore initialized.", {
      lockedThreads: this.lockedCount,
    });
  }

  enable(threadId: string): void {
    this.data.threads[threadId] = true;
    saveData(this.data);
    log.info("Lockdown enabled.", { threadId });
  }

  disable(threadId: string): void {
    this.data.threads[threadId] = false;
    saveData(this.data);
    log.info("Lockdown disabled.", { threadId });
  }

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

      if (ctx.hasRole("admin")) {
        await next();
        return;
      }

      log.debug("Lockdown: blocked non-admin command.", {
        threadId: ctx.thread.id,
        userId:   ctx.user.id,
        cmd:      (ctx.message.text ?? "").slice(0, 60),
      });
      // Silent drop — chain stops here, no reply sent
    },
  };
}
