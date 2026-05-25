/**
 * Moderation Plugin — Sixsu Bot
 *
 * Commands (all adminOnly):
 *   /ban      — permanent or timed ban  (/ban <userId> [30m] [reason])
 *   /unban    — lift a ban
 *   /warn     — warning; auto-bans after maxWarnings threshold
 *   /mute     — interaction block       (/mute <userId> [30m] [reason])
 *   /unmute   — lift a mute
 *   /kick     — configurable-duration kick (/kick <userId> [reason])
 *
 * Services provided:
 *   "moderation-service" — IModerationService (consumed by other plugins)
 *
 * Services consumed (registered by bootstrap):
 *   "ban-store"          — BanStore
 *   "response-builder"   — IResponseBuilder (utility plugin)
 *
 * Config keys:
 *   maxWarnings          (default 3)
 *   autoBanDurationMs    (default 0 = permanent)
 *   kickDurationMinutes  (default 30)
 */

import { IPlugin, PluginManifest }  from "../../types/IPlugin";
import { IPluginContext }            from "../../types/IPluginContext";
import { BanStore }                  from "../../../../middleware/built-in/banned.middleware";
import { ModerationRepository }     from "./db/ModerationRepository";
import { ModerationService }        from "./services/ModerationService";
import { MOD_SERVICES, IModerationService } from "./services/IModerationService";
import { createBanCommand }    from "./commands/ban.command";
import { createUnbanCommand }  from "./commands/unban.command";
import { createWarnCommand }   from "./commands/warn.command";
import { createMuteCommand }   from "./commands/mute.command";
import { createUnmuteCommand } from "./commands/unmute.command";
import { createKickCommand }   from "./commands/kick.command";

export class ModerationPlugin implements IPlugin {
  readonly manifest: PluginManifest = {
    name:        "moderation",
    version:     "1.0.0",
    description: "Database-backed moderation: ban, unban, warn, mute, unmute, kick.",
    author:      "Sixsu",
    dependencies: [],
    defaultConfig: {
      maxWarnings:         3,
      autoBanDurationMs:   0,
      kickDurationMinutes: 30,
    },
  };

  private ctx?: IPluginContext;

  async onLoad(ctx: IPluginContext): Promise<void> {
    this.ctx = ctx;
    ctx.logger.info("Moderation plugin loaded.");
  }

  async onEnable(): Promise<void> {
    if (!this.ctx) return;
    const ctx = this.ctx;

    const banStore = ctx.consumeService<BanStore>(MOD_SERVICES.BAN_STORE);

    if (!banStore) {
      ctx.logger.warn(
        `Core service "${MOD_SERVICES.BAN_STORE}" not found. ` +
        `Register it in bootstrap: svcReg.provide("ban-store", banStore, "core"). ` +
        `In-memory enforcement disabled — DB audit trail still active.`
      );
    }

    const svc = new ModerationService(
      new ModerationRepository(),
      banStore ?? new BanStore(),
      ctx.logger,
      {
        maxWarnings:       ctx.getConfig<number>("maxWarnings", 3),
        autoBanDurationMs: ctx.getConfig<number>("autoBanDurationMs", 0),
        kickDurationMs:    ctx.getConfig<number>("kickDurationMinutes", 30) * 60_000,
      },
    );

    ctx.provideService<IModerationService>(MOD_SERVICES.MODERATION, svc);

    ctx.registerCommand(createBanCommand(ctx));
    ctx.registerCommand(createUnbanCommand(ctx));
    ctx.registerCommand(createWarnCommand(ctx));
    ctx.registerCommand(createMuteCommand(ctx));
    ctx.registerCommand(createUnmuteCommand(ctx));
    ctx.registerCommand(createKickCommand(ctx));

    // Purge expired bans from BanStore every 5 minutes
    ctx.scheduleRecurring({
      name:       "moderation:purge-expired",
      intervalMs: 5 * 60_000,
      fn: async () => {
        const removed = banStore?.purgeExpired() ?? 0;
        if (removed > 0) {
          ctx.logger.info(`Moderation: purged ${removed} expired entry(ies) from BanStore.`);
        }
      },
    });

    ctx.logger.info(
      "Moderation plugin enabled — commands: [ban, unban, warn, mute, unmute, kick]."
    );
  }

  async onDisable(): Promise<void> {
    this.ctx?.logger.info("Moderation plugin disabled.");
  }

  async onUnload(): Promise<void> {
    this.ctx?.logger.info("Moderation plugin unloaded.");
    this.ctx = undefined;
  }
}

export default ModerationPlugin;
