import fs   from "fs";
import path from "path";
import { config }          from "../../../config/env";
import { IPlugin, PluginManifest } from "../../types/IPlugin";
import { IPluginContext }          from "../../types/IPluginContext";
import { ICommand }                from "../../../commands/types/ICommand";
import { Context }                 from "../../../context/Context";
import {
  setProtectionStore,
  ThreadState,
  ProtectionStore,
} from "../../../protection/ProtectionRegistry";

// ─── Extended FCA types ──────────────────────────────────────────────────────

interface ThreadUserInfo {
  name:       string;
  firstName?: string;
}

interface ThreadInfo {
  threadID:       string;
  participantIDs: string[];
  adminIDs:       Array<{ id: string }>;
  name:           string;
  isGroup:        boolean;
  userInfo:       Record<string, ThreadUserInfo>;
  nicknames?:     Record<string, string | null>;
}

interface IFcaManagement {
  getCurrentUserID(): string;
  getThreadInfo(
    threadID: string,
    callback: (err: Error | null, info: ThreadInfo) => void,
  ): void;
  setTitle(
    newTitle: string,
    threadID: string,
    callback: (err: Error | null) => void,
  ): void;
  changeNickname(
    nickname:      string,
    threadID:      string,
    participantID: string,
    callback?:     (err: Error | null) => void,
  ): void;
}

interface IMiraiService {
  getApi(): IFcaManagement | null;
}

// ─── Persistent store ────────────────────────────────────────────────────────

const DATA_PATH = path.resolve("data/management-plugin.json");

function loadStore(): ProtectionStore {
  try {
    if (fs.existsSync(DATA_PATH)) {
      const raw = JSON.parse(fs.readFileSync(DATA_PATH, "utf8")) as ProtectionStore;
      if (!raw.botNicknames) raw.botNicknames = {};
      return raw;
    }
  } catch { /* corrupt file — start fresh */ }
  return { threads: {}, botNicknames: {} };
}

function saveStore(data: ProtectionStore): void {
  const dir = path.dirname(DATA_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2), "utf8");
  setProtectionStore(data);
}

function getThreadState(data: ProtectionStore, threadID: string): ThreadState {
  if (!data.threads[threadID]) {
    data.threads[threadID] = {
      protectName:      false,
      lockedName:       "",
      protectNicknames: false,
      nicknames:        {},
    };
  }
  return data.threads[threadID]!;
}

// ─── FCA promise wrappers ────────────────────────────────────────────────────

function fcaGetThreadInfo(api: IFcaManagement, threadID: string): Promise<ThreadInfo> {
  return new Promise((resolve, reject) => {
    api.getThreadInfo(threadID, (err, info) => {
      if (err) reject(err);
      else     resolve(info);
    });
  });
}

function fcaSetTitle(api: IFcaManagement, title: string, threadID: string): Promise<void> {
  return new Promise((resolve, reject) => {
    api.setTitle(title, threadID, (err) => {
      if (err) reject(err);
      else     resolve();
    });
  });
}

function fcaChangeNickname(
  api:      IFcaManagement,
  nick:     string,
  threadID: string,
  userID:   string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    api.changeNickname(nick, threadID, userID, (err) => {
      if (err) reject(err);
      else     resolve();
    });
  });
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// ─── Shared utilities ────────────────────────────────────────────────────────

const HEADER = "⌯𝐕̸̶ֽׁ݊͐͢𝚵̶̱̩֗̀𝚾̣҉̶𝕰̶̟̀𝐋͜ 𝐈𝐃𝐀𝐑𝐀🪽↴";

function getApi(pCtx: IPluginContext): IFcaManagement | null {
  const primary = pCtx.consumeService<IMiraiService>("mirai-transport")?.getApi?.() ?? null;
  if (primary) return primary;
  return pCtx.consumeService<IMiraiService>("mirai-transport-secondary")?.getApi?.() ?? null;
}

