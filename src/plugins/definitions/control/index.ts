import { IPlugin, PluginManifest } from "../../types/IPlugin";
import { IPluginContext }          from "../../types/IPluginContext";
import { ICommand }                from "../../../commands/types/ICommand";
import { Context }                 from "../../../context/Context";
import {
  muteThread,
  unmuteThread,
  isMuted,
  getMutedThreads,
  getLastActivity,
} from "../../../protection/GroupControlRegistry";

// ─── FCA API types ────────────────────────────────────────────────────────────

interface QThread {
  threadID:       string;
  name?:          string;
  isGroup:        boolean;
  participantIDs: string[];
}

interface ThreadAdminEntry { id: string; }

interface ThreadInfo {
  threadID:       string;
  name:           string;
  participantIDs: string[];
  adminIDs:       ThreadAdminEntry[];
  isGroup:        boolean;
}

interface IFcaControl {
  getCurrentUserID(): string;
  getThreadList(
    limit:     number,
    timestamp: number | null,
    tags:      string[],
    cb:        (err: Error | null, list: QThread[]) => void,
  ): void;
  getThreadInfo(
    threadID: string,
    cb:       (err: Error | null, info: ThreadInfo) => void,
  ): void;
  setTitle(
    title:    string,
    threadID: string,
    cb:       (err: Error | null) => void,
  ): void;
  sendMessage(
    msg:      { body: string },
    threadID: string,
    cb?:      (err: Error | null) => void,
  ): void;
  removeUserFromGroup(
    userID:   string,
    threadID: string,
    cb?:      (err: Error | null) => void,
  ): void;
}

interface IMiraiControl { getApi(): IFcaControl | null; }

// ─── GroupCache ───────────────────────────────────────────────────────────────

interface GroupEntry {
  threadID:     string;
  name:         string;
  membersCount: number;
}

class GroupCache {
  private _groups:     GroupEntry[] = [];
  private _refreshedAt = 0;
  readonly TTL_MS      = 60_000;

  get groups():      GroupEntry[] { return this._groups; }
  get refreshedAt(): number       { return this._refreshedAt; }
  get ageSeconds():  number       { return Math.round((Date.now() - this._refreshedAt) / 1000); }
  get stale():       boolean      { return Date.now() - this._refreshedAt > this.TTL_MS; }

  async refresh(api: IFcaControl): Promise<void> {
    const threads = await new Promise<QThread[]>((resolve, reject) => {
      api.getThreadList(100, null, ["INBOX"], (err, list) => {
        if (err) reject(err); else resolve(list ?? []);
      });
    });

    this._groups = threads
      .filter(t => t.isGroup)
      .map(g => ({
        threadID:     g.threadID,
        name:         g.name?.trim() || "قروب بدون اسم",
        membersCount: g.participantIDs?.length ?? 0,
      }));

    this._refreshedAt = Date.now();
  }

  getByIndex(n: number): GroupEntry | undefined { return this._groups[n - 1]; }

  updateName(threadID: string, name: string): void {
    const e = this._groups.find(g => g.threadID === threadID);
    if (e) e.name = name;
  }

