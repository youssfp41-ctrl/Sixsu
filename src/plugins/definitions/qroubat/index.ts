import { IPlugin, PluginManifest } from "../../types/IPlugin";
import { IPluginContext }          from "../../types/IPluginContext";
import { ICommand }                from "../../../commands/types/ICommand";
import { Context }                 from "../../../context/Context";

// ─── FCA types ────────────────────────────────────────────────────────────────

interface QroubatThread {
  threadID:       string;
  name?:          string;
  isGroup:        boolean;
  participantIDs: string[];
  unreadCount?:   number;
  messageCount?:  number;
}

interface IFcaQroubat {
  getCurrentUserID(): string;
  getThreadList(
    limit:     number,
    timestamp: number | null,
    tags:      string[],
    callback:  (err: Error | null, list: QroubatThread[]) => void,
  ): void;
}

interface IMiraiQroubat {
  getApi(): IFcaQroubat | null;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const HEADER = "⌯𝐕̸̶ֽׁ݊͐͢𝚵̶̱̩֗̀𝚾̣҉̶𝕰̶̟̀𝐋͜ 𝐐𝐑𝐎𝐔𝐁𝐀𝐓🪽↴";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getApi(pCtx: IPluginContext): IFcaQroubat | null {
  return pCtx.consumeService<IMiraiQroubat>("mirai-transport")?.getApi?.() ?? null;
}

function fetchThreadList(api: IFcaQroubat, limit: number): Promise<QroubatThread[]> {
  return new Promise((resolve, reject) => {
    api.getThreadList(limit, null, ["INBOX"], (err, list) => {
      if (err) reject(err);
      else     resolve(list ?? []);
    });
  });
}

// ─── Plugin ───────────────────────────────────────────────────────────────────

class QroubatPlugin implements IPlugin {
  readonly manifest: PluginManifest = {
    name:        "qroubat",
    version:     "1.0.0",
    description: "عرض قائمة القروبات التي البوت فيها.",
    author:      "Sixseven-6677",
  };

  private ctx!: IPluginContext;

  async onLoad(ctx: IPluginContext): Promise<void> {
    this.ctx = ctx;
    ctx.logger.info("QroubatPlugin loaded.");
  }

  async onEnable(): Promise<void> {
    const pCtx = this.ctx;

    const qroubatCommand: ICommand = {
      name:        "قروبات",
      aliases:     ["groups", "threads", "qroubat"],
      description: "عرض قائمة القروبات",
      usage:       "قروبات",
      category:    "util",
      adminOnly:   false,
      hidden:      false,

      async execute(ctx: Context): Promise<void> {
        await ctx.typingOn();

        const api = getApi(pCtx);
        if (!api) {
          await ctx.reply("⚠️ خدمة Facebook غير متاحة حالياً.");
          return;
        }

        let threads: QroubatThread[];
        try {
          threads = await fetchThreadList(api, 50);
        } catch (err) {
          pCtx.logger.warn("QroubatPlugin: getThreadList failed.", { error: String(err) });
          await ctx.reply("⚠️ تعذّر جلب قائمة القروبات.");
          return;
        }

        const groups = threads.filter((t) => t.isGroup);

        if (groups.length === 0) {
          await ctx.reply([
            HEADER,
            "",
            "⌯ البوت ليس في أي قروب حالياً.",
          ].join("\n"));
          return;
        }

        const lines = groups.slice(0, 20).map((g, i) => {
          const name    = g.name || "قروب بدون اسم";
          const members = g.participantIDs?.length ?? 0;
          return `  ${i + 1}. ${name} (${members} عضو)`;
        });

        const extra = groups.length > 20 ? `\n⌯ وأكثر... (${groups.length - 20} قروب إضافي)` : "";

        await ctx.reply([
          HEADER,
          "",
          `⌯ إجمالي القروبات: ${groups.length}`,
          "",
          "⌯ القروبات:",
          ...lines,
          extra,
        ].filter(Boolean).join("\n"));

        pCtx.logger.info("QroubatPlugin: groups listed.", {
          threadID: ctx.thread.id,
          userID:   ctx.user.id,
          total:    groups.length,
        });
      },
    };

    pCtx.registerCommand(qroubatCommand);
    pCtx.logger.info(
      `Command "${qroubatCommand.name}" registered (aliases: ${qroubatCommand.aliases?.join(", ")}).`
    );
  }

  async onDisable(): Promise<void> {
    this.ctx.logger.info("QroubatPlugin disabled.");
  }

  async onUnload(): Promise<void> {
    this.ctx.logger.info("QroubatPlugin unloaded.");
  }
}

export default new QroubatPlugin();
