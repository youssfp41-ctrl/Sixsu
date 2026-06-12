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
  participants?: Array<{ userID?: string }>;
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
  folder:   string;
}

// ─── Constants ─────────────────────────────────────────────────────────────

const HEADER = "⸪⟅𝐕̶݈̂͜𝔈̟͢⃟݃།̶𝝬̶۪͛ۡ⸸𝚬̱̩⩨ܵ𝐁᮫͎ܺ݀ࣸ᷼᷍⃢ː𝚶̶݄݈݊𝐓݂ ❈ 🦢";

// ALL known FCA tags that may contain pending/spam group invites
const FETCH_TAGS = ["PENDING", "SPAM", "OTHER", "ARCHIVED", "INBOX"];

function getApi(pCtx: IPluginContext): IFcaRequestsApi | null {
  return (
    pCtx.consumeService<IMiraiRequests>("mirai-transport")?.getApi?.() ??
    pCtx.consumeService<IMiraiRequests>("mirai-transport-secondary")?.getApi?.() ??
    null
  );
}

interface TagResult { tag: string; list: RawThread[]; err: string | null; }

function fetchTag(api: IFcaRequestsApi, tag: string): Promise<TagResult> {
  return new Promise((resolve) => {
    const timer = setTimeout(
      () => resolve({ tag, list: [], err: "timeout" }),
      14_000,
    );
    try {
      api.getThreadList(50, null, [tag], (err, list) => {
        clearTimeout(timer);
        resolve({
          tag,
          list: Array.isArray(list) ? list : [],
          err:  err ? String(err) : null,
        });
      });
    } catch (e) {
      clearTimeout(timer);
      resolve({ tag, list: [], err: String(e) });
    }
  });
}

function threadName(t: RawThread): string {
  return (t.name ?? t.threadName ?? "بدون اسم").trim();
}

/**
 * Fetch ALL non-INBOX threads from every known tag and
 * combine them by de-duplicating on threadID.
 *
 * Folder label priority:
 *   explicit folder field > tag name
 *
 * Treats anything NOT in INBOX as a pending/request thread,
 * regardless of whether it is a group or DM.
 */
async function fetchAllPending(
  api:  IFcaRequestsApi,
  pCtx: IPluginContext,
): Promise<{ entries: PendingEntry[]; diagnostics: string }> {
  const results = await Promise.all(FETCH_TAGS.map((t) => fetchTag(api, t)));

  // Build diagnostics line
  const diagParts = results.map((r) => {
    const lbl = r.err === "timeout" ? "⏱" : r.err ? "✗" : `${r.list.length}`;
    return `${r.tag}:${lbl}`;
  });
  const diagnostics = diagParts.join("  ");

  pCtx.logger.info("RequestsPlugin: tag fetch results.", {
    summary: diagnostics,
  });

  // Separate INBOX threads (used only as fallback source for folder labels)
  const inboxResult  = results.find((r) => r.tag === "INBOX");
  const inboxThreads = inboxResult?.list ?? [];

  // All non-INBOX tags
  const nonInboxResults = results.filter((r) => r.tag !== "INBOX");

  const seen    = new Set<string>();
  const entries: PendingEntry[] = [];

  // 1. Add threads from dedicated tags (PENDING, SPAM, OTHER, ARCHIVED)
  for (const res of nonInboxResults) {
    for (const t of res.list) {
      if (!t.threadID || seen.has(t.threadID)) continue;
      seen.add(t.threadID);
      const folderLabel = t.folder ?? res.tag;
      entries.push({ threadID: t.threadID, name: threadName(t), folder: folderLabel });
    }
  }

  // 2. Cross-reference INBOX: pick up any thread whose folder != INBOX
  for (const t of inboxThreads) {
    if (!t.threadID || seen.has(t.threadID)) continue;
    const folderLabel = t.folder;
    if (!folderLabel || folderLabel === "INBOX") continue; // skip normal inbox
    seen.add(t.threadID);
    entries.push({ threadID: t.threadID, name: threadName(t), folder: folderLabel });
  }

  return { entries, diagnostics };
}

function folderEmoji(folder: string): string {
  const f = folder.toUpperCase();
  if (f === "PENDING") return "📥";
  if (f === "SPAM")    return "⚠️";
  if (f === "OTHER")   return "📂";
  if (f === "ARCHIVED") return "🗃";
  return "📌";
}

function buildListMessage(entries: PendingEntry[], diagnostics: string): string {
  const diagLine = `⌯ [API: ${diagnostics}]`;

  if (entries.length === 0) {
    return (
      `${HEADER}\n\n` +
      "✅ لا توجد قروبات أو رسائل معلقة.\n\n" +
      diagLine + "\n\n" +
      "💡 إذا رأيت قروباً في ماسنجر ضمن «طلبات المراسلة»\n" +
      "   وهو لا يظهر هنا، جرّب «طلبات فحص [ID]» لإرساله يدوياً.\n" +
      "   أو افتح ماسنجر واقبل الطلب يدوياً ثم استخدم الأوامر."
    );
  }

  const lines: string[] = [HEADER, "", `📋 الطلبات المعلقة (${entries.length}):`, "", diagLine, ""];

  // Group by folder
  const byFolder = new Map<string, PendingEntry[]>();
  for (const e of entries) {
    const arr = byFolder.get(e.folder) ?? [];
    arr.push(e);
    byFolder.set(e.folder, arr);
  }

  let idx = 1;
  for (const [folder, folderEntries] of byFolder) {
    lines.push(`${folderEmoji(folder)} ${folder} (${folderEntries.length}):`);
    for (const e of folderEntries) {
      lines.push(`  ${idx}. ${e.name}`);
      lines.push(`     🔑 ${e.threadID}`);
      lines.push("");
      idx++;
    }
  }

  lines.push("─────────────────────────────");
  lines.push("⌯ الأوامر:");
  lines.push("  طلبات قبول [رقم]    — قبول/دخول ✅");
  lines.push("  طلبات حذف [رقم]     — رفض/حذف 🗑");
  lines.push("  طلبات فحص [threadID] — قبول بمعرّف مباشر");

  return lines.join("\n");
}

