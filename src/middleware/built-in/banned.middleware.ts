import { IMiddleware }  from "../types/IMiddleware";
import { LoggerManager } from "../../logger/LoggerManager";

const log = LoggerManager.getLogger("Middleware/Banned");

// ─── Types ────────────────────────────────────────────────────────────────────

export interface BanEntry {
  userId:    string;
  reason?:   string;
  bannedAt:  Date;
  expiresAt: Date | null;
  bannedBy?: string;
}

export interface BanOptions {
  reason?:     string;
  durationMs?: number;
  bannedBy?:   string;
}

export interface BanStoreSummary {
  total:     number;
  active:    number;
  permanent: number;
  temporary: number;
  expired:   number;
}

// ─── MongoDB repo interface (loose coupling) ──────────────────────────────────

interface IBanRepository {
  findActive(): Promise<BanEntry[]>;
  upsert(entry: BanEntry): Promise<void>;
  remove(userId: string): Promise<boolean>;
  purgeExpired(): Promise<number>;
}

// ─── BanStore ─────────────────────────────────────────────────────────────────

export class BanStore {
  private readonly bans = new Map<string, BanEntry>();
  private repo: IBanRepository | null = null;

  // ── MongoDB wiring ──────────────────────────────────────────────────────────

  setRepository(repo: IBanRepository): void {
    this.repo = repo;
    log.debug("BanStore: MongoDB repository attached.");
  }

  async loadFromDatabase(): Promise<void> {
    if (!this.repo) return;
    try {
      const active = await this.repo.findActive();
      for (const entry of active) {
        this.bans.set(entry.userId, entry);
      }
      log.info(`BanStore: loaded from MongoDB — ${active.length} active ban(s).`);
    } catch (err) {
      log.warn("BanStore: failed to load from MongoDB — starting with empty store.", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // ── Mutations ───────────────────────────────────────────────────────────────

  ban(userId: string, opts: BanOptions = {}): BanEntry {
    const entry: BanEntry = {
      userId,
      reason:    opts.reason,
      bannedAt:  new Date(),
      expiresAt: opts.durationMs ? new Date(Date.now() + opts.durationMs) : null,
      bannedBy:  opts.bannedBy,
    };

    this.bans.set(userId, entry);

    if (this.repo) {
      this.repo.upsert(entry).catch((err: unknown) => {
        log.warn("BanStore: MongoDB ban failed — ban is active in memory.", {
          userId,
          error: err instanceof Error ? err.message : String(err),
        });
      });
    }

    const expiry = entry.expiresAt
      ? `expires: ${entry.expiresAt.toISOString()}`
      : "permanent";
    log.info(
      `Banned user ${userId} — reason: "${opts.reason ?? "none"}" | ${expiry}` +
      (opts.bannedBy ? ` | by: ${opts.bannedBy}` : "")
    );

    return entry;
  }

  unban(userId: string): boolean {
    const had = this.bans.has(userId);
    if (had) {
      this.bans.delete(userId);

      if (this.repo) {
        this.repo.remove(userId).catch((err: unknown) => {
          log.warn("BanStore: MongoDB unban failed — user is unban in memory.", {
            userId,
            error: err instanceof Error ? err.message : String(err),
          });
        });
      }

      log.info(`Unbanned user ${userId}.`);
    }
    return had;
  }

  // ── Queries ─────────────────────────────────────────────────────────────────

  isBanned(userId: string): boolean {
    const entry = this.bans.get(userId);
    if (!entry) return false;

    if (entry.expiresAt && Date.now() >= entry.expiresAt.getTime()) {
      this.bans.delete(userId);
      if (this.repo) {
        this.repo.remove(userId).catch(() => {});
      }
      log.info(`Temporary ban expired — user ${userId} is now free.`);
      return false;
    }

    return true;
  }

  getEntry(userId: string): BanEntry | null {
    if (!this.isBanned(userId)) return null;
    return this.bans.get(userId) ?? null;
  }

  getAll(): BanEntry[] {
    const now = Date.now();
    const active: BanEntry[] = [];

    for (const [userId, entry] of this.bans) {
      if (entry.expiresAt && now >= entry.expiresAt.getTime()) {
        this.bans.delete(userId);
        if (this.repo) this.repo.remove(userId).catch(() => {});
      } else {
        active.push(entry);
      }
    }

    return active;
  }

  summary(): BanStoreSummary {
    const all      = Array.from(this.bans.values());
    const now      = Date.now();
    const active   = all.filter((e) => !e.expiresAt || now < e.expiresAt.getTime());
    const expired  = all.length - active.length;
    const permanent = active.filter((e) => !e.expiresAt).length;
    const temporary = active.filter((e) => !!e.expiresAt).length;
    return { total: all.length, active: active.length, permanent, temporary, expired };
  }

  purgeExpired(): number {
    const now     = Date.now();
    let   removed = 0;
    for (const [userId, entry] of this.bans) {
      if (entry.expiresAt && now >= entry.expiresAt.getTime()) {
        this.bans.delete(userId);
        removed++;
      }
    }
    if (removed > 0) {
      log.info(`Purged ${removed} expired ban(s).`);
      if (this.repo) this.repo.purgeExpired().catch(() => {});
    }
    return removed;
  }

  get size(): number {
    return this.bans.size;
  }
}

// ─── Middleware factory ───────────────────────────────────────────────────────

export interface BannedMiddlewareOptions {
  store:    BanStore;
  message?: (entry: BanEntry) => string;
  silent?:  boolean;
}

export function createBannedMiddleware(opts: BannedMiddlewareOptions): IMiddleware {
  return {
    name:        "banned",
    description: "Blocks banned users from executing any command",
    handle: async (ctx, _command, next) => {
      const entry = opts.store.getEntry(ctx.user.id);

      if (!entry) {
        await next();
        return;
      }

      const reason = entry.reason ? ` السبب: ${entry.reason}.` : "";
      const expiry = entry.expiresAt
        ? ` انتهاء الحظر: ${entry.expiresAt.toLocaleString()}.`
        : " الحظر دائم.";

      log.warn(
        `Banned user ${ctx.user.id} tried to use bot — blocked.` +
        (entry.reason ? ` Reason: ${entry.reason}` : "")
      );

      if (!opts.silent) {
        const msg =
          opts.message?.(entry) ??
          `🚫 أنت محظور من استخدام البوت.${reason}${expiry}`;
        await ctx.reply(msg);
      }
    },
  };
}
