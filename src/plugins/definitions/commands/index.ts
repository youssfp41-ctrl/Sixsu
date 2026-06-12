import { IPlugin, PluginManifest }                    from "../../types/IPlugin";
import { IPluginContext }                              from "../../types/IPluginContext";
import { ICommand }                                   from "../../../commands/types/ICommand";
import { Context }                                    from "../../../context/Context";
import { prefixStore }                               from "../../../prefix/PrefixStore";
import {
  buildCommandsMessage,
  buildCategoryMessage,
  resolveCategory,
} from "../../../ui/BotUI";

// ─── Command ─────────────────────────────────────────────────────────────────

function makeCommand(_pCtx: IPluginContext): ICommand {
  return {
    name:        "اوامر",
    aliases:     ["commands", "cmds", "أوامر", "help", "مساعدة"],
    description: "عرض قائمة أوامر البوت — أو تصفيتها: اوامر [نظام|خاصة|ادارة]",
    usage:       "اوامر | اوامر [نظام|خاصة|ادارة]",
    category:    "util",
    adminOnly:   false,
    hidden:      false,

    async execute(ctx: Context): Promise<void> {
      await ctx.typingOn();

      const prefix  = prefixStore.get();
      const filter  = ctx.args[0]?.trim();

      // ── Category filter ─────────────────────────────────────────────────
      if (filter) {
        const cat = resolveCategory(filter);
        if (cat) {
          await ctx.reply(buildCategoryMessage(cat, prefix));
          return;
        }
        // Unknown filter — fall through to full menu with a hint
        await ctx.reply(
          buildCommandsMessage(prefix, ctx.hasRole("admin")) +
          `\n\n⚠️ القسم "${filter}" غير موجود. الأقسام: نظام · خاصة · ادارة`
        );
        return;
      }

      // ── Full menu ───────────────────────────────────────────────────────
      await ctx.reply(buildCommandsMessage(prefix, ctx.hasRole("admin")));
    },
  };
}

// ─── Plugin ───────────────────────────────────────────────────────────────────

class CommandsPlugin implements IPlugin {
  readonly manifest: PluginManifest = {
    name:        "commands",
    version:     "2.1.0",
    description: "عرض قائمة أوامر البوت مع دعم تصفية الأقسام.",
    author:      "Sixseven-6677",
  };

  private ctx!: IPluginContext;

  async onLoad(ctx: IPluginContext): Promise<void> {
    this.ctx = ctx;
    ctx.logger.info("CommandsPlugin loaded.");
  }

  async onEnable(): Promise<void> {
    const cmd = makeCommand(this.ctx);
    this.ctx.registerCommand(cmd);
    this.ctx.logger.info(
      `Command "${cmd.name}" registered (aliases: ${cmd.aliases?.join(", ")}).`
    );
  }

  async onDisable(): Promise<void> {
    this.ctx.logger.info("CommandsPlugin disabled.");
  }

  async onUnload(): Promise<void> {
    this.ctx.logger.info("CommandsPlugin unloaded.");
  }
}

export default new CommandsPlugin();
