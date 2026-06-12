/**
 * Standalone migration script.
 * Run with: npx ts-node -r tsconfig-paths/register scripts/src/migrate-mongodb.ts
 *
 * Reads existing data/*.json files and imports them into MongoDB.
 * Safe to run multiple times (upserts, not inserts).
 */

import dotenv from "dotenv";
dotenv.config();

import fs   from "fs";
import path from "path";
import mongoose from "mongoose";

import { BotConfigModel }     from "../../src/database/models/bot-config.model";
import { BlackConfigModel }   from "../../src/database/models/black-config.model";
import { BotAdminModel }      from "../../src/database/models/botadmin.model";
import { GroupSettingsModel } from "../../src/database/models/group-settings.model";
import { BanModel }           from "../../src/database/models/ban.model";

const MONGODB_URI = process.env["MONGODB_URI"] ?? "";

async function main(): Promise<void> {
  if (!MONGODB_URI) {
    console.error("❌ MONGODB_URI is not set in environment.");
    process.exit(1);
  }

  console.log("🔌 Connecting to MongoDB...");
  await mongoose.connect(MONGODB_URI, {
    serverSelectionTimeoutMS: 15_000,
    socketTimeoutMS:          45_000,
  });
  console.log(`✅ Connected to ${mongoose.connection.host}/${mongoose.connection.name}`);

  let total = 0;

  // ── Prefix ──────────────────────────────────────────────────────────────────
  const prefixPath = path.resolve("data/prefix.json");
  if (fs.existsSync(prefixPath)) {
    try {
      const raw = JSON.parse(fs.readFileSync(prefixPath, "utf8")) as { prefix?: string };
      if (raw.prefix) {
        await BotConfigModel.findOneAndUpdate(
          { key: "prefix" },
          { $set: { value: raw.prefix, updatedAt: new Date() }, $setOnInsert: { key: "prefix" } },
          { upsert: true }
        ).exec();
        console.log(`  ✅ Prefix migrated: "${raw.prefix}"`);
        total++;
      }
    } catch (err) { console.warn("  ⚠️ Prefix:", err); }
  }

  // ── Black plugin ─────────────────────────────────────────────────────────────
  const blackPath = path.resolve("data/black-plugin.json");
  if (fs.existsSync(blackPath)) {
    try {
      const raw = JSON.parse(fs.readFileSync(blackPath, "utf8")) as {
        threads?: Record<string, { message: string; intervalSec: number; active: boolean; lastSentAt: string | null }>;
      };
      let n = 0;
      for (const [threadId, cfg] of Object.entries(raw.threads ?? {})) {
        await BlackConfigModel.findOneAndUpdate(
          { threadId },
          {
            $set:         { message: cfg.message, intervalSec: cfg.intervalSec, active: cfg.active, lastSentAt: cfg.lastSentAt ? new Date(cfg.lastSentAt) : null, updatedAt: new Date() },
            $setOnInsert: { threadId },
          },
          { upsert: true }
        ).exec();
        n++;
      }
      console.log(`  ✅ Black configs migrated: ${n} thread(s)`);
      total += n;
    } catch (err) { console.warn("  ⚠️ Black:", err); }
  }

  // ── Admins ───────────────────────────────────────────────────────────────────
  const adminPath = path.resolve("data/admin-store.json");
  if (fs.existsSync(adminPath)) {
    try {
      const raw = JSON.parse(fs.readFileSync(adminPath, "utf8")) as { admins?: string[] };
      let n = 0;
      for (const fbId of (raw.admins ?? [])) {
        await BotAdminModel.findOneAndUpdate(
          { fbId },
          { $setOnInsert: { fbId, addedBy: "migration:file", addedAt: new Date() } },
          { upsert: true }
        ).exec();
        n++;
      }
      console.log(`  ✅ Admins migrated: ${n} record(s)`);
      total += n;
    } catch (err) { console.warn("  ⚠️ Admins:", err); }
  }

  // ── Lockdown ─────────────────────────────────────────────────────────────────
  const lockdownPath = path.resolve("data/lockdown.json");
  if (fs.existsSync(lockdownPath)) {
    try {
      const raw = JSON.parse(fs.readFileSync(lockdownPath, "utf8")) as { threads?: Record<string, boolean> };
      let n = 0;
      for (const [threadId, locked] of Object.entries(raw.threads ?? {})) {
        await GroupSettingsModel.findOneAndUpdate(
          { threadId },
          { $set: { lockdown: !!locked, updatedAt: new Date() }, $setOnInsert: { threadId } },
          { upsert: true }
        ).exec();
        n++;
      }
      console.log(`  ✅ Lockdown migrated: ${n} thread(s)`);
      total += n;
    } catch (err) { console.warn("  ⚠️ Lockdown:", err); }
  }

  // ── Bans ─────────────────────────────────────────────────────────────────────
  const bansPath = path.resolve("data/bans.json");
  if (fs.existsSync(bansPath)) {
    try {
      const raw = JSON.parse(fs.readFileSync(bansPath, "utf8")) as {
        bans?: Record<string, { reason?: string; bannedAt: string; expiresAt: string | null; bannedBy?: string }>;
      };
      let n = 0;
      for (const [userId, ban] of Object.entries(raw.bans ?? {})) {
        await BanModel.findOneAndUpdate(
          { userId },
          {
            $set:         { reason: ban.reason, bannedAt: new Date(ban.bannedAt), expiresAt: ban.expiresAt ? new Date(ban.expiresAt) : null, bannedBy: ban.bannedBy },
            $setOnInsert: { userId },
          },
          { upsert: true }
        ).exec();
        n++;
      }
      console.log(`  ✅ Bans migrated: ${n} record(s)`);
      total += n;
    } catch (err) { console.warn("  ⚠️ Bans:", err); }
  }

  console.log(`\n🎉 Migration complete — ${total} total record(s) imported to MongoDB.`);
  await mongoose.disconnect();
  console.log("🔌 Disconnected.");
}

main().catch((err) => {
  console.error("❌ Migration failed:", err);
  mongoose.disconnect().finally(() => process.exit(1));
});
