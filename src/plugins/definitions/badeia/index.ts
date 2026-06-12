import { config }          from "../../../config/env";
import { IPlugin, PluginManifest } from "../../types/IPlugin";
import { IPluginContext }          from "../../types/IPluginContext";
import { ICommand }               from "../../../commands/types/ICommand";
import { Context }                from "../../../context/Context";

// ─── Constants ────────────────────────────────────────────────────────────────

const HEADER = "⸪⟅𝐕̶݈̂͜𝔈̟͢⃟݃།̶𝝬̶۪͛ۡ⸸𝚬̱̩⩨ܵ𝐁᮫͎ܺ݀ࣸ᷼᷍⃢ː𝚶̶݄݈݊𝐓݂ ❈ 🦢";

// ─── Plugin ───────────────────────────────────────────────────────────────────

class BadeiaPlugin implements IPlugin {
  readonly manifest: PluginManifest = {
    name:        "badeia",
    version:     "1.0.0",
    description: "عرض البادئة الحالية للبوت.",
    author:      "Sixseven-6677",
  };

  private ctx!: IPluginContext;

  async onLoad(ctx: IPluginContext): Promise<void> {
    this.ctx = ctx;
    ctx.logger.info("BadeiaPlugin loaded.");
  }

  async onEnable(): Promise<void> {
    const pCtx = this.ctx;

    const badeiaCommand: ICommand = {
      name:        "بادئة",
      aliases:     ["prefix", "badeia"],
      description: "عرض البادئة الحالية للأوامر",
      usage:       "بادئة",
      category:    "util",
      adminOnly:   false,
      hidden:      true,

      async execute(ctx: Context): Promise<void> {
        await ctx.typingOn();

        const prefix = config.bot.prefix || "/";

        await ctx.reply([
          HEADER,
          "",
          `⌯ البادئة الحالية: ${prefix}`,
          "",
          `⌯ مثال: ${prefix}اوامر`,
          `⌯ مثال: ${prefix}ابتيم`,
        ].join("\n"));

        pCtx.logger.info("BadeiaPlugin: prefix displayed.", {
          threadID: ctx.thread.id,
          userID:   ctx.user.id,
          prefix,
        });
      },
    };

    pCtx.registerCommand(badeiaCommand);
    pCtx.logger.info(
      `Command "${badeiaCommand.name}" registered (aliases: ${badeiaCommand.aliases?.join(", ")}).`
    );
  }

  async onDisable(): Promise<void> {
    this.ctx.logger.info("BadeiaPlugin disabled.");
  }

  async onUnload(): Promise<void> {
    this.ctx.logger.info("BadeiaPlugin unloaded.");
  }
}

export default new BadeiaPlugin();