async function assertGroupAdmin(
  ctx:  Context,
  api:  IFcaManagement,
  pCtx: IPluginContext,
): Promise<ThreadInfo | null> {
  let info: ThreadInfo;
  try {
    info = await fcaGetThreadInfo(api, ctx.thread.id);
  } catch (err) {
    pCtx.logger.warn("assertGroupAdmin: getThreadInfo failed.", { error: String(err) });
    await ctx.reply("⚠️ تعذّر جلب معلومات القروب. تأكد أن البوت مضاف للقروب.");
    return null;
  }

  if (!info.isGroup) {
    await ctx.reply("⚠️ هذا الأمر يعمل في القروبات فقط.");
    return null;
  }

  const isGroupAdmin = info.adminIDs.some((a) => a.id === ctx.user.id);
  const isBotAdmin   = ctx.hasRole("admin");

  if (!isGroupAdmin && !isBotAdmin) {
    await ctx.reply("🚫 هذا الأمر للأدمن فقط.");
    return null;
  }

  return info;
}

// ─── /ادارة → curated submenu display ───────────────────────────────────────

async function showHelp(ctx: Context): Promise<void> {
  const prefix = config.bot.prefix || "/";

  await ctx.reply([
    HEADER,
    "",
    `⌯ اسم قروب — تغيير اسم القروب`,
    `  ↳ ${prefix}اسم [الاسم الجديد]`,
    "",
    `⌯ اسم بوت — تغيير اسم البوت في القروب (للمالك فقط)`,
    `  ↳ ${prefix}بوت [الاسم]`,
    "",
    `⌯ كنية — تعيين كنية لجميع الأعضاء`,
    `  ↳ ${prefix}كنية [الكنية]`,
    "",
    `⌯ بادئة — عرض البادئة الحالية`,
    `  ↳ ${prefix}بادئة`,
  ].join("\n"));
}

// ─── Sub-command handlers ────────────────────────────────────────────────────

async function handleGroupName(ctx: Context, pCtx: IPluginContext): Promise<void> {
  await ctx.typingOn();

  const api = getApi(pCtx);
  if (!api) { await ctx.reply("⚠️ خدمة Facebook غير متاحة."); return; }

  const info = await assertGroupAdmin(ctx, api, pCtx);
  if (!info) return;

  const newName = ctx.args.slice(0).join(" ").trim();
  if (!newName) {
    await ctx.reply("⚠️ الرجاء إدخال الاسم الجديد.\n مثال: /اسم اسم القروب الجديد");
    return;
  }

  try {
    await fcaSetTitle(api, newName, ctx.thread.id);
    pCtx.logger.info("Group name changed.", { threadID: ctx.thread.id, by: ctx.user.id, newName });
    await ctx.reply(`${HEADER}\n\n✅ تم تغيير اسم القروب إلى:\n"${newName}"`);
  } catch (err) {
    pCtx.logger.warn("setTitle failed.", { error: String(err) });
    await ctx.reply("⚠️ فشل تغيير اسم القروب. تأكد أن البوت أدمن في القروب.");
  }
}

async function handleBotName(ctx: Context, pCtx: IPluginContext, store: ProtectionStore): Promise<void> {
  await ctx.typingOn();

  if (!ctx.hasRole("owner")) {
    await ctx.reply("🔐 تغيير اسم البوت مخصص للمالك فقط.");
    return;
  }

  const api = getApi(pCtx);
  if (!api) { await ctx.reply("⚠️ خدمة Facebook غير متاحة."); return; }

  let info: ThreadInfo;
  try {
    info = await fcaGetThreadInfo(api, ctx.thread.id);
  } catch (err) {
    pCtx.logger.warn("handleBotName: getThreadInfo failed.", { error: String(err) });
    await ctx.reply("⚠️ تعذّر جلب معلومات القروب.");
    return;
  }

  if (!info.isGroup) {
    await ctx.reply("⚠️ هذا الأمر يعمل في القروبات فقط.");
    return;
  }

  const newNick = ctx.args.slice(0).join(" ").trim();
  if (!newNick) {
    const current = store.botNicknames[ctx.thread.id];
    if (current) {
      await ctx.reply(`${HEADER}\n\n🤖 الاسم المحمي الحالي للبوت:\n"${current}"\n\nلتغييره: /بوت [الاسم الجديد]`);
    } else {
      await ctx.reply(`${HEADER}\n\n⚠️ لم يُعيَّن اسم محمي للبوت في هذا القروب.\n\nلتعيينه: /بوت [الاسم]`);
    }
    return;
  }

  const botId = api.getCurrentUserID();

  try {
    await fcaChangeNickname(api, newNick, ctx.thread.id, botId);
    store.botNicknames[ctx.thread.id] = newNick;
    saveStore(store);
    pCtx.logger.info("Bot nickname set and protected.", { threadID: ctx.thread.id, botId, newNick });
    await ctx.reply(
      `${HEADER}\n\n✅ تم تعيين اسم البوت وحمايته:\n"${newNick}"\n\n🔒 أي محاولة لتغييره ستُعاد تلقائياً.`
    );
  } catch (err) {
    pCtx.logger.warn("handleBotName: changeNickname failed.", { error: String(err) });
    await ctx.reply("⚠️ فشل تغيير اسم البوت. تأكد أن البوت أدمن في القروب.");
  }
}

