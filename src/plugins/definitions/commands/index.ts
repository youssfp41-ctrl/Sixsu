// deploy: v3.1 — all category fixes loaded
import fs   from "fs";
import path from "path";
import { IPlugin, PluginManifest } from "../../types/IPlugin";
import { IPluginContext }          from "../../types/IPluginContext";
import { ICommand }                from "../../../commands/types/ICommand";
import { Context }                 from "../../../context/Context";
import { prefixStore }             from "../../../prefix/PrefixStore";
import { CommandRegistry }         from "../../../commands/CommandRegistry";
import {
  BRAND,
  CATEGORY_META,
  buildCommandsMessage,
  buildCategoryMessage,
  resolveCategory,
  toBold,
} from "../../../ui/BotUI";

// ─── Self-documenting: write docs/COMMANDS.md ─────────────────────────────────

function generateCommandsDocs(registry: CommandRegistry, prefix: string): string {
  const byCategory = registry.byCategory();
  const lines: string[] = [
    "# COMMANDS.md",
    "",
    "> ⚙️ هذا الملف يُنشأ تلقائياً عند بدء تشغيل البوت — لا تعدّله يدوياً.",
    "",
    `**البادئة الحالية:** \`${prefix}\``,
    "",
    "---",
    "",
  ];

  // الأقسام الثلاثة الرئيسية
  for (const meta of CATEGORY_META) {
    const cmds = (byCategory.get(meta.key) ?? []).filter((c) => !c.hidden);
    if (cmds.length === 0) continue;

    lines.push(`## ${meta.emoji} ${meta.label} (${cmds.length} أوامر)`);
    lines.push("");
    lines.push("| الأمر | الأسماء البديلة | الوصف | الصلاحيات |");
    lines.push("|-------|----------------|--------|-----------|");

    for (const cmd of cmds) {
      const aliases = cmd.aliases?.map((a) => `\`${prefix}${a}\``).join(", ") ?? "—";
      const perms   = cmd.adminOnly ? "🔐 أدمن فقط" : "🌐 للجميع";
      const desc    = cmd.description ?? "—";
      lines.push(`| \`${prefix}${cmd.name}\` | ${aliases} | ${desc} | ${perms} |`);
    }
    lines.push("");
  }

  // أقسام أخرى (util, debug, moderation…)
  const knownKeys = new Set(CATEGORY_META.map((m) => m.key));
  const otherCmds: ICommand[] = [];
  for (const [cat, cmds] of byCategory) {
    if (knownKeys.has(cat)) continue;
    otherCmds.push(...cmds.filter((c) => !c.hidden));
  }
  if (otherCmds.length > 0) {
    lines.push("## 📌 أوامر أخرى");
    lines.push("");
    for (const cmd of otherCmds) {
      lines.push(`- \`${prefix}${cmd.name}\` — ${cmd.description ?? ""}`);
    }
    lines.push("");
  }

  lines.push("---");
  lines.push(`*تم الإنشاء: ${new Date().toISOString()}*`);

  return lines.join("\n");
}

function writeDocs(registry: CommandRegistry, prefix: string): void {
  try {
    const docsDir = path.resolve("docs");
    if (!fs.existsSync(docsDir)) fs.mkdirSync(docsDir, { recursive: true });
    fs.writeFileSync(
      path.join(docsDir, "COMMANDS.md"),
      generateCommandsDocs(registry, prefix),
      "utf8",
    );
  } catch { /* non-fatal — docs are informational */ }
}

// ─── Helper: build catCounts map from live registry ──────────────────────────

function buildCatCounts(registry: CommandRegistry): Map<string, number> {
  const byCategory = registry.byCategory();
  const counts     = new Map<string, number>();
  for (const meta of CATEGORY_META) {
    counts.set(meta.key, (byCategory.get(meta.key) ?? []).filter((c) => !c.hidden).length);
  }
  return counts;
}

// ─── Command factory ──────────────────────────────────────────────────────────

function makeCommand(pCtx: IPluginContext): ICommand {
  return {
    name:        "اوامر",
    aliases:     ["commands", "cmds", "أوامر", "help", "مساعدة"],
    description: "عرض قائمة أوامر البوت — أو تصفيتها: اوامر [نظام|خاصة|ادارة]",
    usage:       "اوامر | اوامر [نظام|خاصة|ادارة]",
    category:    "system",
    adminOnly:   false,
    hidden:      false,

    async execute(ctx: Context): Promise<void> {
      await ctx.typingOn();

      const registry = pCtx.consumeService<CommandRegistry>("command-registry");
      const prefix   = prefixStore.get();
      const filter   = ctx.args[0]?.trim();

      if (!registry) {
        await ctx.reply(`${BRAND}\n\n⚠️ خدمة الأوامر غير متاحة مؤقتاً.`);
        return;
      }

      // ── Category detail ─────────────────────────────────────────────────
      if (filter) {
        const meta = resolveCategory(filter);
        if (meta) {
          const catCmds = (registry.byCategory().get(meta.key) ?? [])
            .filter((c) => !c.hidden);
          await ctx.reply(buildCategoryMessage(meta, catCmds, prefix));
          return;
        }

        // Unknown filter — show full menu with hint
        const catCounts = buildCatCounts(registry);
        await ctx.reply(
          buildCommandsMessage(prefix, catCounts) +
          `\n\n⚠️ القسم "${filter}" غير موجود.\nالأقسام المتاحة: نظام · خاصة · ادارة`
        );
        return;
      }

      // ── Full dynamic menu ───────────────────────────────────────────────
      const catCounts = buildCatCounts(registry);
      await ctx.reply(buildCommandsMessage(prefix, catCounts));
    },
  };
}

// ─── Plugin ───────────────────────────────────────────────────────────────────

class CommandsPlugin implements IPlugin {
  readonly manifest: PluginManifest = {
    name:        "commands",
    version:     "3.0.0",
    description: "قائمة الأوامر الديناميكية — تُحسب تلقائياً من الأوامر المسجّلة في الـ Registry.",
    author:      "Sixseven-6677",
  };

  private ctx!: IPluginContext;

  async onLoad(ctx: IPluginContext): Promise<void> {
    this.ctx = ctx;
    ctx.logger.info("CommandsPlugin v3 loaded.");
  }

  async onEnable(): Promise<void> {
    const cmd = makeCommand(this.ctx);
    this.ctx.registerCommand(cmd);

    // ── Self-documenting: write docs/COMMANDS.md ───────────────────────
    const registry = this.ctx.consumeService<CommandRegistry>("command-registry");
    if (registry) {
      writeDocs(registry, prefixStore.get());
      this.ctx.logger.info(
        "CommandsPlugin: docs/COMMANDS.md generated.",
        { total: registry.size() },
      );
    }

    this.ctx.logger.info(
      `Command "${cmd.name}" registered (aliases: ${cmd.aliases?.join(", ")}).`,
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
