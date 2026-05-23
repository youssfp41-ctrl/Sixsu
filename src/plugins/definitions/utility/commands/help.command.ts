import { ICommand }          from "../../../../commands/types/ICommand";
import { IPluginContext }     from "../../../types/IPluginContext";
import {
  ICommandLookup,
  IResponseBuilder,
  SERVICES,
} from "../services/IUtilityServices";

/**
 * /help [command]
 *
 * Without arguments: lists all visible commands grouped by category.
 * With argument: shows detailed info for a single command.
 *
 * Consumes "command-registry" service (registered by bootstrap).
 */
export function createHelpCommand(pluginCtx: IPluginContext): ICommand {
  return {
    name:        "help",
    aliases:     ["h", "?"],
    description: "يعرض قائمة الأوامر أو تفاصيل أمر محدد",
    usage:       "/help [command]",
    category:    "utility",

    async execute(ctx) {
      const reg = pluginCtx.consumeService<ICommandLookup>(SERVICES.COMMAND_REGISTRY);
      const fmt = pluginCtx.consumeService<IResponseBuilder>(SERVICES.RESPONSE_BUILDER);

      if (!reg) {
        await ctx.reply(fmt?.warn("CommandRegistry غير متاح.") ?? "⚠️ الخدمة غير متاحة.");
        return;
      }

      const target = ctx.getArg(0);

      // ── Single command details ──────────────────────────────────────────
      if (target) {
        const cmd = reg.resolve(target.toLowerCase());
        if (!cmd) {
          await ctx.reply(`❓ الأمر "${target}" غير موجود. جرّب /help لقائمة الأوامر.`);
          return;
        }

        const lines: string[] = [
          `📌 ${cmd.name}`,
          cmd.description ? `   ${cmd.description}` : "",
          ``,
          cmd.usage      ? `📎 الاستخدام:    ${cmd.usage}`                        : "",
          cmd.aliases?.length
            ? `🔤 المختصرات:    ${cmd.aliases.join(", ")}` : "",
          cmd.category   ? `🏷️  الفئة:        ${cmd.category}`                    : "",
          cmd.cooldownMs ? `⏱️  Cooldown:     ${cmd.cooldownMs / 1000}s`           : "",
          cmd.minArgs    ? `📥 min args:     ${cmd.minArgs}`                       : "",
          cmd.maxArgs    ? `📤 max args:     ${cmd.maxArgs}`                       : "",
          cmd.adminOnly  ? `🔒 للمشرفين فقط`                                      : "",
        ].filter(Boolean);

        await ctx.reply(lines.join("\n"));
        return;
      }

      // ── Full command listing ────────────────────────────────────────────
      const byCategory = reg.byCategory();

      if (byCategory.size === 0) {
        await ctx.reply("📭 لا توجد أوامر مسجّلة حالياً.");
        return;
      }

      const sections: string[] = [];

      for (const [cat, cmds] of byCategory) {
        const header = `【 ${cat.toUpperCase()} 】`;
        const list = cmds
          .sort((a, b) => a.name.localeCompare(b.name))
          .map((c) => {
            const aliases = c.aliases?.length ? ` (${c.aliases.join(", ")})` : "";
            const lock    = c.adminOnly ? " 🔒" : "";
            const desc    = c.description ? ` — ${c.description}` : "";
            return `  • ${c.name}${aliases}${lock}${desc}`;
          })
          .join("\n");
        sections.push(`${header}\n${list}`);
      }

      const visible = reg.getAll().filter((c) => !c.hidden).length;
      const footer  =
        `\n─────────────────────\n` +
        `📊 ${visible} أمر متاح | /help <command> للتفاصيل`;

      await ctx.reply(sections.join("\n\n") + footer);
    },
  };
}