async function handleSetNickname(ctx: Context, pCtx: IPluginContext, store: ProtectionStore): Promise<void> {
  await ctx.typingOn();

  const api = getApi(pCtx);
  if (!api) { await ctx.reply("⚠️ خدمة Facebook غير متاحة."); return; }

  const info = await assertGroupAdmin(ctx, api, pCtx);
  if (!info) return;

  const nick = ctx.args.slice(0).join(" ").trim();
  if (!nick) {
    await ctx.reply("⚠️ الرجاء إدخال الكنية.\n مثال: /كنية كنية");
    return;
  }

  const botId   = api.getCurrentUserID();
  const botNick = store.botNicknames[ctx.thread.id] ?? null;

  const participants = info.participantIDs.filter((id) => id !== botId);

  await ctx.reply(`⏳ جارٍ تعيين الكنية لـ ${participants.length} عضو...`);

  let ok = 0;
  let failed = 0;
  const threadState = getThreadState(store, ctx.thread.id);

  for (const uid of participants) {
    try {
      await fcaChangeNickname(api, nick, ctx.thread.id, uid);
      threadState.nicknames[uid] = nick;
      ok++;
    } catch { failed++; }
    await sleep(1_000);
  }

  if (botId && botNick) {
    try {
      await fcaChangeNickname(api, botNick, ctx.thread.id, botId);
      pCtx.logger.info("Bot nickname restored after set-nickname.", { threadID: ctx.thread.id, botNick });
    } catch { /* best effort */ }
  }

  saveStore(store);
  pCtx.logger.info("Nicknames set.", { threadID: ctx.thread.id, nick, ok, failed });

  const lines = [HEADER, "", `✅ تم تعيين الكنية: "${nick}"`, `⌯ نجح: ${ok} عضو`];
  if (failed > 0) lines.push(`⌯ فشل: ${failed} عضو`);
  if (botNick)    lines.push(`⌯ اسم البوت محمي: "${botNick}"`);
  await ctx.reply(lines.join("\n"));
}

async function handleProtection(ctx: Context, pCtx: IPluginContext, store: ProtectionStore): Promise<void> {
  const target = ctx.getArg(0);

  if (target === "اسم") {
    await handleProtectName(ctx, pCtx, store);
  } else if (target === "كنيات") {
    await handleProtectNicknames(ctx, pCtx, store);
  } else {
    await ctx.reply(
      `${HEADER}\n\n⚠️ حدد نوع الحماية:\n` +
      `⌯ /حماية اسم — حماية اسم القروب\n` +
      `⌯ /حماية كنيات — حماية كنيات الأعضاء`
    );
  }
}

