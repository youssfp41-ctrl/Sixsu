import path                       from "path";
import os                         from "os";
import fs                         from "fs";
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
    msg:       string | FcaSendWithAttachment,
    threadID:  string,
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

const HEADER       = "⸪⟅𝐕̶݈̂͜𝔈̟͢⃟݃།̶𝝬̶۪͛ۡ⸸𝚬̱̩⩨ܵ𝐁᮫͎ܺ݀ࣸ᷼᷍⃢ː𝚶̶݄݈݊𝐓݂ ❈ 🦢";
const COOLDOWN_MS  = 15_000;
const TIMEOUT_MS   = 120_000; // 2 min max download
const cooldowns    = new Map<string, number>();
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

function tryUnsend(api: IFcaMusicApi, messageID: string | undefined | null): void {
  if (!messageID) return;
  try { api.unsendMessage(messageID); } catch { /* best-effort */ }
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`⏱ انتهت مهلة ${label} (${ms / 1000} ثانية)`)), ms)
    ),
  ]);
}

// ─── Plugin ────────────────────────────────────────────────────────────────

class MusicPlugin implements IPlugin {
  readonly manifest: PluginManifest = {
    name:        "music",
    version:     "1.1.0",
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
      category:    "private",
      adminOnly:   false,
      hidden:      false,

      async execute(ctx: Context): Promise<void> {
        await ctx.typingOn();

        // ── Cooldown check ───────────────────────────────────────────────
        const cdKey   = `${ctx.user.id}:${ctx.thread.id}`;
        const lastRun = cooldowns.get(cdKey) ?? 0;
        const wait    = COOLDOWN_MS - (Date.now() - lastRun);
        if (wait > 0) {
          await ctx.reply(`⏳ انتظر ${Math.ceil(wait / 1000)} ثانية.`);
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
            "⚠️ اكتب اسم الأغنية أو رابط يوتيوب.\n\n" +
            "📌 أمثلة:\n" +
            "  اغاني صوت الحرية\n" +
            "  اغاني https://youtu.be/dQw4w9WgXcQ"
          );
          return;
        }

        cooldowns.set(cdKey, Date.now());

        const threadID = ctx.thread.id;

        // Helper: update status message (unsend old, send new)
        let statusMsgId: string | null = null;
        const setStatus = async (text: string): Promise<void> => {
          tryUnsend(api, statusMsgId);
          statusMsgId = null;
          try {
            const info = await sendRaw(api, threadID, text);
            statusMsgId = info.messageID;
          } catch { /* ignore */ }
        };

        await setStatus(`🔍 جاري البحث عن: "${query}"...`);

        try {
          // ── Step 1: Search YouTube ─────────────────────────────────────
          // eslint-disable-next-line @typescript-eslint/no-var-requires
          const ytSearch = require("youtube-search-api") as {
            GetListByKeyword(q: string, pl: boolean, limit: number): Promise<{ items: YtSearchItem[] }>;
            GetVideoDetails(id: string): Promise<{ title?: string }>;
          };

          let videoId: string;
          let title:   string;

          const urlMatch = query.match(YT_URL_REGEX);
          if (urlMatch) {
            videoId = urlMatch[1];
            try {
              const d = await withTimeout(ytSearch.GetVideoDetails(videoId), 15_000, "جلب التفاصيل");
              title = d.title ?? query;
            } catch { title = query; }
          } else {
            const results = await withTimeout(
              ytSearch.GetListByKeyword(query, false, 5),
              15_000, "البحث"
            );
            const videos = (results.items ?? []).filter((v) => v.type === "video");
            if (!videos.length) {
              tryUnsend(api, statusMsgId);
              await ctx.reply(`❌ لم أجد نتائج لـ "${query}"`);
              return;
            }
            videoId = videos[0].id;
            title   = videos[0].title;
          }

          const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;

          // ── Step 2: Download ───────────────────────────────────────────
          await setStatus(`🎵 وجدت: ${title}\n🔄 جاري التحميل...`);

          // eslint-disable-next-line @typescript-eslint/no-var-requires
          const ytdl = require("@distube/ytdl-core") as {
            (url: string, opts: Record<string, unknown>): Readable;
            getInfo(url: string): Promise<{
              formats: Array<{ itag: number; url: string; audioCodec?: string; hasAudio: boolean }>;
            }>;
          };

          // eslint-disable-next-line @typescript-eslint/no-var-requires
          const ffmpegPath: string = require("@ffmpeg-installer/ffmpeg").path;

          const tmpMp3 = path.join(os.tmpdir(), `sixsu_${Date.now()}.mp3`);

          // Download + convert with timeout
          await withTimeout(
            new Promise<void>((resolve, reject) => {
              const audioStream = ytdl(videoUrl, {
                quality:       "highestaudio",
                filter:        "audioonly",
                highWaterMark: 1 << 25,
              });

              audioStream.on("error", (err: Error) => reject(new Error(`ytdl: ${err.message}`)));

              // eslint-disable-next-line @typescript-eslint/no-var-requires
              const ffmpeg = require("fluent-ffmpeg");
              ffmpeg(audioStream)
                .setFfmpegPath(ffmpegPath)
                .toFormat("mp3")
                .audioBitrate(128)
                .on("end", () => resolve())
                .on("error", (err: Error) => reject(new Error(`ffmpeg: ${err.message}`)))
                .save(tmpMp3);
            }),
            TIMEOUT_MS,
            "التحميل والتحويل"
          );

          // ── Step 3: Send audio ─────────────────────────────────────────
          await setStatus(`📤 جاري الإرسال...`);

          if (!fs.existsSync(tmpMp3)) {
            throw new Error("ملف الصوت لم يُنشأ — تحقق من ffmpeg");
          }

          const fileSize = fs.statSync(tmpMp3).size;
          pCtx.logger.info("MusicPlugin: sending audio.", { title, videoId, fileSize, threadId: threadID });

          tryUnsend(api, statusMsgId);
          statusMsgId = null;

          await sendRaw(api, threadID, {
            body:       `${HEADER}\n\n🎵 ${title}`,
            attachment: fs.createReadStream(tmpMp3),
          });

          try { fs.unlinkSync(tmpMp3); } catch { /* ignore */ }
          pCtx.logger.info("MusicPlugin: done.", { title, threadId: threadID });

        } catch (err) {
          // Clean up status message
          tryUnsend(api, statusMsgId);
          statusMsgId = null;

          const msg = err instanceof Error ? err.message : String(err);
          pCtx.logger.warn("MusicPlugin: failed.", { error: msg, threadId: threadID });

          await ctx.reply(
            `${HEADER}\n\n` +
            `❌ تعذّر تحميل الأغنية:\n${msg}\n\n` +
            `💡 تأكد أن البوت يملك الـ dependencies (npm install)`
          );

          // Cleanup temp file if exists
          try {
            const tmpMp3 = path.join(os.tmpdir(), `sixsu_${Date.now()}.mp3`);
            if (fs.existsSync(tmpMp3)) fs.unlinkSync(tmpMp3);
          } catch { /* ignore */ }
        }
      },
    };

    pCtx.registerCommand(cmd);
    pCtx.logger.info(`MusicPlugin v1.1 enabled. Command "اغاني" registered.`);
  }

  async onDisable(): Promise<void> { this.ctx.logger.info("MusicPlugin disabled."); }
  async onUnload():  Promise<void> { this.ctx.logger.info("MusicPlugin unloaded."); }
}

export default new MusicPlugin();
