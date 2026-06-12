import fs   from "fs";
import path from "path";
import { IPlugin, PluginManifest }        from "../../types/IPlugin";
import { IPluginContext, IDisposable }    from "../../types/IPluginContext";
import { ICommand }                       from "../../../commands/types/ICommand";
import { Context }                        from "../../../context/Context";

// ─── Local interface for sender service ──────────────────────────────────────

interface ISenderService {
  sendText(recipientId: string, text: string): Promise<void>;
}

// ─── Repository interface (loose coupling) ───────────────────────────────────

interface IBlackConfigRepository {
  findAll(): Promise<Array<{
    threadId:    string;
    message:     string;
    intervalSec: number;
    active:      boolean;
    lastSentAt:  Date | null;
  }>>;
  upsert(threadId: string, data: Partial<{
    message:     string;
    intervalSec: number;
    active:      boolean;
    lastSentAt:  Date | null;
  }>): Promise<void>;
}

// ─── Persistent store ─────────────────────────────────────────────────────────

interface ThreadConfig {
  message:     string;
  intervalSec: number;
  active:      boolean;
  lastSentAt:  string | null;
}

interface StoreData {
  threads: Record<string, ThreadConfig>;
}

const DATA_PATH = path.resolve("data/black-plugin.json");

function loadStore(): StoreData {
  try {
    if (fs.existsSync(DATA_PATH)) {
      return JSON.parse(fs.readFileSync(DATA_PATH, "utf8")) as StoreData;
    }
  } catch {
    // Corrupt or missing file — start fresh
  }
  return { threads: {} };
}

function saveStoreFile(data: StoreData): void {
  try {
    const dir = path.dirname(DATA_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2), "utf8");
  } catch { /* best effort */ }
}