async function handleProtectName(ctx: Context, pCtx: IPluginContext, store: ProtectionStore): Promise<void> {
  const api = getApi(pCtx);
  if (!api) { await ctx.reply("⚠️ خدمة Facebook غير متاحة."); return; }

  const info = await assertGroupAdmin(ctx, api, pCtx);
  if (!info) return;

  const threadState = getThreadState(store, ctx.thread.id);

  if (!threadState.protectName) {
    threadState.protectName = true;
    threadState.lockedName  = info.name;
    saveStore(store);
    pCtx.logger.info("Name protection enabled.", { threadID: ctx.thread.id, lockedName: info.name });
    await ctx.reply(`${HEADER}\n\n🔒 تم تفعيل حماية اسم القروب.\n⌯ الاسم المحمي: "${info.name}"`);
  } else {
    threadState.protectName = false;
    threadState.lockedName  = "";
    saveStore(store);
    pCtx.logger.info("Name protection disabled.", { threadID: ctx.thread.id });
    await ctx.reply(`${HEADER}\n\n🔓 تم إيقاف حماية اسم القروب.`);
  }
}

async function handleProtectNicknames(ctx: Context, pCtx: IPluginContext, store: ProtectionStore): Promise<void> {
  const api = getApi(pCtx);
  if (!api) { await ctx.reply("⚠️ خدمة Facebook غير متاحة."); return; }

  const info = await assertGroupAdmin(ctx, api, pCtx);
  if (!info) return;

  const threadState = getThreadState(store, ctx.thread.id);

  if (!threadState.protectNicknames) {
    if (Object.keys(threadState.nicknames).length === 0) {
      await ctx.reply("⚠️ لا توجد كنيات محفوظة لهذا القروب.\nاستخدم أولاً: /كنية [كنية]");
      return;
    }
    threadState.protectNicknames = true;
    saveStore(store);
    pCtx.logger.info("Nickname protection enabled.", { threadID: ctx.thread.id });
    await ctx.reply(
      `${HEADER}\n\n🔒 تم تفعيل حماية الكنيات.\n` +
      `⌯ عدد الأعضاء المحميين: ${Object.keys(threadState.nicknames).length}`
    );
  } else {
    threadState.protectNicknames = false;
    saveStore(store);
    pCtx.logger.info("Nickname protection disabled.", { threadID: ctx.thread.id });
    await ctx.reply(`${HEADER}\n\n🔓 تم إيقاف حماية الكنيات.`);
  }
}

async function handleClearNicknames(ctx: Context, pCtx: IPluginContext, store: ProtectionStore): Promise<void> {
  await ctx.typingOn();

  const target = ctx.getArg(0);
  if (target !== "كنيات") {
    await ctx.reply("⚠️ هل تقصد: /تنظيف كنيات");
    return;
  }

  const api = getApi(pCtx);
  if (!api) { await ctx.reply("⚠️ خدمة Facebook غير متاحة."); return; }

  const info = await assertGroupAdmin(ctx, api, pCtx);
  if (!info) return;

  const botId   = api.getCurrentUserID();
  const botNick = store.botNicknames[ctx.thread.id] ?? null;

  const participants = info.participantIDs.filter((id) => id !== botId);
  await ctx.reply(`⏳ جارٍ مسح الكنيات لـ ${participants.length} عضو...`);

  let ok = 0;
  let failed = 0;

  for (const uid of participants) {
    try {
      await fcaChangeNickname(api, "", ctx.thread.id, uid);
      ok++;
    } catch { failed++; }
    await sleep(1_000);
  }

  if (botId && botNick) {
    try {
      await fcaChangeNickname(api, botNick, ctx.thread.id, botId);
      pCtx.logger.info("Bot nickname restored after clear.", { threadID: ctx.thread.id, botNick });
    } catch { /* best effort */ }
  }

  const threadState = getThreadState(store, ctx.thread.id);
  threadState.nicknames        = {};
  threadState.protectNicknames = false;
  saveStore(store);

  pCtx.logger.info("All nicknames cleared (bot skipped).", { threadID: ctx.thread.id, ok, failed });

  const lines = [HEADER, "", "✅ تم مسح جميع الكنيات", `⌯ نجح: ${ok} عضو`];
  if (failed > 0) lines.push(`⌯ فشل: ${failed} عضو`);
  if (botNick)    lines.push(`⌯ اسم البوت محمي: "${botNick}"`);
  await ctx.reply(lines.join("\n"));
}

