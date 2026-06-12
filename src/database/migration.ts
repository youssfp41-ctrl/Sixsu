import fs   from "fs";
import path from "path";
import { LoggerManager } from "../logger/LoggerManager";

const log = LoggerManager.getLogger("Migration");

// ─── Lazy model imports (avoid circular deps at startup) ─────────────────────

// eslint-disable-next-line @typescript-eslint/no-require-imports
const getModels = () => ({
  BotConfigModel:    require("./models/bot-config.model").BotConfigModel    as import("./models/bot-config.model").BotConfigDocument extends { save(): unknown } ? typeof import("./models/bot-config.model").BotConfigModel : never,
  BlackConfigModel:  require("./models/black-config.model").BlackConfigModel as typeof import("./models/black-config.model").BlackConfigModel,
  BotAdminModel:     require("./models/botadmin.model").BotAdminModel        as typeof import("./models/botadmin.model").BotAdminModel,
  GroupSettingsModel:require("./models/group-settings.model").GroupSettingsModel as typeof import("./models/group-settings.model").GroupSettingsModel,
  BanModel:          require("./models/ban.model").BanModel                  as typeof import("./models/ban.model").BanModel,
});

// ─── Flag file ────────────────────────────────────────────────────────────────

const DONE_FLAG = path.resolve("data/.migration-done");

function hasDone(): boolean {
  return fs.existsSync(DONE_FLAG);
}

function markDone(): void {
  try {
    const dir = path.dirname(DONE_FLAG);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(DONE_FLAG, new Date().toISOString(), "utf8");
  } catch { /* best effort */ }
}

// ─── Per-collection migrations ────────────────────────────────────────────────

async function migratePrefix(BotConfigModel: ReturnType<typeof getModels>["BotConfigModel"]): Promise<number> {
  const src = path.resolve("data/prefix.json");
  if (!fs.existsSync(src)) return 0;

  let count = 0;
  try {
    const raw  = JSON.parse(fs.readFileSync(src, "utf8")) as { prefix?: string };
    const pref = raw.prefix;
    if (pref && pref.length > 0) {
      await (BotConfigModel as unknown as {
        findOneAndUpdate(f: unknown, u: unknown, o: unknown): { exec(): Promise<unknown> }
      }).findOneAndUpdate(
        { key: "prefix" },
        { $set: { value: pref, updatedAt: new Date() }, $setOnInsert: { key: "prefix" } },
        { upsert: true }
      ).exec();
      log.info(`Migration: prefix → "${pref}"`);
      count = 1;
    }
  } catch (err) {
    log.warn("Migration: prefix failed.", { error: String(err) });
  }
  return count;
}

async function migrateBlack(BlackConfigModel: ReturnType<typeof getModels>["BlackConfigModel"]): Promise<number> {
  const src = path.resolve("data/black-plugin.json");
  if (!fs.existsSync(src)) return 0;

  let count = 0;
  try {
    const raw = JSON.parse(fs.readFileSync(src, "utf8")) as {
      threads?: Record<string, { message: string; intervalSec: number; active: boolean; lastSentAt: string | null }>;
    };

    for (const [threadId, cfg] of Object.entries(raw.threads ?? {})) {
      await BlackConfigModel.findOneAndUpdate(
        { threadId },
        {
          $set:         {
            message:     cfg.message,
            intervalSec: cfg.intervalSec,
            active:      cfg.active,
            lastSentAt:  cfg.lastSentAt ? new Date(cfg.lastSentAt) : null,
            updatedAt:   new Date(),
          },
          $setOnInsert: { threadId },
        },
        { upsert: true }
      ).exec();
      count++;
    }
    if (count > 0) log.info(`Migration: black-config → ${count} thread(s).`);
  } catch (err) {
    log.warn("Migration: black-config failed.", { error: String(err) });
  }
  return count;
}

