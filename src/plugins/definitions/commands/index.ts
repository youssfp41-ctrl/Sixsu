import { config }              from "../../../config/env";
import { IPlugin, PluginManifest } from "../../types/IPlugin";
import { IPluginContext }          from "../../types/IPluginContext";
import { ICommand }               from "../../../commands/types/ICommand";
import { Context }                from "../../../context/Context";

// ─── Header ──────────────────────────────────────────────────────────────────

const HEADER = "⌯𝐕̸̶ֽׁ݊͐͢𝚵̶̱̩֗̀𝚾̣҉̶𝕰̶̟̀𝐋͜ 𝐂𝐎𝐌𝐌𝐀𝐍𝐃𝐒🪽↴";

// ─── Static curated command list ─────────────────────────────────────────────

function buildCommandList(prefix: string, isAdmin: boolean): string {
  const lines = [
    HEADER,
    "",
    `⌯ البادئة: ${prefix}`,
    "",
    `⌯ ${prefix}اوامر`,
    `⌯ ${prefix}ابتيم`,
    `⌯ ${prefix}ادمن`,
    `⌯ ${prefix}اغلاق`,
    `⌯ ${prefix}بلاك`,
    `⌯ ${prefix}قروبات`,
    `⌯ ${prefix}ادارة`,
  ];

  if (isAdmin) {
    lines.push(`⌯ ${prefix}مالك`);
  }

  return lines.join("\n");
}

// ─── Command ─────────────────────────────────────────────────────────────────

function makeCommand(_pCtx: IPluginContext): ICommand {
  return {
    name:        "اوامر",
    aliases:     ["commands", "cmds", "أوامر", "help", "مساعدة"],
    description: "عرض قائمة أوامر البوت",
    usage:       "اوامر",
    category:    "util",
    adminOnly:   false,
    hidden:      false,

    async execute(ctx: Context): Promise<void> {
      await ctx.typingOn();

      const prefix  = config.bot.prefix || "/";
      const isAdmin = ctx.hasRole("admin");
      const message = buildCommandList(prefix, isAdmin);

      await ctx.reply(message);
    },
  };
}

// ─── Plugin ──────────────────────────────────────────────────────────────────

class CommandsPlugin implements IPlugin {
  readonly manifest: PluginManifest = {
    name:        "commands",
    version:     "2.0.0",
    description: "عرض قائمة أوامر البوت المتاحة.",
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
