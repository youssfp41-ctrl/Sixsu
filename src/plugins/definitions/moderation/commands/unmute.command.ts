import { ICommand }      from "../../../../commands/types/ICommand";
import { IPluginContext } from "../../../types/IPluginContext";
import { IModerationService, IResponseBuilder, MOD_SERVICES } from "../services/IModerationService";

export function createUnmuteCommand(pluginCtx: IPluginContext): ICommand {
  return {
    name: "unmute", aliases: ["unsilence"],
    description: "يرفع الكتم عن مستخدم",
    usage: "/unmute <userId>",
    category: "moderation", adminOnly: true, minArgs: 1,

    async execute(ctx) {
      const svc    = pluginCtx.requireService<IModerationService>(MOD_SERVICES.MODERATION);
      const fmt    = pluginCtx.consumeService<IResponseBuilder>(MOD_SERVICES.RESPONSE_BUILDER);
      const userId = ctx.getArg(0)!.trim();
      try {
        const result = await svc.unmute(userId, ctx.user.id);
        if (!result.ok) { await ctx.reply(fmt?.warn(result.message) ?? `⚠️ ${result.message}`); return; }
        const lines = [`🆔 المستخدم:  ${userId}`, `👮 بواسطة:   ${ctx.user.id}`];
        await ctx.reply(fmt ? fmt.success("تم رفع الكتم", lines) : lines.join("\n"));
      } catch (err) {
        pluginCtx.logger.error("unmute command failed.", err);
        await ctx.reply(fmt?.warn("فشل رفع الكتم.") ?? "⚠️ فشل رفع الكتم.");
      }
    },
  };
}
