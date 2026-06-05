import { config }              from "../../../config/env";
import { IPlugin, PluginManifest } from "../../types/IPlugin";
import { IPluginContext }          from "../../types/IPluginContext";
import { ICommand }               from "../../../commands/types/ICommand";
import { Context }                from "../../../context/Context";

// ─── Minimal interface for the command-registry service ──────────────────────

interface ICommandRegistry {
  getAll():      ICommand[];
  byCategory():  Map<string, ICommand[]>;
}

// ─── Category labels (Arabic) ────────────────────────────────────────────────

const CATEGORY_LABELS: Record<string, string> = {
  util:       "أدوات",
  admin:      "إدارة",
  general:    "عام",
  debug:      "تشخيص",
  automation: "تلقائي",
  moderation: "مراقبة",
};

function categoryLabel(cat: string): string {
  return CATEGORY_LABELS[cat] ?? cat;
}

// ─── Formatting ──────────────────────────────────────────────────────────────

const HEADER = "⌯𝐕̸̶ֽׁ݊͐͢𝚵̶̱̩֗̀𝚾̣҉̶𝕰̶̟̀𝐋͜ 𝐂𝐎𝐌𝐌𝐀𝐍𝐃𝐒🪽↴";

function buildCommandList(
  byCategory: Map<string, ICommand[]>,
  prefix:     string,
  isAdmin:    boolean,
): string {
  const lines: string[] = [HEADER, "", `⌯ البادئة الحالية: ${prefix}`, ""];

  // Sort categories: util first, then automation, moderation, admin, then rest
  const categoryOrder = ["util", "general", "automation", "moderation", "admin", "debug"];
  const sortedCats = [...byCategory.keys()].sort((a, b) => {
    const ia = categoryOrder.indexOf(a);
    const ib = categoryOrder.indexOf(b);
    if (ia === -1 && ib === -1) return a.localeCompare(b);
    if (ia === -1) return 1;
    if (ib === -1) return -1;
    return ia - ib;
  });

  let totalVisible = 0;

  for (const cat of sortedCats) {
    const cmds = byCategory.get(cat) ?? [];

    // Filter commands based on user role
    const visible = cmds.filter((cmd) => {
      if (cmd.hidden) return false;
      if (cmd.adminOnly && !isAdmin) return false;
      return true;
    });

    if (visible.length === 0) continue;

    // Category header
    lines.push(`⌯ ── ${categoryLabel(cat)} ──`);

    for (const cmd of visible) {
      const desc = cmd.description ?? "";
      lines.push(`⌯ ${prefix}${cmd.name}: ${desc}`);
    }

    lines.push(""); // blank line between categories
    totalVisible += visible.length;
  }

  if (totalVisible === 0) {
    lines.push("⌯ لا توجد أوامر متاحة لك حالياً.");
    lines.push("");
  }

  lines.push(`⌯ المجموع: ${totalVisible} أمر`);

  return lines.join("\n");
}

// ─── Command ─────────────────────────────────────────────────────────────────

function makeCommand(pCtx: IPluginContext): ICommand {
  return {
    name:        "اوامر",
    aliases:     ["commands", "cmds", "أوامر", "help", "مساعدة"],
    description: "عرض جميع أوامر البوت المتاحة",
    usage:       "اوامر",
    category:    "util",
    adminOnly:   false,
    hidden:      false,

    async execute(ctx: Context): Promise<void> {
      await ctx.typingOn();

      // ── Get command registry ───────────────────────────────────────────
      const registry = pCtx.consumeService<ICommandRegistry>("command-registry");
      if (!registry) {
        pCtx.logger.warn("CommandsPlugin: command-registry service not found.");
        await ctx.reply("⚠️ تعذّر جلب قائمة الأوامر.");
        return;
      }

      // ── Resolve prefix ─────────────────────────────────────────────────
      const prefix = config.bot.prefix || "/";

      // ── Determine user role ────────────────────────────────────────────
      const isAdmin = ctx.hasRole("admin");

      // ── Build and send ─────────────────────────────────────────────────
      let byCategory: Map<string, ICommand[]>;
      try {
        byCategory = registry.byCategory();
      } catch (err) {
        pCtx.logger.warn("CommandsPlugin: byCategory() failed.", { error: String(err) });
        await ctx.reply("⚠️ تعذّر جلب قائمة الأوامر.");
        return;
      }

      const message = buildCommandList(byCategory, prefix, isAdmin);

      pCtx.logger.info("CommandsPlugin: commands list sent.", {
        threadID:   ctx.thread.id,
        userID:     ctx.user.id,
        isAdmin,
        categories: byCategory.size,
      });

      await ctx.reply(message);
    },
  };
}

// ─── Plugin ──────────────────────────────────────────────────────────────────

class CommandsPlugin implements IPlugin {
  readonly manifest: PluginManifest = {
    name:        "commands",
    version:     "1.0.0",
    description: "عرض قائمة أوامر البوت المتاحة للمستخدم مقسّمةً حسب الفئة.",
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