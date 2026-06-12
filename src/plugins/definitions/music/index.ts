import path                      from "path";
import os                        from "os";
import fs                        from "fs";
import type { Readable }          from "stream";
import { IPlugin, PluginManifest } from "../../types/IPlugin";
import { IPluginContext }          from "../../types/IPluginContext";
import { ICommand }                from "../../../commands/types/ICommand";
import { Context }                 from "../../../context/Context";

// ─── Extended FCA types (supports attachment messages) ─────────────────────

interface FcaSendWithAttachment {
  body:        string;
  attachment?: Readable;
}

interface IFcaMusicApi {
  getCurrentUserID(): string;
  sendMessage(
    msg:      string | FcaSendWithAttachment,
    threadID: string,
    callback?: (err: Error | null, info: unknown) => void,
  ): void;
  unsendMessage(
    messageID: string,
    callback?: (err: Error | null) => void,
  ): void;
}

interface IMiraiMusic { getApi(): IFcaMusicApi | null; }

interface YtSearchItem {
  id:    string;
  title: string;
  type:  string;
}

// ─── Constants ─────────────────────────────────────────────────────────────

const HEADER      = "⸪⟅𝐕̶݈̂͜𝔈̟͢⃟݃།̶𝝬̶۪͛ۡ⸸𝚬̱̩⩨ܵ𝐁᮫͎ܺ݀ࣸ᷼᷍⃢ː𝚶̶݄݈݊𝐓݂ ❈ 🦢";
const COOLDOWN_MS = 15_000;
const cooldowns   = new Map<string, number>();

const YT_URL_REGEX = /(?:youtube\.com\/watch\?v=|youtu\.be\/)([A-Za-z0-9_-]{11})/;

// ─── Helpers ───────────────────────────────────────────────────────────────

function getApi(pCtx: IPluginContext): IFcaMusicApi | null {
  return (
    pCtx.consumeService<IMiraiMusic>("mirai-transport")?.getApi?.() ??
    pCtx.consumeService<IMiraiMusic>("mirai-transport-secondary")?.getApi?.() ??
    null
  );
}

function sendRaw(
  api:      IFcaMusicApi,
  threadID: string,
  msg:      string | FcaSendWithAttachment,
): Promise<{ messageID: string }> {
  return new Promise((resolve, reject) => {
    api.sendMessage(msg, threadID, (err, info) => {
      if (err) reject(err);
      else     resolve(info as { messageID: string });
    });
  });
}

function tryUnsend(api: IFcaMusicApi, messageID: string): void {
  try { api.unsendMessage(messageID); } catch { /* best-effort */ }
}

// ─── Plugin ────────────────────────────────────────────────────────────────

class MusicPlugin implements IPlugin {
  readonly manifest: PluginManifest = {
    name:        "music",
    version:     "1.0.0",
    description: "تحميل وإرسال الأغاني من يوتيوب.",
    author:      "Sixseven-6677",
  };

  private ctx!: IPluginContext;

  async onLoad(ctx: IPluginContext): Promise<void> {
    this.ctx = ctx;
    ctx.logger.info("MusicPlugin loaded.");
  }

