/**
 * Utility Plugin — Sixsu Bot
 *
 * Provides core user-facing utility commands and a shared response formatter.
 *
 * Commands registered:
 *   /ping      — API latency + uptime snapshot
 *   /help      — full command listing or single-command details
 *   /uptime    — process uptime, memory, CPU, Node version
 *   /avatar    — user's Facebook profile picture URL
 *   /userinfo  — user identity, conversation, and timestamp
 *
 * Services provided (consumed by other plugins):
 *   "response-builder"   — IResponseBuilder: consistent message formatting
 *
 * Services consumed (registered by bootstrap):
 *   "command-registry"   — CommandRegistry  (for /help)
 *   "fb-access-token"    — string           (for Graph API calls)
 *
 * Internal services (created on enable, auto-disposed on disable):
 *   "fb-profile-service" — IFacebookProfileService (avatar + userinfo)
 */

import { IPlugin, PluginManifest }   from "../../types/IPlugin";
import { IPluginContext }             from "../../types/IPluginContext";
import { ResponseBuilder }           from "./services/ResponseBuilder";
import { FacebookProfileService }    from "./services/FacebookProfileService";
import { SERVICES }                  from "./services/IUtilityServices";
import { createPingCommand }         from "./commands/ping.command";
import { createHelpCommand }         from "./commands/help.command";
import { createUptimeCommand }       from "./commands/uptime.command";
import { createAvatarCommand }       from "./commands/avatar.command";
import { createUserinfoCommand }     from "./commands/userinfo.command";

export class UtilityPlugin implements IPlugin {
  readonly manifest: PluginManifest = {
    name:        "utility",
    version:     "1.0.0",
    description: "Core utility commands: ping, help, uptime, avatar, userinfo.",
    author:      "Sixsu",
    dependencies: [],
    defaultConfig: {
      /** Timeout for Facebook Graph API profile requests (ms). */
      profileTimeoutMs: 8_000,
    },
  };

  private ctx?: IPluginContext;

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  async onLoad(ctx: IPluginContext): Promise<void> {
    this.ctx = ctx;

    // Provide ResponseBuilder immediately on load so it's available
    // to other plugins even if this plugin hasn't been enabled yet.
    ctx.provideService<ResponseBuilder>(SERVICES.RESPONSE_BUILDER, new ResponseBuilder());

    ctx.logger.info("Utility plugin loaded.");
  }

  async onEnable(): Promise<void> {
    if (!this.ctx) return;
    const ctx = this.ctx;

    // ── Internal profile service ─────────────────────────────────────────
    const token = ctx.consumeService<string>(SERVICES.FB_ACCESS_TOKEN);

    if (token) {
      const timeout = ctx.getConfig<number>("profileTimeoutMs", 8_000);
      ctx.provideService(
        SERVICES.FB_PROFILE,
        new FacebookProfileService(token, timeout),
      );
      ctx.logger.info("FacebookProfileService registered (Graph API enabled).");
    } else {
      ctx.logger.warn(
        `Core service "${SERVICES.FB_ACCESS_TOKEN}" not found — ` +
        `/avatar and /userinfo will have limited info. ` +
        `Make sure bootstrap registers it via pluginManager.getServiceRegistry().`
      );
    }

    // ── Commands ─────────────────────────────────────────────────────────
    ctx.registerCommand(createPingCommand(ctx));
    ctx.registerCommand(createHelpCommand(ctx));
    ctx.registerCommand(createUptimeCommand(ctx));
    ctx.registerCommand(createAvatarCommand(ctx));
    ctx.registerCommand(createUserinfoCommand(ctx));

    ctx.logger.info(
      "Utility plugin enabled — commands: [ping, help, uptime, avatar, userinfo]."
    );
  }

  async onDisable(): Promise<void> {
    this.ctx?.logger.info("Utility plugin disabled.");
    // All commands, the profile service, and event listeners are
    // auto-removed by PluginContext.dispose() — no manual cleanup needed.
  }

  async onUnload(): Promise<void> {
    this.ctx?.logger.info("Utility plugin unloaded.");
    this.ctx = undefined;
  }
}

export default UtilityPlugin;
