import { IPlugin, PluginManifest } from "../../types/IPlugin";
import { IPluginContext }          from "../../types/IPluginContext";
import { ICommand }                from "../../../commands/types/ICommand";
import { Context }                 from "../../../context/Context";

// ─── Extended FCA types ────────────────────────────────────────────────────

interface RawThread {
  threadID:    string;
  name?:       string;
  threadName?: string;
  isGroup:     boolean;
  folder?:     string;
}

interface IFcaRequestsApi {
  getCurrentUserID(): string;
  getThreadList(
    limit:     number,
    timestamp: number | null,
    tags:      string[],
    callback:  (err: Error | null, list: RawThread[]) => void,
  ): void;
  handleMessageRequest(
    threadID:  string,
    accept:    boolean,
    callback?: (err: Error | null) => void,
  ): void;
  removeUserFromGroup(
    userID:    string,
    threadID:  string,
    callback?: (err: Error | null) => void,
  ): void;
}

interface IMiraiRequests { getApi(): IFcaRequestsApi | null; }

// ─── Entry shape ───────────────────────────────────────────────────────────

interface PendingEntry {
  threadID: string;
  name:     string;
  folder:   "PENDING" | "SPAM";
}

// ─── Constants ─────────────────────────────────────────────────────────────

const HEADER = "⸪⟅𝐕̶݈̂͜𝔈̟͢⃟݃།̶𝝬̶۪͛ۡ⸸𝚬̱̩⩨ܵ𝐁᮫͎ܺ݀ࣸ᷼᷍⃢ː𝚶̶݄݈݊𝐓݂ ❈ 🦢";

function getApi(pCtx: IPluginContext): IFcaRequestsApi | null {
  return (
    pCtx.consumeService<IMiraiRequests>("mirai-transport")?.getApi?.() ??
    pCtx.consumeService<IMiraiRequests>("mirai-transport-secondary")?.getApi?.() ??
    null
  );
}

/**
 * Fetch a thread list by tag — resolves to [] on error or timeout.
 */
function safeGetList(api: IFcaRequestsApi, tag: string): Promise<RawThread[]> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve([]), 14_000);
    try {
      api.getThreadList(50, null, [tag], (err, list) => {
        clearTimeout(timer);
        resolve(Array.isArray(list) ? list : []);
      });
    } catch {
      clearTimeout(timer);
      resolve([]);
    }
  });
}

function threadName(t: RawThread): string {
  return (t.name ?? t.threadName ?? "بدون اسم").trim();
}

/**
 * Fetch ALL pending/spam groups.
 *
 * Strategy (matches MOMO):
 *  1. Fetch PENDING list, SPAM list, and INBOX list in parallel.
 *  2. Add every group from the PENDING list.
 *  3. Add every group from INBOX whose folder === "PENDING".
 *  4. Add every group from the SPAM list.
 *  5. Add every group from INBOX whose folder === "SPAM".
 *
 * This dual-source approach catches groups that appear in INBOX
 * with a folder tag instead of appearing in the dedicated lists.
 */
async function fetchPendingGroups(
  api:    IFcaRequestsApi,
  pCtx:   IPluginContext,
): Promise<PendingEntry[]> {
  const [pendingList, spamList, inboxList] = await Promise.all([
    safeGetList(api, "PENDING"),
    safeGetList(api, "SPAM"),
    safeGetList(api, "INBOX"),
  ]);

  pCtx.logger.info("RequestsPlugin: raw counts.", {
    pending: pendingList.length,
    spam:    spamList.length,
    inbox:   inboxList.length,
  });

  const seen    = new Set<string>();
  const entries: PendingEntry[] = [];

  const add = (t: RawThread, folder: "PENDING" | "SPAM"): void => {
    if (!t.threadID || seen.has(t.threadID)) return;
    seen.add(t.threadID);
    entries.push({ threadID: t.threadID, name: threadName(t), folder });
  };

  // ── PENDING ──────────────────────────────────────────────────────────
  for (const t of pendingList)                                    add(t, "PENDING");
  for (const t of inboxList.filter(x => x.folder === "PENDING")) add(t, "PENDING");

  // ── SPAM ─────────────────────────────────────────────────────────────
  for (const t of spamList)                                       add(t, "SPAM");
  for (const t of inboxList.filter(x => x.folder === "SPAM"))    add(t, "SPAM");

  pCtx.logger.info("RequestsPlugin: resolved entries.", { count: entries.length });
  return entries;
}

