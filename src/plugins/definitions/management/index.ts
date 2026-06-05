import fs   from "fs";
import path from "path";
import { IPlugin, PluginManifest } from "../../types/IPlugin";
import { IPluginContext }          from "../../types/IPluginContext";
import { ICommand }                from "../../../commands/types/ICommand";
import { Context }                 from "../../../context/Context";

// ─── Extended FCA types (local — no changes to FcaTypes.ts) ─────────────────

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

interface ThreadState {
  protectName:      boolean;
  lockedName:       string;
  protectNicknames: boolean;
  nicknames:        Record<string, string>; // userID → nickname
}

interface StoreData {
  threads: Record<string, ThreadState>;
}

const DATA_PATH = path.resolve("data/management-plugin.json");

function loadStore(): StoreData {
  try {
    if (fs.existsSync(DATA_PATH)) {
      return JSON.parse(fs.readFileSync(DATA_PATH, "utf8")) as StoreData;
    }
  } catch { /* corrupt file — start fresh */ }
  return { threads: {} };
}

function saveStore(data: StoreData): void {
  const dir = path.dirname(DATA_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2), "utf8");
}

function getThreadState(data: StoreData, threadID: string): ThreadState {
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

/** Small delay to avoid Facebook rate limits when iterating members. */
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// ─── Shared utilities ────────────────────────────────────────────────────────

const HEADER = "⌯𝐕̸̶ֽׁ݊͐͢𝚵̶̱̩֗̀𝚾̣҉̶𝕰̶̟̀𝐋͜ 𝐈𝐃𝐀𝐑𝐀🪽↴";

function getApi(pCtx: IPluginContext): IFcaManagement | null {
  return pCtx.consumeService<IMiraiService>("mirai-transport")?.getApi?.() ?? null;
}

/**
 * Asserts the message is from a group AND the sender is an admin.
 * Returns ThreadInfo on success, null on failure (reply already sent).
 */
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

// ─── Sub-command: اسم (change group name) ────────────────────────────────────

async function handleGroupName(
  ctx:   Context,
  pCtx:  IPluginContext,
): Promise<void> {
  await ctx.typingOn();

  const api = getApi(pCtx);
  if (!api) { await ctx.reply("⚠️ خدمة Facebook غير متاحة."); return; }

  const info = await assertGroupAdmin(ctx, api, pCtx);
  if (!info) return;

  // args: [0]="اسم", [1..] = new name
  const newName = ctx.args.slice(1).join(" ").trim();
  if (!newName) {
    await ctx.reply("⚠️ الرجاء إدخال الاسم الجديد.\n مثال: ادارة اسم اسم القروب الجديد");
    return;
  }

  try {
    await fcaSetTitle(api, newName, ctx.thread.id);
    pCtx.logger.info("Group name changed.", {
      threadID: ctx.thread.id,
      by:       ctx.user.id,
      newName,
    });
    await ctx.reply(`${HEADER}\n\n✅ تم تغيير اسم القروب إلى:\n"${newName}"`);
  } catch (err) {
    pCtx.logger.warn("setTitle failed.", { error: String(err) });
    await ctx.reply("⚠️ فشل تغيير اسم القروب. تأكد أن البوت أدمن في القروب.");
  }
}

// ─── Sub-command: بوت (change bot nickname in group) ─────────────────────────

async function handleBotName(
  ctx:   Context,
  pCtx:  IPluginContext,
): Promise<void> {
  await ctx.typingOn();

  const api = getApi(pCtx);
  if (!api) { await ctx.reply("⚠️ خدمة Facebook غير متاحة."); return; }

  const info = await assertGroupAdmin(ctx, api, pCtx);
  if (!info) return;

  // args: [0]="بوت", [1..] = new bot display name
  const newNick = ctx.args.slice(1).join(" ").trim();
  if (!newNick) {
    await ctx.reply("⚠️ الرجاء إدخال الاسم الجديد للبوت.\n مثال: ادارة بوت Sixsu");
    return;
  }

  const botId = api.getCurrentUserID();
  if (!botId) {
    await ctx.reply("⚠️ تعذّر معرفة هوية البوت.");
    return;
  }

  try {
    await fcaChangeNickname(api, newNick, ctx.thread.id, botId);
    pCtx.logger.info("Bot nickname changed.", {
      threadID: ctx.thread.id,
      by:       ctx.user.id,
      newNick,
    });
    await ctx.reply(`${HEADER}\n\n✅ تم تغيير اسم البوت في هذا القروب إلى:\n"${newNick}"`);
  } catch (err) {
    pCtx.logger.warn("changeNickname (bot) failed.", { error: String(err) });
    await ctx.reply("⚠️ فشل تغيير اسم البوت. تأكد أن البوت أدمن في القروب.");
  }
}

// ─── Sub-command: كنية (set nickname for all members) ────────────────────────

async function handleSetNickname(
  ctx:   Context,
  pCtx:  IPluginContext,
  store: StoreData,
): Promise<void> {
  await ctx.typingOn();

  const api = getApi(pCtx);
  if (!api) { await ctx.reply("⚠️ خدمة Facebook غير متاحة."); return; }

  const info = await assertGroupAdmin(ctx, api, pCtx);
  if (!info) return;

  // args: [0]="كنية", [1..] = nickname
  const nickname = ctx.args.slice(1).join(" ").trim();
  if (!nickname) {
    await ctx.reply("⚠️ الرجاء إدخال الكنية.\n مثال: ادارة كنية 🌟 عضو");
    return;
  }

  const participants = info.participantIDs;
  if (!participants.length) {
    await ctx.reply("⚠️ لا يوجد أعضاء في القروب.");
    return;
  }

  await ctx.reply(`⏳ جارٍ تعيين الكنية "${nickname}" لـ ${participants.length} عضو...`);

  const threadState = getThreadState(store, ctx.thread.id);
  let ok = 0;
  let failed = 0;

  for (const uid of participants) {
    try {
      await fcaChangeNickname(api, nickname, ctx.thread.id, uid);
      threadState.nicknames[uid] = nickname;
      ok++;
    } catch {
      failed++;
    }
    await sleep(250); // avoid rate limit
  }

  saveStore(store);
  pCtx.logger.info("Nicknames set for all members.", {
    threadID: ctx.thread.id,
    nickname,
    ok,
    failed,
  });

  const lines = [
    HEADER,
    "",
    `✅ تم تعيين الكنية: "${nickname}"`,
    `⌯ نجح: ${ok} عضو`,
  ];
  if (failed > 0) lines.push(`⌯ فشل: ${failed} عضو`);
  await ctx.reply(lines.join("\n"));
}

// ─── Sub-command: حماية (toggle name or nickname protection) ─────────────────

async function handleProtection(
  ctx:   Context,
  pCtx:  IPluginContext,
  store: StoreData,
): Promise<void> {
  await ctx.typingOn();

  const target = ctx.getArg(1); // "اسم" | "كنيات"

  if (target === "اسم") {
    await handleProtectName(ctx, pCtx, store);
  } else if (target === "كنيات") {
    await handleProtectNicknames(ctx, pCtx, store);
  } else {
    await ctx.reply(
      "⚠️ الرجاء تحديد ما تريد حمايته:\n" +
      "• ادارة حماية اسم\n" +
      "• ادارة حماية كنيات"
    );
  }
}

async function handleProtectName(
  ctx:   Context,
  pCtx:  IPluginContext,
  store: StoreData,
): Promise<void> {
  const api = getApi(pCtx);
  if (!api) { await ctx.reply("⚠️ خدمة Facebook غير متاحة."); return; }

  const info = await assertGroupAdmin(ctx, api, pCtx);
  if (!info) return;

  const threadState = getThreadState(store, ctx.thread.id);

  if (!threadState.protectName) {
    threadState.protectName = true;
    threadState.lockedName  = info.name;
    saveStore(store);
    pCtx.logger.info("Name protection enabled.", {
      threadID:   ctx.thread.id,
      lockedName: info.name,
    });
    await ctx.reply(
      `${HEADER}\n\n🔒 تم تفعيل حماية اسم القروب.\n⌯ الاسم المحمي: "${info.name}"`
    );
  } else {
    threadState.protectName = false;
    threadState.lockedName  = "";
    saveStore(store);
    pCtx.logger.info("Name protection disabled.", { threadID: ctx.thread.id });
    await ctx.reply(`${HEADER}\n\n🔓 تم إيقاف حماية اسم القروب.`);
  }
}

async function handleProtectNicknames(
  ctx:   Context,
  pCtx:  IPluginContext,
  store: StoreData,
): Promise<void> {
  const api = getApi(pCtx);
  if (!api) { await ctx.reply("⚠️ خدمة Facebook غير متاحة."); return; }

  const info = await assertGroupAdmin(ctx, api, pCtx);
  if (!info) return;

  const threadState = getThreadState(store, ctx.thread.id);

  if (!threadState.protectNicknames) {
    if (Object.keys(threadState.nicknames).length === 0) {
      await ctx.reply(
        "⚠️ لا توجد كنيات محفوظة لهذا القروب.\n" +
        "استخدم أولاً: ادارة كنية [كنية]"
      );
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

// ─── Sub-command: تنظيف كنيات (clear all nicknames) ─────────────────────────

async function handleClearNicknames(
  ctx:   Context,
  pCtx:  IPluginContext,
  store: StoreData,
): Promise<void> {
  await ctx.typingOn();

  // Expect: ادارة تنظيف كنيات
  const target = ctx.getArg(1);
  if (target !== "كنيات") {
    await ctx.reply("⚠️ هل تقصد: ادارة تنظيف كنيات");
    return;
  }

  const api = getApi(pCtx);
  if (!api) { await ctx.reply("⚠️ خدمة Facebook غير متاحة."); return; }

  const info = await assertGroupAdmin(ctx, api, pCtx);
  if (!info) return;

  const participants = info.participantIDs;
  await ctx.reply(`⏳ جارٍ مسح الكنيات لـ ${participants.length} عضو...`);

  let ok = 0;
  let failed = 0;

  for (const uid of participants) {
    try {
      // Empty string = clear nickname in fca-unofficial
      await fcaChangeNickname(api, "", ctx.thread.id, uid);
      ok++;
    } catch {
      failed++;
    }
    await sleep(250);
  }

  // Clear stored state
  const threadState = getThreadState(store, ctx.thread.id);
  threadState.nicknames        = {};
  threadState.protectNicknames = false;
  saveStore(store);

  pCtx.logger.info("All nicknames cleared.", {
    threadID: ctx.thread.id,
    ok,
    failed,
  });

  const lines = [HEADER, "", "✅ تم مسح جميع الكنيات", `⌯ نجح: ${ok} عضو`];
  if (failed > 0) lines.push(`⌯ فشل: ${failed} عضو`);
  await ctx.reply(lines.join("\n"));
}

// ─── Help ────────────────────────────────────────────────────────────────────

async function showHelp(ctx: Context): Promise<void> {
  await ctx.reply([
    HEADER,
    "",
    "⌯ أوامر الإدارة (للأدمن فقط):",
    "",
    "• ادارة اسم [الاسم]",
    "  ↳ تغيير اسم القروب",
    "",
    "• ادارة بوت [الاسم]",
    "  ↳ تغيير اسم البوت في القروب",
    "",
    "• ادارة كنية [الكنية]",
    "  ↳ تعيين كنية لجميع الأعضاء",
    "",
    "• ادارة حماية اسم",
    "  ↳ تفعيل/إيقاف حماية اسم القروب",
    "",
    "• ادارة حماية كنيات",
    "  ↳ تفعيل/إيقاف حماية كنيات الأعضاء",
    "",
    "• ادارة تنظيف كنيات",
    "  ↳ مسح جميع الكنيات",
  ].join("\n"));
}

// ─── Protection background task ──────────────────────────────────────────────

async function runProtectionTask(
  pCtx:  IPluginContext,
  store: StoreData,
): Promise<void> {
  const api = getApi(pCtx);
  if (!api) return;

  for (const [threadID, state] of Object.entries(store.threads)) {
    // ── Group name protection ──────────────────────────────────────────────
    if (state.protectName && state.lockedName) {
      try {
        const info = await fcaGetThreadInfo(api, threadID);
        if (info.name !== state.lockedName) {
          pCtx.logger.warn("Name protection triggered — reverting.", {
            threadID,
            found:  info.name,
            locked: state.lockedName,
          });
          await fcaSetTitle(api, state.lockedName, threadID);
        }
      } catch (err) {
        pCtx.logger.debug("Name protection check failed.", {
          threadID,
          error: String(err),
        });
      }
    }

    // ── Nickname protection ────────────────────────────────────────────────
    if (state.protectNicknames && Object.keys(state.nicknames).length > 0) {
      try {
        const info         = await fcaGetThreadInfo(api, threadID);
        const currentNicks = info.nicknames ?? {};

        for (const [uid, expected] of Object.entries(state.nicknames)) {
          const current = currentNicks[uid] ?? "";
          if (current !== expected) {
            pCtx.logger.info("Nickname protection triggered.", { threadID, uid });
            await fcaChangeNickname(api, expected, threadID, uid).catch(() => { /* best effort */ });
            await sleep(200);
          }
        }
      } catch (err) {
        pCtx.logger.debug("Nickname protection check failed.", {
          threadID,
          error: String(err),
        });
      }
    }
  }
}

// ─── Plugin class ─────────────────────────────────────────────────────────────

class ManagementPlugin implements IPlugin {
  readonly manifest: PluginManifest = {
    name:        "management",
    version:     "1.0.0",
    description: "إدارة أسماء القروب وكنيات الأعضاء مع حماية تلقائية.",
    author:      "Sixseven-6677",
  };

  private ctx!:  IPluginContext;
  private store: StoreData = { threads: {} };

  async onLoad(ctx: IPluginContext): Promise<void> {
    this.ctx  = ctx;
    this.store = loadStore();
    ctx.logger.info("ManagementPlugin loaded.", {
      savedThreads: Object.keys(this.store.threads).length,
    });
  }

  async onEnable(): Promise<void> {
    const pCtx  = this.ctx;
    const store = this.store;

    // Build command with closure over pCtx & store
    const mgmtCommand: ICommand = {
      name:        "ادارة",
      aliases:     ["manage", "إدارة", "management"],
      description: "إدارة أسماء القروب والبوت والكنيات",
      usage:       "ادارة [اسم|بوت|كنية|حماية|تنظيف]",
      category:    "util",
      adminOnly:   false, // each handler performs its own admin check
      hidden:      false,

      async execute(ctx: Context): Promise<void> {
        const sub = ctx.getArg(0);

        switch (sub) {
          case "اسم":
            await handleGroupName(ctx, pCtx);
            break;
          case "بوت":
            await handleBotName(ctx, pCtx);
            break;
          case "كنية":
            await handleSetNickname(ctx, pCtx, store);
            break;
          case "حماية":
            await handleProtection(ctx, pCtx, store);
            break;
          case "تنظيف":
            await handleClearNicknames(ctx, pCtx, store);
            break;
          default:
            await showHelp(ctx);
        }
      },
    };

    pCtx.registerCommand(mgmtCommand);
    pCtx.logger.info(`Command "${mgmtCommand.name}" registered (aliases: ${mgmtCommand.aliases?.join(", ")}).`);

    // Recurring task: check name + nickname protection every 60 seconds
    pCtx.scheduleRecurring({
      name:           "management:protection-check",
      intervalMs:     60_000,
      runImmediately: false,
      fn: async () => {
        await runProtectionTask(pCtx, store);
      },
      onError: (err) => {
        pCtx.logger.warn("Protection task error.", { error: String(err) });
      },
    });

    pCtx.logger.info("ManagementPlugin enabled — protection task started (60s interval).");
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
