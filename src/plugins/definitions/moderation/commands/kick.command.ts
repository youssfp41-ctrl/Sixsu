import { ICommand }      from "../../../../commands/types/ICommand";
import { IPluginContext } from "../../../types/IPluginContext";
import { IModerationService, IResponseBuilder, MOD_SERVICES, fmtDuration } from "../services/IModerationService";

export function createKickCommand(pluginCtx: IPluginContext): ICommand {
  return {
    name: "kick", aliases: ["remove"],
    description: "يطرد مستخدماً مؤقتاً",
    usage: "/kick <userId> [reason]",
    category: "moderation", adminOnly: true, minArgs: 1,

    async execute(ctx) {
      const svc    = pluginCtx.requireService<IModerationService>(MOD_SERVICES.MODERATION);
      const fmt    = pluginCtx.consumeService<IResponseBuilder>(MOD_SERVICES.RESPONSE_BUILDER);
      const userId = ctx.getArg(0)!.trim();
      const reason = ctx.getRemainingText(1) || undefined;
      try {
        const result = await svc.kick(userId, ctx.user.id, reason);
        if (!result.ok) { await ctx.reply(fmt?.warn(result.message) ?? `⚠️ ${result.message}`); return; }
        const kickMins = pluginCtx.getConfig<number>("kickDurationMinutes", 30);
        const lines = [
          `🆔 المستخدم:  ${userId}`,
          `⏱️  المدة:     ${fmtDuration(kickMins * 60_000)}`,
          reason ? `📝 السبب:     ${reason}` : "",
          `👮 بواسطة:   ${ctx.user.id}`,
        ].filter(Boolean);
        await ctx.reply(fmt ? fmt.success("تم الطرد المؤقت", lines) : lines.join("\n"));
      } catch (err) {
        pluginCtx.logger.error("kick command failed.", err);
        await ctx.reply(fmt?.warn("فشل الطرد.") ?? "⚠️ فشل الطرد.");
      }
    },
  };
}