function buildListMessage(entries: PendingEntry[]): string {
  if (entries.length === 0) {
    return (
      `${HEADER}\n\n` +
      "✅ لا توجد قروبات معلقة أو سبام.\n\n" +
      "⌯ إذا كان هناك قروب في Spam في ماسنجر ولم يظهر،\n" +
      "   افتح الماسنجر وتأكد أن البوت كُلِّف في الرسائل المعلقة."
    );
  }

  const pending = entries.filter((e) => e.folder === "PENDING");
  const spam    = entries.filter((e) => e.folder === "SPAM");
  const lines: string[] = [HEADER, "", "📋 القروبات المعلقة:", ""];

  if (pending.length > 0) {
    lines.push(`📥 الانتظار (${pending.length}):`);
    for (const e of pending) {
      lines.push(`  ${entries.indexOf(e) + 1}. ${e.name}`);
      lines.push(`     🔑 ${e.threadID}`);
      lines.push("");
    }
  }

  if (spam.length > 0) {
    lines.push(`⚠️ السبام (${spam.length}):`);
    for (const e of spam) {
      lines.push(`  ${entries.indexOf(e) + 1}. ${e.name}`);
      lines.push(`     🔑 ${e.threadID}`);
      lines.push("");
    }
  }

  lines.push("─────────────────────────────");
  lines.push("⌯ الأوامر:");
  lines.push("  طلبات قبول [رقم] — الدخول للقروب ✅");
  lines.push("  طلبات حذف [رقم]  — رفض/حذف القروب 🗑");

  return lines.join("\n");
}

// ─── Plugin ────────────────────────────────────────────────────────────────

class RequestsPlugin implements IPlugin {
  readonly manifest: PluginManifest = {
    name:        "requests",
    version:     "1.1.0",
    description: "عرض وإدارة القروبات المعلقة (PENDING) والسبام (SPAM).",
    author:      "Sixseven-6677",
  };

  private ctx!: IPluginContext;

  async onLoad(ctx: IPluginContext): Promise<void> {
    this.ctx = ctx;
    ctx.logger.info("RequestsPlugin loaded.");
  }