  remove(threadID: string): void {
    this._groups = this._groups.filter(g => g.threadID !== threadID);
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const HEADER = "⌯𝐕̸̶ֽׁ݊͐͢𝚵̶̱̩֗̀𝚾̣҉̶𝕰̶̟̀𝐋͜ 𝐂𝐎𝐍𝐓𝐑𝐎𝐋🪽↴";

function getApi(pCtx: IPluginContext): IFcaControl | null {
  return (
    pCtx.consumeService<IMiraiControl>("mirai-transport")?.getApi?.() ??
    pCtx.consumeService<IMiraiControl>("mirai-transport-secondary")?.getApi?.() ??
    null
  );
}

async function ensureFresh(cache: GroupCache, api: IFcaControl, pCtx: IPluginContext): Promise<void> {
  if (!cache.stale) return;
  try {
    await cache.refresh(api);
    pCtx.logger.info("ControlPlugin: cache refreshed.", { count: cache.groups.length });
  } catch (err) {
    pCtx.logger.warn("ControlPlugin: cache refresh failed.", { error: String(err) });
  }
}

function formatAge(ts: number): string {
  if (!ts) return "لم يُسجَّل";
  const diff = Date.now() - ts;
  const m    = Math.floor(diff / 60_000);
  if (m < 1)  return "الآن";
  if (m < 60) return `منذ ${m} دقيقة`;
  const h = Math.floor(m / 60);
  if (h < 24) return `منذ ${h} ساعة`;
  return `منذ ${Math.floor(h / 24)} يوم`;
}

function parseIndex(arg: string | undefined, max: number): number | null {
  if (!arg) return null;
  const n = parseInt(arg, 10);
  return (!isNaN(n) && n >= 1 && n <= max) ? n : null;
}

// ─── Sub-command handlers ─────────────────────────────────────────────────────

async function handleList(ctx: Context, pCtx: IPluginContext, cache: GroupCache): Promise<void> {
  const api = getApi(pCtx);
  if (!api) { await ctx.reply("⚠️ خدمة Facebook غير متاحة."); return; }

  await ensureFresh(cache, api, pCtx);
  const groups = cache.groups;

  if (groups.length === 0) {
    await ctx.reply(`${HEADER}\n\n⌯ البوت ليس في أي قروب حالياً.`);
    return;
  }

  const lines = groups.slice(0, 25).map((g, i) => {
    const muted    = isMuted(g.threadID) ? " 🔕" : "";
    const activity = getLastActivity(g.threadID);
    const active   = activity ? ` · ${formatAge(activity)}` : "";
    return `  ${i + 1}. ${g.name} (${g.membersCount} عضو)${muted}${active}`;
  });

  const more = groups.length > 25 ? `\n⌯ +${groups.length - 25} قروب إضافي` : "";

  await ctx.reply([
    HEADER, "",
    `⌯ إجمالي القروبات: ${groups.length}`,
    `⌯ آخر تحديث: قبل ${cache.ageSeconds} ثانية`,
    "",
    ...lines, more, "",
    "⌯ للإدارة: قروب [حالة|رسالة|مغادرة|اسم|كتم|فتح] [رقم]",
  ].filter(Boolean).join("\n"));
}

async function handleStatus(ctx: Context, pCtx: IPluginContext, cache: GroupCache, n: number): Promise<void> {
  const api = getApi(pCtx);
  if (!api) { await ctx.reply("⚠️ خدمة Facebook غير متاحة."); return; }

  const entry = cache.getByIndex(n);
  if (!entry) { await ctx.reply("⚠️ رقم غير صحيح. استخدم «قروبات» لرؤية القائمة."); return; }

  let adminsCount = 0;
  try {
    const info: ThreadInfo = await new Promise((resolve, reject) => {
      api.getThreadInfo(entry.threadID, (err, i) => err ? reject(err) : resolve(i));
    });
    adminsCount        = info.adminIDs?.length ?? 0;
    entry.membersCount = info.participantIDs?.length ?? entry.membersCount;
  } catch { /* best effort */ }

  await ctx.reply([
    HEADER, "",
    `⌯ القروب رقم ${n}`, "",
    `📛 الاسم: ${entry.name}`,
    `👥 الأعضاء: ${entry.membersCount}`,
    `👑 الأدمن: ${adminsCount || "غير معروف"}`,
    `🔇 الكتم: ${isMuted(entry.threadID) ? "مفعّل ✅" : "غير مفعّل ❌"}`,
    `🕐 آخر نشاط: ${formatAge(getLastActivity(entry.threadID))}`,
    `🆔 المعرّف: ${entry.threadID}`,
  ].join("\n"));
}

async function handleSendMessage(ctx: Context, pCtx: IPluginContext, cache: GroupCache, n: number, text: string): Promise<void> {
  const api = getApi(pCtx);
  if (!api) { await ctx.reply("⚠️ خدمة Facebook غير متاحة."); return; }
  const entry = cache.getByIndex(n);
  if (!entry) { await ctx.reply("⚠️ رقم غير صحيح."); return; }
  if (!text.trim()) { await ctx.reply("⚠️ الرجاء كتابة نص الرسالة بعد الرقم.\n📌 مثال: قروب رسالة 3 مرحبا"); return; }

  try {
    await new Promise<void>((resolve, reject) => {
      api.sendMessage({ body: text }, entry.threadID, (err) => err ? reject(err) : resolve());
    });
    pCtx.logger.info("ControlPlugin: message sent.", { to: entry.threadID, name: entry.name, by: ctx.user.id });
    await ctx.reply(`✅ تم إرسال الرسالة إلى «${entry.name}».`);
  } catch (err) {
    pCtx.logger.warn("ControlPlugin: sendMessage failed.", { error: String(err) });
    await ctx.reply("⚠️ فشل إرسال الرسالة.");
  }
}

async function handleLeave(ctx: Context, pCtx: IPluginContext, cache: GroupCache, n: number): Promise<void> {
  const api = getApi(pCtx);
  if (!api) { await ctx.reply("⚠️ خدمة Facebook غير متاحة."); return; }
  const entry = cache.getByIndex(n);
  if (!entry) { await ctx.reply("⚠️ رقم غير صحيح."); return; }

  const botId = api.getCurrentUserID();
  try {
    await new Promise<void>((resolve, reject) => {
      api.removeUserFromGroup(botId, entry.threadID, (err) => err ? reject(err) : resolve());
    });
    const name = entry.name;
    cache.remove(entry.threadID);
    unmuteThread(entry.threadID);
    pCtx.logger.info("ControlPlugin: left group.", { threadID: entry.threadID, name, by: ctx.user.id });
    await ctx.reply(`✅ غادر البوت القروب «${name}» بنجاح.`);
  } catch (err) {
    pCtx.logger.warn("ControlPlugin: leaveGroup failed.", { error: String(err) });
    await ctx.reply(`⚠️ فشل مغادرة القروب. تأكد أن البوت ليس المالك الوحيد.`);
  }
}

async function handleRename(ctx: Context, pCtx: IPluginContext, cache: GroupCache, n: number, newName: string): Promise<void> {
  const api = getApi(pCtx);
  if (!api) { await ctx.reply("⚠️ خدمة Facebook غير متاحة."); return; }
  const entry = cache.getByIndex(n);
  if (!entry) { await ctx.reply("⚠️ رقم غير صحيح."); return; }
  if (!newName.trim()) { await ctx.reply("⚠️ الرجاء إدخال الاسم الجديد.\n📌 مثال: قروب اسم 2 اسم جديد"); return; }

  const oldName = entry.name;
  try {
    await new Promise<void>((resolve, reject) => {
      api.setTitle(newName, entry.threadID, (err) => err ? reject(err) : resolve());
    });
    cache.updateName(entry.threadID, newName);
    pCtx.logger.info("ControlPlugin: renamed.", { threadID: entry.threadID, from: oldName, to: newName, by: ctx.user.id });
    await ctx.reply(`${HEADER}\n\n✅ تم تغيير اسم القروب:\n«${oldName}» ← «${newName}»`);
  } catch (err) {
    pCtx.logger.warn("ControlPlugin: setTitle failed.", { error: String(err) });
    await ctx.reply("⚠️ فشل تغيير الاسم. تأكد أن البوت أدمن في القروب.");
  }
}

async function handleMute(ctx: Context, pCtx: IPluginContext, cache: GroupCache, n: number): Promise<void> {
  const entry = cache.getByIndex(n);
  if (!entry) { await ctx.reply("⚠️ رقم غير صحيح."); return; }
  if (isMuted(entry.threadID)) {
    await ctx.reply(`ℹ️ القروب «${entry.name}» مكتوم بالفعل. استخدم «قروب فتح ${n}» لإلغاء الكتم.`);
    return;
  }
  muteThread(entry.threadID);
  pCtx.logger.info("ControlPlugin: muted.", { threadID: entry.threadID, by: ctx.user.id });
  await ctx.reply([
    HEADER, "",
    `🔇 تم كتم القروب «${entry.name}».`,
    `⌯ لن يتم تنفيذ أي أوامر من هذا القروب حتى يُفتح.`,
    `⌯ لإلغاء الكتم: قروب فتح ${n}`,
  ].join("\n"));
}

async function handleUnmute(ctx: Context, pCtx: IPluginContext, cache: GroupCache, n: number): Promise<void> {
  const entry = cache.getByIndex(n);
  if (!entry) { await ctx.reply("⚠️ رقم غير صحيح."); return; }
  if (!isMuted(entry.threadID)) {
    await ctx.reply(`ℹ️ القروب «${entry.name}» غير مكتوم أصلاً.`);
    return;
  }
  unmuteThread(entry.threadID);
  pCtx.logger.info("ControlPlugin: unmuted.", { threadID: entry.threadID, by: ctx.user.id });
  await ctx.reply([
    HEADER, "",
    `🔔 تم فتح القروب «${entry.name}».`,
    "⌯ تم استئناف تنفيذ الأوامر في هذا القروب.",
  ].join("\n"));
}

// ─── Plugin class ─────────────────────────────────────────────────────────────

class ControlPlugin implements IPlugin {
  readonly manifest: PluginManifest = {
    name:        "control",
    version:     "1.0.0",
    description: "لوحة تحكم مركزية لإدارة جميع القروبات عن بُعد.",
    author:      "Sixseven-6677",
  };

  private ctx!:  IPluginContext;
  private cache  = new GroupCache();

  async onLoad(ctx: IPluginContext): Promise<void> {
    this.ctx = ctx;
    ctx.logger.info("ControlPlugin loaded.");
  }

  async onEnable(): Promise<void> {
    const pCtx  = this.ctx;
    const cache = this.cache;

    pCtx.scheduleRecurring({
      name:           "control-group-cache-refresh",
      intervalMs:     60_000,
      runImmediately: true,
      fn: async () => {
        const api = getApi(pCtx);
        if (!api) return;
        try {
          await cache.refresh(api);
          pCtx.logger.info("ControlPlugin: scheduled cache refresh.", {
            groups: cache.groups.length,
            muted:  getMutedThreads().size,
          });
        } catch (err) {
          pCtx.logger.warn("ControlPlugin: scheduled refresh failed.", { error: String(err) });
        }
      },
    });

    const cmdList: ICommand = {
      name:        "قروبات",
      aliases:     ["groups", "threads", "qroubat"],
      description: "عرض قائمة جميع القروبات مع حالة كل منها",
      usage:       "قروبات",
      category:    "admin",
      adminOnly:   true,
      hidden:      false,
      async execute(ctx) { await handleList(ctx, pCtx, cache); },
    };

    const cmdControl: ICommand = {
      name:        "قروب",
      aliases:     ["group", "ctrl"],
      description: "إدارة قروب محدد: حالة | رسالة | مغادرة | اسم | كتم | فتح",
      usage:       "قروب [أمر] [رقم] [نص؟]",
      category:    "admin",
      adminOnly:   true,
      hidden:      false,
      async execute(ctx) {
        const sub = ctx.getArg(0);
        const max = cache.groups.length;
        const noIdx = `⚠️ الرجاء تحديد رقم القروب (1–${max || "؟"}). استخدم «قروبات» أولاً.`;

        if (!sub) {
          await ctx.reply([
            HEADER, "",
            "⌯ أوامر التحكم بالقروبات:", "",
            "  قروبات — عرض جميع القروبات",
            "  قروب حالة [رقم] — حالة قروب محدد",
            "  قروب رسالة [رقم] [نص] — إرسال رسالة",
            "  قروب مغادرة [رقم] — مغادرة القروب",
            "  قروب اسم [رقم] [اسم] — تغيير الاسم",
            "  قروب كتم [رقم] — كتم الأوامر من القروب",
            "  قروب فتح [رقم] — إلغاء كتم القروب",
          ].join("\n"));
          return;
        }

        const n = parseIndex(ctx.getArg(1), max);

        if (sub === "حالة" || sub === "status") {
          if (!n) { await ctx.reply(noIdx); return; }
          await handleStatus(ctx, pCtx, cache, n);
        } else if (sub === "رسالة" || sub === "msg" || sub === "message") {
          if (!n) { await ctx.reply(noIdx); return; }
          await handleSendMessage(ctx, pCtx, cache, n, ctx.args.slice(2).join(" ").trim());
        } else if (sub === "مغادرة" || sub === "leave") {
          if (!n) { await ctx.reply(noIdx); return; }
          await handleLeave(ctx, pCtx, cache, n);
        } else if (sub === "اسم" || sub === "name") {
          if (!n) { await ctx.reply(noIdx); return; }
          await handleRename(ctx, pCtx, cache, n, ctx.args.slice(2).join(" ").trim());
        } else if (sub === "كتم" || sub === "mute") {
          if (!n) { await ctx.reply(noIdx); return; }
          await handleMute(ctx, pCtx, cache, n);
        } else if (sub === "فتح" || sub === "unmute" || sub === "open") {
          if (!n) { await ctx.reply(noIdx); return; }
          await handleUnmute(ctx, pCtx, cache, n);
        } else {
          await ctx.reply(
            `⚠️ أمر غير معروف: «${sub}»\n` +
            `⌯ الأوامر: حالة | رسالة | مغادرة | اسم | كتم | فتح`
          );
        }
      },
    };

    pCtx.registerCommand(cmdList);
    pCtx.registerCommand(cmdControl);
    pCtx.logger.info(
      `ControlPlugin enabled. Commands: قروبات, قروب. ` +
      `Groups cached: ${cache.groups.length}. Muted: ${getMutedThreads().size}.`
    );
  }

  async onDisable(): Promise<void> { this.ctx.logger.info("ControlPlugin disabled."); }
  async onUnload():  Promise<void> { this.ctx.logger.info("ControlPlugin unloaded."); }
}

export default new ControlPlugin();