  async onEnable(): Promise<void> {
    const pCtx = this.ctx;

    const cmd: ICommand = {
      name:        "اغاني",
      aliases:     ["ytb", "music", "يوتيوب", "أغاني", "اغنية"],
      description: "تحميل اغنية من يوتيوب وإرسالها كملف صوتي",
      usage:       "اغاني [اسم الاغنية أو رابط يوتيوب]",
      category:    "general",
      adminOnly:   false,
      hidden:      false,

      async execute(ctx: Context): Promise<void> {
        await ctx.typingOn();

        // ── Cooldown ────────────────────────────────────────────────────
        const cdKey   = `${ctx.user.id}:${ctx.thread.id}`;
        const lastRun = cooldowns.get(cdKey) ?? 0;
        const wait    = COOLDOWN_MS - (Date.now() - lastRun);
        if (wait > 0) {
          await ctx.reply(`⏳ انتظر ${Math.ceil(wait / 1000)} ثانية قبل الاستخدام مجدداً.`);
          return;
        }

        const api = getApi(pCtx);
        if (!api) {
          await ctx.reply("⚠️ خدمة Facebook غير متاحة حالياً.");
          return;
        }

        const query = ctx.getRemainingText(0).trim();
        if (!query) {
          await ctx.reply(
            `${HEADER}\n\n` +
            "⚠️ اكتب اسم الاغنية أو رابط يوتيوب.\n\n" +
            "📌 أمثلة:\n" +
            "  اغاني صوت الحرية\n" +
            "  اغاني https://youtu.be/dQw4w9WgXcQ"
          );
          return;
        }

        cooldowns.set(cdKey, Date.now());

        const threadID = ctx.thread.id;
        let waitInfo: { messageID: string } | null = null;

        try {
          waitInfo = await sendRaw(api, threadID, `🔍 جاري البحث عن: "${query}"...`);
        } catch { /* ignore */ }

        try {
          // ── Resolve video ID and title ─────────────────────────────────
          // eslint-disable-next-line @typescript-eslint/no-var-requires
          const ytSearch = require("youtube-search-api") as {
            GetListByKeyword(q: string, playlist: boolean, limit: number): Promise<{ items: YtSearchItem[] }>;
            GetVideoDetails(id: string): Promise<{ title?: string }>;
          };

          let videoId: string;
          let title:   string;

          const urlMatch = query.match(YT_URL_REGEX);
          if (urlMatch) {
            videoId = urlMatch[1];
            try {
              const details = await ytSearch.GetVideoDetails(videoId);
              title = details.title ?? query;
            } catch {
              title = query;
            }
          } else {
            const results = await ytSearch.GetListByKeyword(query, false, 5);
            const videos  = (results.items ?? []).filter((v) => v.type === "video");
            if (!videos.length) {
              if (waitInfo) tryUnsend(api, waitInfo.messageID);
              await ctx.reply(`❌ لم أجد نتائج لـ "${query}"`);
              return;
            }
            videoId = videos[0].id;
            title   = videos[0].title;
          }

          const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
          if (waitInfo) tryUnsend(api, waitInfo.messageID);
          waitInfo = null;

          let loadInfo: { messageID: string } | null = null;
          try {
            loadInfo = await sendRaw(api, threadID, `🎵 وجدت: ${title}\n🔄 جاري التحميل...`);
          } catch { /* ignore */ }

          // ── Download audio via ytdl ────────────────────────────────────
          // eslint-disable-next-line @typescript-eslint/no-var-requires
          const ytdl = require("@distube/ytdl-core") as {
            (url: string, opts: Record<string, unknown>): Readable;
          };

          // eslint-disable-next-line @typescript-eslint/no-var-requires
          const ffmpegStatic: string = require("@ffmpeg-installer/ffmpeg").path;

          const tmpMp3 = path.join(os.tmpdir(), `sixsu_${Date.now()}.mp3`);

          const audioStream = ytdl(videoUrl, {
            quality:       "highestaudio",
            filter:        "audioonly",
            highWaterMark: 1 << 25,
          });

          await new Promise<void>((resolve, reject) => {
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            const ffmpeg = require("fluent-ffmpeg");
            ffmpeg(audioStream)
              .setFfmpegPath(ffmpegStatic)
              .toFormat("mp3")
              .on("end", () => resolve())
              .on("error", (err: Error) => reject(err))
              .save(tmpMp3);
          });

          if (loadInfo) tryUnsend(api, loadInfo.messageID);

          await sendRaw(api, threadID, {
            body:       `${HEADER}\n\n🎵 ${title}`,
            attachment: fs.createReadStream(tmpMp3),
          });

          pCtx.logger.info("MusicPlugin: audio sent.", { title, videoId, threadId: threadID });

          try { fs.unlinkSync(tmpMp3); } catch { /* ignore */ }

        } catch (err) {
          if (waitInfo) tryUnsend(api, waitInfo.messageID);
          pCtx.logger.warn("MusicPlugin: download failed.", { error: String(err) });
          await ctx.reply(
            `❌ تعذّر تحميل الأغنية.\n` +
            `${err instanceof Error ? err.message : String(err)}`
          );
        }
      },
    };

    pCtx.registerCommand(cmd);
    pCtx.logger.info(`MusicPlugin enabled. Command "اغاني" registered.`);
  }

  async onDisable(): Promise<void> { this.ctx.logger.info("MusicPlugin disabled."); }
  async onUnload():  Promise<void> { this.ctx.logger.info("MusicPlugin unloaded."); }
}

export default new MusicPlugin();