// ─── Plugin ────────────────────────────────────────────────────────────────

class RequestsPlugin implements IPlugin {
  readonly manifest: PluginManifest = {
    name:        "requests",
    version:     "1.2.0",
    description: "عرض وإدارة القروبات المعلقة من كل مجلدات Messenger.",
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
      description: "عرض القروبات المعلقة من كل المجلدات مع إمكانية القبول أو الرفض",
      usage:       "طلبات | طلبات قبول [رقم] | طلبات حذف [رقم] | طلبات فحص [ID]",
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
          await ctx.reply("🔍 جاري فحص كل مجلدات الطلبات...");
          const { entries, diagnostics } = await fetchAllPending(api, pCtx);
          await ctx.reply(buildListMessage(entries, diagnostics));
          return;
        }

        // ── Direct ID accept (طلبات فحص [threadID]) ──────────────────────
        if (sub === "فحص" || sub === "direct" || sub === "id") {
          const rawId = ctx.getArg(1)?.trim();
          if (!rawId) {
            await ctx.reply("📌 مثال: طلبات فحص 100123456789012345");
            return;
          }
          try {
            await new Promise<void>((res, rej) => {
              api.handleMessageRequest(rawId, true, (err) => (err ? rej(err) : res()));
            });
            pCtx.logger.info("RequestsPlugin: direct accept.", { threadID: rawId, by: ctx.user.id });
            await ctx.reply(`${HEADER}\n\n✅ تم قبول الطلب للمعرّف:\n🔑 ${rawId}`);
          } catch (err) {
            // Fallback: try joining as removeUserFromGroup inverse
            await ctx.reply(
              `❌ تعذّر القبول المباشر.\n` +
              `${err instanceof Error ? err.message : String(err)}\n\n` +
              `💡 جرّب قبوله يدوياً من الماسنجر.`
            );
          }
          return;
        }

        // ── Accept / Delete ───────────────────────────────────────────────
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

          await ctx.reply("🔍 جاري جلب الطلبات...");
          const { entries } = await fetchAllPending(api, pCtx);

          if (entries.length === 0) {
            await ctx.reply("✅ لا توجد طلبات معلقة.");
            return;
          }

          const entry = entries[idx - 1];
          if (!entry) {
            await ctx.reply(`⚠️ الرقم ${idx} غير موجود. الطلبات المتاحة: 1–${entries.length}`);
            return;
          }

          if (isAccept) {
            try {
              await new Promise<void>((res, rej) => {
                api.handleMessageRequest(entry.threadID, true, (err) => (err ? rej(err) : res()));
              });
              pCtx.logger.info("RequestsPlugin: accepted.", { threadID: entry.threadID, name: entry.name, by: ctx.user.id });
              await ctx.reply(`${HEADER}\n\n✅ تم القبول والدخول إلى:\n📛 ${entry.name}`);
            } catch (err) {
              pCtx.logger.warn("RequestsPlugin: accept failed.", { error: String(err) });
              await ctx.reply(`❌ تعذّر القبول.\n${err instanceof Error ? err.message : String(err)}`);
            }
          } else {
            let done = false;
            try {
              await new Promise<void>((res, rej) => {
                api.handleMessageRequest(entry.threadID, false, (err) => (err ? rej(err) : res()));
              });
              done = true;
            } catch { /* fallback */ }

            if (!done) {
              try {
                const botId = api.getCurrentUserID();
                await new Promise<void>((res, rej) => {
                  api.removeUserFromGroup(botId, entry.threadID, (err) => (err ? rej(err) : res()));
                });
                done = true;
              } catch { /* ignore */ }
            }

            if (done) {
              pCtx.logger.info("RequestsPlugin: rejected.", { threadID: entry.threadID, name: entry.name, by: ctx.user.id });
              await ctx.reply(`${HEADER}\n\n🗑 تم رفض/حذف:\n📛 ${entry.name}`);
            } else {
              await ctx.reply(`❌ تعذّر الحذف: ${entry.name}`);
            }
          }
          return;
        }

        // ── Unknown ───────────────────────────────────────────────────────
        await ctx.reply(
          `⚠️ أمر غير معروف: «${sub}»\n\n` +
          "📌 الأوامر:\n" +
          "  طلبات                 — عرض القائمة\n" +
          "  طلبات قبول [رقم]     — قبول\n" +
          "  طلبات حذف [رقم]      — رفض\n" +
          "  طلبات فحص [threadID] — قبول بمعرّف مباشر"
        );
      },
    };

    pCtx.registerCommand(cmd);
    pCtx.logger.info(`RequestsPlugin v1.2 enabled. Command "طلبات" registered.`);
  }

  async onDisable(): Promise<void> { this.ctx.logger.info("RequestsPlugin disabled."); }
  async onUnload():  Promise<void> { this.ctx.logger.info("RequestsPlugin unloaded."); }
}

export default new RequestsPlugin();
