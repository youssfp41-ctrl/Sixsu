import { IPlugin, PluginManifest } from "../../types/IPlugin";
import { IPluginContext }          from "../../types/IPluginContext";
import { ICommand }                from "../../../commands/types/ICommand";
import { Context }                 from "../../../context/Context";

// ─── Extended FCA types ────────────────────────────────────────────────────

interface PendingThread {
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
    callback:  (err: Error | null, list: PendingThread[]) => void,
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

function safeGetList(api: IFcaRequestsApi, tag: string): Promise<PendingThread[]> {
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

async function fetchPendingGroups(api: IFcaRequestsApi): Promise<PendingEntry[]> {
  const [pendingList, spamList] = await Promise.all([
    safeGetList(api, "PENDING"),
    safeGetList(api, "SPAM"),
  ]);

  const seen    = new Set<string>();
  const entries: PendingEntry[] = [];

  for (const t of pendingList) {
    if (!t.isGroup || !t.threadID || seen.has(t.threadID)) continue;
    seen.add(t.threadID);
    entries.push({
      threadID: t.threadID,
      name:     (t.name ?? t.threadName ?? "بدون اسم").trim(),
      folder:   "PENDING",
    });
  }

  for (const t of spamList) {
    if (!t.isGroup || !t.threadID || seen.has(t.threadID)) continue;
    seen.add(t.threadID);
    entries.push({
      threadID: t.threadID,
      name:     (t.name ?? t.threadName ?? "بدون اسم").trim(),
      folder:   "SPAM",
    });
  }

  return entries;
}

function buildListMessage(entries: PendingEntry[]): string {
  if (entries.length === 0) {
    return `${HEADER}\n\n✅ لا توجد قروبات معلقة أو سبام.`;
  }

  const pending = entries.filter((e) => e.folder === "PENDING");
  const spam    = entries.filter((e) => e.folder === "SPAM");
  const lines: string[] = [HEADER, "", "📋 القروبات المعلقة:", ""];

  if (pending.length > 0) {
    lines.push(`📥 الانتظار (${pending.length}):`);
    for (const e of pending) {
      const n = entries.indexOf(e) + 1;
      lines.push(`  ${n}. ${e.name}`);
      lines.push(`     🔑 ${e.threadID}`);
      lines.push("");
    }
  }

  if (spam.length > 0) {
    lines.push(`⚠️ السبام (${spam.length}):`);
    for (const e of spam) {
      const n = entries.indexOf(e) + 1;
      lines.push(`  ${n}. ${e.name}`);
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
    version:     "1.0.0",
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

        // ── List ────────────────────────────────────────────────────────
        if (!sub || sub === "قائمة" || sub === "list") {
          await ctx.reply("🔍 جاري جلب الطلبات...");
          const entries = await fetchPendingGroups(api);
          await ctx.reply(buildListMessage(entries));
          return;
        }

        // ── Accept / Delete ─────────────────────────────────────────────
        const isAccept =
          sub === "قبول"  || sub === "accept" || sub === "دخول";
        const isDelete  =
          sub === "حذف"   || sub === "delete" || sub === "رفض" || sub === "reject";

        if (isAccept || isDelete) {
          const idxArg = ctx.getArg(1);
          const idx    = idxArg ? parseInt(idxArg, 10) : NaN;

          if (isNaN(idx) || idx < 1) {
            await ctx.reply(
              `⚠️ الرجاء تحديد رقم القروب.\n\n` +
              `📌 أولاً اكتب «طلبات» لرؤية القائمة، ثم:\n` +
              `  طلبات ${isAccept ? "قبول" : "حذف"} [رقم]`
            );
            return;
          }

          await ctx.reply("🔍 جاري جلب الطلبات...");
          const entries = await fetchPendingGroups(api);

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
              pCtx.logger.info("RequestsPlugin: accepted.", { threadID: entry.threadID, name: entry.name, by: ctx.user.id });
              await ctx.reply(`${HEADER}\n\n✅ تم القبول والدخول إلى القروب:\n📛 ${entry.name}`);
            } catch (err) {
              pCtx.logger.warn("RequestsPlugin: accept failed.", { error: String(err) });
              await ctx.reply(`❌ تعذّر القبول.\n${err instanceof Error ? err.message : String(err)}`);
            }
          } else {
            // Try handleMessageRequest(false) first, fallback to removeUserFromGroup
            try {
              await new Promise<void>((res, rej) => {
                api.handleMessageRequest(entry.threadID, false, (err) =>
                  err ? rej(err) : res()
                );
              });
              pCtx.logger.info("RequestsPlugin: rejected.", { threadID: entry.threadID, name: entry.name, by: ctx.user.id });
              await ctx.reply(`${HEADER}\n\n🗑 تم رفض وحذف القروب:\n📛 ${entry.name}`);
            } catch {
              try {
                const botId = api.getCurrentUserID();
                await new Promise<void>((res, rej) => {
                  api.removeUserFromGroup(botId, entry.threadID, (err) =>
                    err ? rej(err) : res()
                  );
                });
                await ctx.reply(`${HEADER}\n\n🗑 تم مغادرة القروب:\n📛 ${entry.name}`);
              } catch (err2) {
                await ctx.reply(`❌ تعذّر الحذف.\n${err2 instanceof Error ? err2.message : String(err2)}`);
              }
            }
          }
          return;
        }

        // ── Unknown sub-command ─────────────────────────────────────────
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
    pCtx.logger.info(`RequestsPlugin enabled. Command "طلبات" registered.`);
  }

  async onDisable(): Promise<void> { this.ctx.logger.info("RequestsPlugin disabled."); }
  async onUnload():  Promise<void> { this.ctx.logger.info("RequestsPlugin unloaded."); }
}

export default new RequestsPlugin();
