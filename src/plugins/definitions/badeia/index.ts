import { IPlugin, PluginManifest } from "../../types/IPlugin";
import { IPluginContext }          from "../../types/IPluginContext";
import { ICommand }               from "../../../commands/types/ICommand";
import { Context }                from "../../../context/Context";
import { prefixStore }            from "../../../prefix/PrefixStore";

// ─── Constants ────────────────────────────────────────────────────────────────

const HEADER = "⸪⟅𝐕̶݈̂͜𝔈̟͢⃟݃།̶𝝬̶۪͛ۡ⸸𝚬̱̩⩨ܵ𝐁᮫͎ܺ݀ࣸ᷼᷍⃢ː𝚶̶݄݈݊𝐓݂ ❈ 🦢";

function isValidPrefix(p: string): boolean {
  const trimmed = p.trim();
  if (trimmed.length === 0 || trimmed.length > 3) return false;
  if (/\s/.test(trimmed)) return false;
  return true;
}

// ─── Plugin ───────────────────────────────────────────────────────────────────

class BadeiaPlugin implements IPlugin {
  readonly manifest: PluginManifest = {
    name:        "badeia",
    version:     "2.0.0",
    description: "عرض البادئة الحالية للبوت أو تغييرها (للمالك فقط).",
    author:      "Sixseven-6677",
  };

  private ctx!: IPluginContext;

  async onLoad(ctx: IPluginContext): Promise<void> {
    this.ctx = ctx;
    ctx.logger.info("BadeiaPlugin loaded.", { currentPrefix: prefixStore.get() });
  }

  async onEnable(): Promise<void> {
    const pCtx = this.ctx;

    const badeiaCommand: ICommand = {
      name:        "بادئة",
      aliases:     ["prefix", "badeia"],
      description: "عرض البادئة الحالية أو تغييرها (للمالك فقط): بادئة [رمز]",
      usage:       "بادئة | بادئة [رمز]",
      category:    "system",
      adminOnly:   false,
      hidden:      false,

      async execute(ctx: Context): Promise<void> {
        await ctx.typingOn();

        const newPrefix = ctx.args[0];

        // ── Show current prefix ──────────────────────────────────────────────
        if (!newPrefix) {
          const current = prefixStore.get();
          await ctx.reply([
            HEADER,
            "",
            `⌯ البادئة الحالية: ${current}`,
            "",
            `⌯ مثال: ${current}اوامر`,
            `⌯ مثال: ${current}بادئة`,
            "",
            "⌯ لتغيير البادئة (للمالك فقط):",
            `  ↳ ${current}بادئة !`,
            `  ↳ ${current}بادئة .`,
            `  ↳ ${current}بادئة /`,
          ].join("\n"));

          pCtx.logger.info("BadeiaPlugin: prefix displayed.", {
            threadID: ctx.thread.id,
            userID:   ctx.user.id,
            prefix:   current,
          });
          return;
        }

        // ── Change prefix (admin only) ───────────────────────────────────────
        if (!ctx.hasRole("admin")) {
          await ctx.reply([
            HEADER,
            "",
            "🚫 فقط المالك يستطيع تغيير البادئة.",
          ].join("\n"));
          return;
        }

        const trimmed = newPrefix.trim();

        if (!isValidPrefix(trimmed)) {
          await ctx.reply([
            HEADER,
            "",
            "⚠️ البادئة غير صالحة.",
            "",
            "⌯ الشروط:",
            "  • من 1 إلى 3 رموز فقط",
            "  • لا تحتوي على مسافات",
            "",
            "⌯ أمثلة صحيحة: ! . / ? $ # @ ~ ; : - +",
          ].join("\n"));
          return;
        }

        const old = prefixStore.get();
        prefixStore.set(trimmed);

        pCtx.logger.info("BadeiaPlugin: prefix changed.", {
          from:     old,
          to:       trimmed,
          by:       ctx.user.id,
          threadID: ctx.thread.id,
        });

        await ctx.reply([
          HEADER,
          "",
          "✅ تم تغيير البادئة بنجاح!",
          "",
          `⌯ البادئة القديمة: ${old}`,
          `⌯ البادئة الجديدة: ${trimmed}`,
          "",
          `⌯ مثال الاستخدام: ${trimmed}اوامر`,
          `⌯ مثال الاستخدام: ${trimmed}بادئة`,
          "",
          "⌯ البادئة محفوظة وتستمر بعد إعادة التشغيل.",
        ].join("\n"));
      },
    };

    pCtx.registerCommand(badeiaCommand);
    pCtx.logger.info(
      `Command "${badeiaCommand.name}" registered (aliases: ${badeiaCommand.aliases?.join(", ")}). ` +
      `Current prefix: "${prefixStore.get()}".`
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