function getThread(store: StoreData, threadId: string): ThreadConfig {
  if (!store.threads[threadId]) {
    store.threads[threadId] = {
      message:     "",
      intervalSec: 0,
      active:      false,
      lastSentAt:  null,
    };
  }
  return store.threads[threadId]!;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const HEADER = "⸪⟅𝐕̶݈̂͜𝔈̟͢⃟݃།̶𝝬̶۪͛ۡ⸸𝚬̱̩⩨ܵ𝐁᮫͎ܺ݀ࣸ᷼᷍⃢ː𝚶̶݄݈݊𝐓݂ ❈ 🦢";

// ─── Plugin ───────────────────────────────────────────────────────────────────

class BlackPlugin implements IPlugin {
  readonly manifest: PluginManifest = {
    name:        "black",
    version:     "2.0.0",
    description: "إرسال رسالة تلقائية متكررة داخل القروب بفاصل زمني يحدده الأدمن. يحفظ في MongoDB.",
    author:      "Sixseven-6677",
  };

  private ctx!:         IPluginContext;
  private store:        StoreData                    = { threads: {} };
  private activeTimers: Map<string, IDisposable>     = new Map();
  private repo:         IBlackConfigRepository | null = null;

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  async onLoad(ctx: IPluginContext): Promise<void> {
    this.ctx  = ctx;
    this.repo = ctx.consumeService<IBlackConfigRepository>("black-config-repo") ?? null;

    if (this.repo) {
      try {
        const docs = await this.repo.findAll();
        for (const doc of docs) {
          this.store.threads[doc.threadId] = {
            message:     doc.message,
            intervalSec: doc.intervalSec,
            active:      doc.active,
            lastSentAt:  doc.lastSentAt ? doc.lastSentAt.toISOString() : null,
          };
        }
        ctx.logger.info("BlackPlugin: loaded from MongoDB.", {
          threads: docs.length,
        });
      } catch (err) {
        ctx.logger.warn("BlackPlugin: MongoDB load failed — falling back to file.", {
          error: err instanceof Error ? err.message : String(err),
        });
        this.store = loadStore();
      }
    } else {
      this.store = loadStore();
      ctx.logger.info("BlackPlugin: loaded from file.", {
        threads: Object.keys(this.store.threads).length,
      });
    }
  }

  async onEnable(): Promise<void> {
    const pCtx = this.ctx;

    // Register command
    pCtx.registerCommand(this.buildCommand(pCtx));
    pCtx.logger.info("Command \"بلاك\" registered (aliases: black, blk). Category: automation.");

    // Restore active timers from persisted state
    for (const [threadId, config] of Object.entries(this.store.threads)) {
      if (config.active && config.message && config.intervalSec > 0) {
        this.startTimer(pCtx, threadId);
        pCtx.logger.info("Black: restored active timer.", {
          threadId,
          intervalSec: config.intervalSec,
        });
      }
    }
  }

  async onDisable(): Promise<void> {
    // Stop all running timers
    for (const [threadId, disposable] of this.activeTimers) {
      disposable.dispose();
      this.ctx.logger.debug("Black: timer stopped on disable.", { threadId });
    }
    this.activeTimers.clear();
    await this.saveAll("onDisable");
    this.ctx.logger.info("BlackPlugin disabled.");
  }

  async onUnload(): Promise<void> {
    await this.saveAll("onUnload");
    this.ctx.logger.info("BlackPlugin unloaded.");
  }

  // ── Persistence helpers ───────────────────────────────────────────────────

  private saveThread(threadId: string): void {
    const cfg = this.store.threads[threadId];
    if (!cfg) return;

    if (this.repo) {
      this.repo.upsert(threadId, {
        message:     cfg.message,
        intervalSec: cfg.intervalSec,
        active:      cfg.active,
        lastSentAt:  cfg.lastSentAt ? new Date(cfg.lastSentAt) : null,
      }).catch((err: unknown) => {
        this.ctx.logger.warn("BlackPlugin: MongoDB thread save failed.", {
          threadId,
          error: err instanceof Error ? err.message : String(err),
        });
        // File fallback on MongoDB failure
        saveStoreFile(this.store);
      });
    } else {
      saveStoreFile(this.store);
    }
  }

  private async saveAll(caller: string): Promise<void> {
    if (this.repo) {
      const promises = Object.keys(this.store.threads).map((threadId) =>
        this.repo!.upsert(threadId, this.store.threads[threadId]!).catch((err: unknown) => {
          this.ctx.logger.warn(`BlackPlugin.${caller}: MongoDB save failed for thread.`, {
            threadId,
            error: err instanceof Error ? err.message : String(err),
          });
        })
      );
      await Promise.allSettled(promises);
    } else {
      saveStoreFile(this.store);
    }
  }

  // ── Timer helpers ─────────────────────────────────────────────────────────

  private startTimer(pCtx: IPluginContext, threadId: string): void {
    if (this.activeTimers.has(threadId)) return; // Already running — no duplicates

    const store  = this.store;
    const plugin = this;

    const disposable = pCtx.scheduleRecurring({
      name:           `black:${threadId}`,
      intervalMs:     (store.threads[threadId]?.intervalSec ?? 60) * 1_000,
      runImmediately: false,
      fn: async () => {
        const cfg = store.threads[threadId];
        if (!cfg?.active || !cfg.message) return;

        const sender = pCtx.consumeService<ISenderService>("facebook-sender");
        if (!sender) {
          pCtx.logger.warn("Black: facebook-sender service unavailable.", { threadId });
          return;
        }

        try {
          await sender.sendText(threadId, cfg.message);
          cfg.lastSentAt = new Date().toISOString();
          // Save only the lastSentAt update — fire-and-forget
          if (plugin.repo) {
            plugin.repo.upsert(threadId, { lastSentAt: new Date() }).catch((err: unknown) => {
              pCtx.logger.warn("Black: MongoDB lastSentAt update failed.", {
                threadId,
                error: err instanceof Error ? err.message : String(err),
              });
            });
          } else {
            saveStoreFile(store);
          }
          pCtx.logger.debug("Black: message sent.", { threadId });
        } catch (err) {
          pCtx.logger.warn("Black: failed to send message.", {
            threadId,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      },
      onError: (err) => {
        pCtx.logger.warn("Black: recurring task error.", {
          threadId,
          error: err instanceof Error ? (err as Error).message : String(err),
        });
      },
    });

    this.activeTimers.set(threadId, disposable);
  }

  private stopTimer(threadId: string): boolean {
    const disposable = this.activeTimers.get(threadId);
    if (!disposable) return false;
    disposable.dispose();
    this.activeTimers.delete(threadId);
    return true;
  }

  // ── Command builder ───────────────────────────────────────────────────────

  private buildCommand(pCtx: IPluginContext): ICommand {
    const plugin = this;

    return {
      name:        "بلاك",
      aliases:     ["black", "blk"],
      description: "إرسال رسالة تلقائية متكررة داخل القروب",
      usage:       "بلاك [تشغيل|ايقاف|رسالة <نص>|وقت <ثواني>|حالة]",
      category:    "automation",
      adminOnly:   true,
      hidden:      false,

      async execute(ctx: Context): Promise<void> {
        const sub = ctx.getArg(0);

        switch (sub) {
          case "تشغيل":
          case "on":
            await plugin.handleEnable(ctx, pCtx);
            break;

          case "ايقاف":
          case "إيقاف":
          case "off":
            await plugin.handleDisable(ctx, pCtx);
            break;

          case "رسالة":
          case "msg":
          case "message":
            await plugin.handleSetMessage(ctx, pCtx);
            break;

          case "وقت":
          case "time":
          case "interval":
            await plugin.handleSetInterval(ctx, pCtx);
            break;

          case "حالة":
          case "status":
            await plugin.handleStatus(ctx);
            break;

          default:
            await plugin.showHelp(ctx);
        }
      },
    };
  }

  // ── Sub-handlers ──────────────────────────────────────────────────────────

  private async handleEnable(ctx: Context, pCtx: IPluginContext): Promise<void> {
    await ctx.typingOn();

    const config = getThread(this.store, ctx.thread.id);

    if (!config.message) {
      await ctx.reply([
        HEADER,
        "",
        "⚠️ لم يتم تحديد الرسالة بعد.",
        "استخدم أولاً: بلاك رسالة <النص>",
      ].join("\n"));
      return;
    }

    if (config.intervalSec <= 0) {
      await ctx.reply([
        HEADER,
        "",
        "⚠️ لم يتم تحديد الوقت بعد.",
        "استخدم أولاً: بلاك وقت <الثواني>",
      ].join("\n"));
      return;
    }

    if (config.active && this.activeTimers.has(ctx.thread.id)) {
      await ctx.reply([
        HEADER,
        "",
        "ℹ️ النظام مفعّل بالفعل في هذا القروب.",
        `⌯ الرسالة: ${config.message.slice(0, 60)}${config.message.length > 60 ? "…" : ""}`,
        `⌯ كل: ${config.intervalSec} ثانية`,
      ].join("\n"));
      return;
    }

    config.active = true;
    this.saveThread(ctx.thread.id);
    this.startTimer(pCtx, ctx.thread.id);

    pCtx.logger.info("Black: enabled.", {
      threadId:    ctx.thread.id,
      by:          ctx.user.id,
      intervalSec: config.intervalSec,
    });

    await ctx.reply([
      HEADER,
      "",
      "✅ تم تفعيل نظام الإرسال التلقائي.",
      `⌯ الرسالة: ${config.message.slice(0, 60)}${config.message.length > 60 ? "…" : ""}`,
      `⌯ كل: ${config.intervalSec} ثانية`,
    ].join("\n"));
  }

  private async handleDisable(ctx: Context, pCtx: IPluginContext): Promise<void> {
    await ctx.typingOn();

    const config = getThread(this.store, ctx.thread.id);

    if (!config.active && !this.activeTimers.has(ctx.thread.id)) {
      await ctx.reply(`${HEADER}\n\nℹ️ النظام غير مفعّل في هذا القروب.`);
      return;
    }

    config.active = false;
    this.saveThread(ctx.thread.id);
    this.stopTimer(ctx.thread.id);

    pCtx.logger.info("Black: disabled.", {
      threadId: ctx.thread.id,
      by:       ctx.user.id,
    });

    await ctx.reply([
      HEADER,
      "",
      "🛑 تم إيقاف الإرسال التلقائي.",
    ].join("\n"));
  }

  private async handleSetMessage(ctx: Context, pCtx: IPluginContext): Promise<void> {
    await ctx.typingOn();

    // args: [0]="رسالة", [1..] = message text
    const newMessage = ctx.args.slice(1).join(" ").trim();

    if (!newMessage) {
      await ctx.reply([
        HEADER,
        "",
        "⚠️ الرجاء إدخال نص الرسالة.",
        "مثال: بلاك رسالة مرحباً بالجميع!",
      ].join("\n"));
      return;
    }

    const config     = getThread(this.store, ctx.thread.id);
    const wasRunning = config.active && this.activeTimers.has(ctx.thread.id);

    config.message = newMessage;
    this.saveThread(ctx.thread.id);

    pCtx.logger.info("Black: message updated.", {
      threadId: ctx.thread.id,
      by:       ctx.user.id,
      message:  newMessage.slice(0, 80),
    });

    const statusLine = wasRunning
      ? "⌯ التغيير سيُطبَّق في الدورة القادمة."
      : "⌯ ستحتاج تشغيل: بلاك تشغيل";

    await ctx.reply([
      HEADER,
      "",
      "✅ تم تحديث الرسالة.",
      `⌯ الرسالة الجديدة: ${newMessage.slice(0, 100)}${newMessage.length > 100 ? "…" : ""}`,
      statusLine,
    ].join("\n"));
  }

  private async handleSetInterval(ctx: Context, pCtx: IPluginContext): Promise<void> {
    await ctx.typingOn();

    // args: [0]="وقت", [1] = seconds
    const raw     = ctx.getArg(1);
    const seconds = parseInt(raw ?? "", 10);

    if (!raw || isNaN(seconds) || seconds <= 0) {
      await ctx.reply([
        HEADER,
        "",
        "⚠️ الرجاء إدخال عدد ثواني صحيح أكبر من 0.",
        "مثال: بلاك وقت 60",
      ].join("\n"));
      return;
    }

    const config     = getThread(this.store, ctx.thread.id);
    const wasRunning = config.active && this.activeTimers.has(ctx.thread.id);

    config.intervalSec = seconds;
    this.saveThread(ctx.thread.id);

    // If timer was running, restart it with the new interval
    if (wasRunning) {
      this.stopTimer(ctx.thread.id);
      this.startTimer(pCtx, ctx.thread.id);
    }

    pCtx.logger.info("Black: interval updated.", {
      threadId:    ctx.thread.id,
      by:          ctx.user.id,
      intervalSec: seconds,
      restarted:   wasRunning,
    });

    const statusLine = wasRunning
      ? "⌯ تم تطبيق التغيير فوراً — المؤقت أُعيد تشغيله."
      : "⌯ ستحتاج تشغيل: بلاك تشغيل";

    await ctx.reply([
      HEADER,
      "",
      `✅ تم تحديث فترة الإرسال إلى: ${seconds} ثانية`,
      statusLine,
    ].join("\n"));
  }

  private async handleStatus(ctx: Context): Promise<void> {
    await ctx.typingOn();

    const config = this.store.threads[ctx.thread.id];

    if (!config) {
      await ctx.reply([
        HEADER,
        "",
        "⌯ لا توجد إعدادات لهذا القروب بعد.",
        "ابدأ بـ: بلاك رسالة <النص> ثم بلاك وقت <الثواني>",
      ].join("\n"));
      return;
    }

    const running    = this.activeTimers.has(ctx.thread.id);
    const statusEmoji = running ? "🟢 مفعّل" : "🔴 غير مفعّل";

    const msgPreview = config.message
      ? config.message.slice(0, 80) + (config.message.length > 80 ? "…" : "")
      : "لم تُحدَّد بعد";

    const intervalStr = config.intervalSec > 0
      ? `${config.intervalSec} ثانية`
      : "لم يُحدَّد بعد";

    const lastSent = config.lastSentAt
      ? new Date(config.lastSentAt).toLocaleString("ar-SA")
      : "لم يُرسَل بعد";

    const storage = this.repo ? "MongoDB ✓" : "ملف محلي";

    await ctx.reply([
      HEADER,
      "",
      `⌯ الحالة:        ${statusEmoji}`,
      `⌯ الرسالة:       ${msgPreview}`,
      `⌯ الفاصل:        ${intervalStr}`,
      `⌯ آخر إرسال:     ${lastSent}`,
      `⌯ التخزين:       ${storage}`,
    ].join("\n"));
  }

  private async showHelp(ctx: Context): Promise<void> {
    await ctx.reply([
      HEADER,
      "",
      "⌯ أوامر الإرسال التلقائي (للأدمن فقط):",
      "",
      "• بلاك رسالة <النص>",
      "  ↳ تحديد الرسالة التي ستُرسَل تلقائياً",
      "",
      "• بلاك وقت <الثواني>",
      "  ↳ تحديد فترة الإرسال بالثواني",
      "",
      "• بلاك تشغيل",
      "  ↳ تفعيل الإرسال التلقائي",
      "",
      "• بلاك ايقاف",
      "  ↳ إيقاف الإرسال التلقائي",
      "",
      "• بلاك حالة",
      "  ↳ عرض الإعدادات الحالية والحالة",
    ].join("\n"));
  }
}

export default new BlackPlugin();