  async onEnable(): Promise<void> {
    const pCtx = this.ctx;

    const cmd: ICommand = {
      name:        "طلبات",
      aliases:     ["requests", "pending", "spam"],
      description: "عرض القروبات المعلقة والسبام مع إمكانية القبول أو الرفض",
      usage:       "طلبات | طلبات قبول [رقم] | طلبات حذف [رقم]",
      category:    "admin",
      adminOnly:   true,
      hidden:      false,

      async execute(ctx: Context): Promise<void> {
        await ctx.typingOn();

        const api = getApi(pCtx);
        if (!api) {
          await ctx.reply("⚠️ خدمة Facebook غير متاحة حالياً.");
          return;
        }

        const sub = ctx.getArg(0);

        // ── List ─────────────────────────────────────────────────────────
        if (!sub || sub === "قائمة" || sub === "list") {
          await ctx.reply("🔍 جاري جلب القروبات المعلقة والسبام...");
          const entries = await fetchPendingGroups(api, pCtx);
          await ctx.reply(buildListMessage(entries));
          return;
        }

        // ── Accept / Reject ───────────────────────────────────────────────
        const isAccept = sub === "قبول"  || sub === "accept" || sub === "دخول";
        const isDelete  = sub === "حذف"  || sub === "delete"  || sub === "رفض"  || sub === "reject";

        if (isAccept || isDelete) {
          const idxStr = ctx.getArg(1);
          const idx    = idxStr ? parseInt(idxStr, 10) : NaN;

          if (isNaN(idx) || idx < 1) {
            await ctx.reply(
              `⚠️ الرجاء تحديد رقم القروب.\n\n` +
              `📌 أولاً اكتب «طلبات» لرؤية القائمة، ثم:\n` +
              `  طلبات ${isAccept ? "قبول" : "حذف"} [رقم]`
            );
            return;
          }

          await ctx.reply("🔍 جاري جلب القروبات...");
          const entries = await fetchPendingGroups(api, pCtx);

          if (entries.length === 0) {
            await ctx.reply("✅ لا توجد قروبات معلقة.");
            return;
          }

          const entry = entries[idx - 1];
          if (!entry) {
            await ctx.reply(
              `⚠️ الرقم ${idx} غير موجود.\n` +
              `القروبات المتاحة: 1–${entries.length}`
            );
            return;
          }

          if (isAccept) {
            try {
              await new Promise<void>((res, rej) => {
                api.handleMessageRequest(entry.threadID, true, (err) =>
                  err ? rej(err) : res()
                );
              });
              pCtx.logger.info("RequestsPlugin: accepted.", {
                threadID: entry.threadID, name: entry.name, by: ctx.user.id,
              });
              await ctx.reply(
                `${HEADER}\n\n` +
                `✅ تم القبول والدخول إلى القروب:\n📛 ${entry.name}`
              );
            } catch (err) {
              pCtx.logger.warn("RequestsPlugin: accept failed.", { error: String(err) });
              await ctx.reply(
                `❌ تعذّر القبول.\n` +
                `${err instanceof Error ? err.message : String(err)}`
              );
            }
          } else {
            // Try handleMessageRequest(false) first, fallback to removeUserFromGroup
            let done = false;
            try {
              await new Promise<void>((res, rej) => {
                api.handleMessageRequest(entry.threadID, false, (err) =>
                  err ? rej(err) : res()
                );
              });
              done = true;
            } catch { /* try fallback */ }

            if (!done) {
              try {
                const botId = api.getCurrentUserID();
                await new Promise<void>((res, rej) => {
                  api.removeUserFromGroup(botId, entry.threadID, (err) =>
                    err ? rej(err) : res()
                  );
                });
                done = true;
              } catch { /* ignore */ }
            }

            if (done) {
              pCtx.logger.info("RequestsPlugin: rejected/left.", {
                threadID: entry.threadID, name: entry.name, by: ctx.user.id,
              });
              await ctx.reply(
                `${HEADER}\n\n🗑 تم رفض/حذف القروب:\n📛 ${entry.name}`
              );
            } else {
              await ctx.reply(`❌ تعذّر حذف القروب: ${entry.name}`);
            }
          }
          return;
        }

        // ── Unknown sub-command ───────────────────────────────────────────
        await ctx.reply(
          `⚠️ أمر غير معروف: «${sub}»\n\n` +
          "📌 الأوامر المتاحة:\n" +
          "  طلبات              — عرض القائمة\n" +
          "  طلبات قبول [رقم]  — قبول دخول قروب\n" +
          "  طلبات حذف [رقم]   — رفض/حذف قروب"
        );
      },
    };

    pCtx.registerCommand(cmd);
    pCtx.logger.info(`RequestsPlugin v1.1 enabled. Command "طلبات" registered.`);
  }

  async onDisable(): Promise<void> { this.ctx.logger.info("RequestsPlugin disabled."); }
  async onUnload():  Promise<void> { this.ctx.logger.info("RequestsPlugin unloaded."); }
}

export default new RequestsPlugin();