async function migrateAdmins(BotAdminModel: ReturnType<typeof getModels>["BotAdminModel"]): Promise<number> {
  const src = path.resolve("data/admin-store.json");
  if (!fs.existsSync(src)) return 0;

  let count = 0;
  try {
    const raw  = JSON.parse(fs.readFileSync(src, "utf8")) as { admins?: string[] };
    for (const fbId of (raw.admins ?? [])) {
      await BotAdminModel.findOneAndUpdate(
        { fbId },
        { $setOnInsert: { fbId, addedBy: "migration:file", addedAt: new Date() } },
        { upsert: true }
      ).exec();
      count++;
    }
    if (count > 0) log.info(`Migration: bot-admins → ${count} record(s).`);
  } catch (err) {
    log.warn("Migration: bot-admins failed.", { error: String(err) });
  }
  return count;
}

async function migrateLockdown(GroupSettingsModel: ReturnType<typeof getModels>["GroupSettingsModel"]): Promise<number> {
  const src = path.resolve("data/lockdown.json");
  if (!fs.existsSync(src)) return 0;

  let count = 0;
  try {
    const raw = JSON.parse(fs.readFileSync(src, "utf8")) as { threads?: Record<string, boolean> };
    for (const [threadId, locked] of Object.entries(raw.threads ?? {})) {
      await GroupSettingsModel.findOneAndUpdate(
        { threadId },
        {
          $set:         { lockdown: !!locked, updatedAt: new Date() },
          $setOnInsert: { threadId },
        },
        { upsert: true }
      ).exec();
      count++;
    }
    if (count > 0) log.info(`Migration: lockdown → ${count} thread(s).`);
  } catch (err) {
    log.warn("Migration: lockdown failed.", { error: String(err) });
  }
  return count;
}

async function migrateBans(BanModel: ReturnType<typeof getModels>["BanModel"]): Promise<number> {
  const src = path.resolve("data/bans.json");
  if (!fs.existsSync(src)) return 0;

  let count = 0;
  try {
    const raw = JSON.parse(fs.readFileSync(src, "utf8")) as {
      bans?: Record<string, { reason?: string; bannedAt: string; expiresAt: string | null; bannedBy?: string }>;
    };
    for (const [userId, ban] of Object.entries(raw.bans ?? {})) {
      await BanModel.findOneAndUpdate(
        { userId },
        {
          $set: {
            reason:    ban.reason,
            bannedAt:  new Date(ban.bannedAt),
            expiresAt: ban.expiresAt ? new Date(ban.expiresAt) : null,
            bannedBy:  ban.bannedBy,
          },
          $setOnInsert: { userId },
        },
        { upsert: true }
      ).exec();
      count++;
    }
    if (count > 0) log.info(`Migration: bans → ${count} record(s).`);
  } catch (err) {
    log.warn("Migration: bans failed.", { error: String(err) });
  }
  return count;
}

// ─── Main entry ───────────────────────────────────────────────────────────────

/**
 * Runs once per deployment when data/*.json files exist.
 * Imports file-based data into MongoDB and stamps a flag so it never re-runs.
 */
export async function runMigrationIfNeeded(): Promise<void> {
  if (hasDone()) {
    log.debug("Migration: already done — skipping.");
    return;
  }

  const dataDir = path.resolve("data");
  const hasAnyJson = fs.existsSync(dataDir) &&
    fs.readdirSync(dataDir).some((f) => f.endsWith(".json"));

  if (!hasAnyJson) {
    log.debug("Migration: no JSON data files found — nothing to migrate.");
    markDone();
    return;
  }

  log.info("Migration: JSON data found — starting import to MongoDB...");

  const { BotConfigModel, BlackConfigModel, BotAdminModel, GroupSettingsModel, BanModel } = getModels();

  const results = await Promise.all([
    migratePrefix(BotConfigModel as unknown as Parameters<typeof migratePrefix>[0]),
    migrateBlack(BlackConfigModel),
    migrateAdmins(BotAdminModel),
    migrateLockdown(GroupSettingsModel),
    migrateBans(BanModel),
  ]);

  const total = results.reduce((s, n) => s + n, 0);
  log.info(`Migration: complete — ${total} record(s) imported to MongoDB.`);
  markDone();
}