// ─── Plugin class ─────────────────────────────────────────────────────────────

class ManagementPlugin implements IPlugin {
  readonly manifest: PluginManifest = {
    name:        "management",
    version:     "4.0.0",
    description: "إدارة أسماء القروب وكنيات الأعضاء مع حماية مدمجة في pipeline الأحداث.",
    author:      "Sixseven-6677",
  };

  private ctx!:  IPluginContext;
  private store: ProtectionStore = { threads: {}, botNicknames: {} };

  async onLoad(ctx: IPluginContext): Promise<void> {
    this.ctx   = ctx;
    this.store = loadStore();
    setProtectionStore(this.store);
    ctx.logger.info("ManagementPlugin loaded — ProtectionRegistry initialised.", {
      savedThreads:  Object.keys(this.store.threads).length,
      protectedBots: Object.keys(this.store.botNicknames).length,
    });
  }

  async onEnable(): Promise<void> {
    const pCtx  = this.ctx;
    const store = this.store;

    const cmdName: ICommand = {
      name:        "اسم",
      aliases:     ["name", "groupname"],
      description: "تغيير اسم القروب",
      usage:       "اسم [الاسم الجديد]",
      category:    "util",
      adminOnly:   false,
      hidden:      true,
      async execute(ctx) { await handleGroupName(ctx, pCtx); },
    };

    const cmdBot: ICommand = {
      name:        "بوت",
      aliases:     ["botnick", "botname"],
      description: "تغيير اسم البوت في القروب (للمالك فقط)",
      usage:       "بوت [الاسم]",
      category:    "util",
      adminOnly:   false,
      hidden:      true,
      async execute(ctx) { await handleBotName(ctx, pCtx, store); },
    };

    const cmdNick: ICommand = {
      name:        "كنية",
      aliases:     ["nick", "nickname"],
      description: "تعيين كنية لجميع الأعضاء",
      usage:       "كنية [الكنية]",
      category:    "util",
      adminOnly:   false,
      hidden:      true,
      async execute(ctx) { await handleSetNickname(ctx, pCtx, store); },
    };

    const cmdProtect: ICommand = {
      name:        "حماية",
      aliases:     ["protect", "protection"],
      description: "تفعيل/إيقاف حماية اسم القروب أو الكنيات",
      usage:       "حماية [اسم|كنيات]",
      category:    "util",
      adminOnly:   false,
      hidden:      true,
      async execute(ctx) { await handleProtection(ctx, pCtx, store); },
    };

    const cmdClean: ICommand = {
      name:        "تنظيف",
      aliases:     ["clean", "clearnicks"],
      description: "مسح جميع الكنيات من القروب",
      usage:       "تنظيف كنيات",
      category:    "util",
      adminOnly:   false,
      hidden:      true,
      async execute(ctx) { await handleClearNicknames(ctx, pCtx, store); },
    };

    const cmdHelp: ICommand = {
      name:        "ادارة",
      aliases:     ["manage", "إدارة", "management"],
      description: "عرض أوامر إدارة القروب",
      usage:       "ادارة",
      category:    "util",
      adminOnly:   false,
      hidden:      false,
      async execute(ctx) { await showHelp(ctx); },
    };

    for (const cmd of [cmdName, cmdBot, cmdNick, cmdProtect, cmdClean, cmdHelp]) {
      pCtx.registerCommand(cmd);
      pCtx.logger.info(`Command "${cmd.name}" registered (aliases: ${cmd.aliases?.join(", ")}).`);
    }

    pCtx.logger.info(
      "ManagementPlugin enabled — protection handled via FCA event pipeline " +
      "(log:thread-name + log:user-nickname → GroupHandler)."
    );
  }

  async onDisable(): Promise<void> {
    saveStore(this.store);
    this.ctx.logger.info("ManagementPlugin disabled — store saved.");
  }

  async onUnload(): Promise<void> {
    saveStore(this.store);
    this.ctx.logger.info("ManagementPlugin unloaded.");
  }
}

export default new ManagementPlugin();
