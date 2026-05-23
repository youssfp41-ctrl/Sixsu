import { ICommand }          from "../../../../commands/types/ICommand";
import { IPluginContext }     from "../../../types/IPluginContext";
import {
  IResponseBuilder,
  SERVICES,
} from "../services/IUtilityServices";

/**
 * /ping — measures Facebook API call latency.
 *
 * Times the round-trip of a typingOn() indicator call (which hits the
 * Send API) and reports it as a proxy for current API latency.
 */
export function createPingCommand(pluginCtx: IPluginContext): ICommand {
  return {
    name:        "ping",
    aliases:     ["p"],
    description: "يقيس زمن استجابة البوت والـ API",
    usage:       "/ping",
    category:    "utility",

    async execute(ctx) {
      const fmt = pluginCtx.consumeService<IResponseBuilder>(SERVICES.RESPONSE_BUILDER);

      const start   = Date.now();
      await ctx.typingOn();
      const latency = Date.now() - start;

      const uptimeSec = Math.floor(process.uptime());
      const h  = Math.floor(uptimeSec / 3600);
      const m  = Math.floor((uptimeSec % 3600) / 60);
      const s  = uptimeSec % 60;
      const uptimeStr = [
        h > 0 ? `${h}h` : "",
        m > 0 ? `${m}m` : "",
        `${s}s`,
      ].filter(Boolean).join(" ");

      const emoji = latency < 200 ? "🟢" : latency < 500 ? "🟡" : "🔴";

      const lines = [
        `🏓 Pong!`,
        `${emoji} Latency:  ${latency}ms`,
        `⏱️  Uptime:   ${uptimeStr}`,
      ];

      await ctx.reply(fmt ? fmt.info(lines) : lines.join("\n"));
    },
  };
}
