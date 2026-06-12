import { IPlugin, PluginManifest } from "../../types/IPlugin";
import { IPluginContext }          from "../../types/IPluginContext";
import { ICommand }                from "../../../commands/types/ICommand";
import { Context }                 from "../../../context/Context";
import { LockdownStore }           from "../../../middleware/built-in/lockdown.middleware";

// ─── Constants ────────────────────────────────────────────────────────────────

const HEADER = "⸪⟅𝐕̶݈̂͜𝔈̟͢⃟݃།̶𝝬̶۪͛ۡ⸸𝚬̱̩⩨ܵ𝐁᮫͎ܺ݀ࣸ᷼᷍⃢ː𝚶̶݄݈݊𝐓݂ ❈ 🦢";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getLockdownStore(pCtx: IPluginContext): LockdownStore | null {
  return pCtx.consumeService<LockdownStore>("lockdown-store") ?? null;
}

// ─── Sub-handlers ─────────────────────────────────────────────────────────────

async function handleEnable(ctx: Context, pCtx: IPluginContext): Promise<void> {
  await ctx.typingOn();

  const store = getLockdownStore(pCtx);
  if (!store) {
    await ctx.reply("⚠️ خدمة الإغلاق غير متاحة.");
    return;
  }

  if (store.isLocked(ctx.thread.id)) {
    await ctx.reply(`${HEADER}\n\nℹ️ وضع الإغلاق مفعّل بالفعل في هذا القروب.`);
    return;
  }

  store.enable(ctx.thread.id);

  pCtx.logger.info("Lockdown enabled.", {
    threadId: ctx.thread.id,
    by:       ctx.user.id,
  });

  await ctx.reply([
    HEADER,
    "",
    "🔒 تم تفعيل وضع الإغلاق.",
    "⌯ سيتم تجاهل أوامر غير الأدمن حتى يتم الإيقاف.",
  ].join("\n"));
}

async function handleDisable(ctx: Context, pCtx: IPluginContext): Promise<void> {
  await ctx.typingOn();

  const store = getLockdownStore(pCtx);
  if (!store) {
    await ctx.reply("⚠️ خدمة الإغلاق غير متاحة.");
    return;
  }

  if (!store.isLocked(ctx.thread.id)) {
    await ctx.reply(`${HEADER}\n\nℹ️ وضع الإغلاق غير مفعّل في هذا القروب.`);
    return;
  }

  store.disable(ctx.thread.id);

  pCtx.logger.info("Lockdown disabled.", {
    threadId: ctx.thread.id,
    by:       ctx.user.id,
  });

  await ctx.reply([
    HEADER,
    "",
    "🔓 تم إيقاف وضع الإغلاق.",
    "⌯ جميع المستخدمين يستطيعون الآن استخدام الأوامر.",
  ].join("\n"));
}

async function handleStatus(ctx: Context, pCtx: IPluginContext): Promise<void> {
  await ctx.typingOn();

  const store = getLockdownStore(pCtx);
  if (!store) {
    await ctx.reply("⚠️ خدمة الإغلاق غير متاحة.");
    return;
  }

  const locked = store.getLockedThreads();
  const total  = store.lockedCount;

  const currentStatus = store.isLocked(ctx.thread.id)
    ? "🔒 مفعّل"
    : "🔓 غير مفعّل";

  const lines = [
    HEADER,
    "",
    `⌯ حالة هذا القروب: ${currentStatus}`,
    "",
    `⌯ إجمالي القروبات المُغلقة: ${total}`,
  ];

  if (locked.length > 0) {
    lines.push("");
    lines.push("⌯ القروبات المُغلقة:");
    locked.forEach((id, i) => {
      const marker = id === ctx.thread.id ? " ← هذا القروب" : "";
      lines.push(`  ${i + 1}. ${id}${marker}`);
    });
  }

  await ctx.reply(lines.join("\n"));
}

async function showHelp(ctx: Context): Promise<void> {
  await ctx.reply([
    HEADER,
    "",
    "⌯ أوامر الإغلاق (للأدمن فقط):",
    "",
    "• اغلاق تشغيل",
    "  ↳ تفعيل وضع الإغلاق — تجاهل أوامر غير الأدمن",
    "",
    "• اغلاق ايقاف",
    "  ↳ إيقاف وضع الإغلاق — السماح للجميع بالأوامر",
    "",
    "• اغلاق حالة",
    "  ↳ عرض حالة الإغلاق في جميع القروبات",
  ].join("\n"));
}

// ─── Plugin ───────────────────────────────────────────────────────────────────

class LockdownPlugin implements IPlugin {
  readonly manifest: PluginManifest = {
    name:        "lockdown",
    version:     "1.0.0",
    description: "تفعيل أو تعطيل وضع تجاهل الأوامر لغير الأدمن داخل القروب.",
    author:      "Sixseven-6677",
  };

  private ctx!: IPluginContext;

  async onLoad(ctx: IPluginContext): Promise<void> {
    this.ctx = ctx;
    ctx.logger.info("LockdownPlugin loaded.");
  }

  async onEnable(): Promise<void> {
    const pCtx = this.ctx;

    const lockdownCommand: ICommand = {
      name:        "اغلاق",
      aliases:     ["lockdown", "lock"],
      description: "تفعيل أو تعطيل وضع الإغلاق لغير الأدمن في القروب",
      usage:       "اغلاق [تشغيل|ايقاف|حالة]",
      category:    "admin",
      adminOnly:   true,
      hidden:      false,

      async execute(ctx: Context): Promise<void> {
        const sub = ctx.getArg(0);

        switch (sub) {
          case "تشغيل":
          case "on":
            await handleEnable(ctx, pCtx);
            break;
          case "ايقاف":
          case "إيقاف":
          case "off":
            await handleDisable(ctx, pCtx);
            break;
          case "حالة":
          case "status":
            await handleStatus(ctx, pCtx);
            break;
          default:
            await showHelp(ctx);
        }
      },
    };

    pCtx.registerCommand(lockdownCommand);
    pCtx.logger.info(
      `Command "${lockdownCommand.name}" registered ` +
      `(aliases: ${lockdownCommand.aliases?.join(", ")}). Category: moderation.`
    );
  }

  async onDisable(): Promise<void> {
    this.ctx.logger.info("LockdownPlugin disabled.");
  }

  async onUnload(): Promise<void> {
    this.ctx.logger.info("LockdownPlugin unloaded.");
  }
}

export default new LockdownPlugin();
