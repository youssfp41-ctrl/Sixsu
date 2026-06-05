import os from "os";
import { IPlugin, PluginManifest } from "../../types/IPlugin";
import { IPluginContext } from "../../types/IPluginContext";
import { ICommand } from "../../../commands/types/ICommand";
import { Context } from "../../../context/Context";

// ─── Helpers ───────────────────────────────────────────────────────────────

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);

  const parts: string[] = [];
  if (d > 0) parts.push(`${d}ي`);
  if (h > 0) parts.push(`${h}س`);
  if (m > 0) parts.push(`${m}د`);
  parts.push(`${s}ث`);

  return parts.join(" ");
}

function formatBytes(bytes: number): string {
  const mb = bytes / 1024 / 1024;
  return `${mb.toFixed(1)} MB`;
}

function getCpuUsage(): Promise<number> {
  return new Promise((resolve) => {
    const start = process.cpuUsage();
    setTimeout(() => {
      const end = process.cpuUsage(start);
      const total = end.user + end.system;
      // Convert microseconds to percentage over 100ms window
      const pct = (total / 1_000_000 / 0.1) * 100;
      resolve(Math.min(Math.round(pct * 10) / 10, 100));
    }, 100);
  });
}

// ─── Command ───────────────────────────────────────────────────────────────

const uptimeCommand: ICommand = {
  name: "ابتيم",
  aliases: ["uptime", "stats", "حالة"],
  description: "يعرض معلومات تشغيل البوت الحالية",
  usage: "ابتيم",
  category: "util",
  adminOnly: false,
  hidden: false,

  async execute(ctx: Context): Promise<void> {
    await ctx.typingOn();

    // Measure ping BEFORE getCpuUsage (which blocks 100ms)
    const pingStart = Date.now();

    // Gather system info
    const uptimeSec   = process.uptime();
    const memUsage    = process.memoryUsage();
    const totalMemMB  = (os.totalmem() / 1024 / 1024).toFixed(1);
    const freeMemMB   = (os.freemem() / 1024 / 1024).toFixed(1);
    const usedMemMB   = ((os.totalmem() - os.freemem()) / 1024 / 1024).toFixed(1);
    const cpuCores    = os.cpus().length;
    const cpuModel    = os.cpus()[0]?.model?.trim() ?? "Unknown";
    const nodeVersion = process.version;
    const platform    = `${os.type()} ${os.release()}`;

    // Record ping before the CPU sampling delay
    const ping = Date.now() - pingStart;

    // CPU usage sample (takes ~100ms internally — measured separately)
    const cpuPct = await getCpuUsage();

    const rss      = formatBytes(memUsage.rss);
    const heapUsed = formatBytes(memUsage.heapUsed);
    const heapTotal = formatBytes(memUsage.heapTotal);

    const msg = [
      "⌯𝐕̸̶ֽׁ݊͐͢𝚵̶̱̩֗̀𝚾̣҉̶𝕰̶̟̀𝐋͜ 🪽↴",
      "",
      `⌯ مدة التشغيل: ${formatUptime(uptimeSec)}`,
      `⌯ الرام (البوت): ${rss}`,
      `⌯ Heap: ${heapUsed} / ${heapTotal}`,
      `⌯ رام النظام: ${usedMemMB} / ${totalMemMB} MB (متاح: ${freeMemMB} MB)`,
      `⌯ المعالج: ${cpuPct}%`,
      `⌯ الأنوية: ${cpuCores} (${cpuModel})`,
      `⌯ Node.js: ${nodeVersion}`,
      `⌯ النظام: ${platform}`,
      `⌯ الاستجابة: ${ping}ms`,
    ].join("\n");

    await ctx.reply(msg);
  },
};

// ─── Plugin ────────────────────────────────────────────────────────────────

class UptimePlugin implements IPlugin {
  readonly manifest: PluginManifest = {
    name: "uptime",
    version: "1.0.0",
    description: "يعرض معلومات تشغيل البوت — مدة التشغيل، الرام، المعالج، Node.js، وزمن الاستجابة.",
    author: "Sixseven-6677",
  };

  private ctx!: IPluginContext;

  async onLoad(ctx: IPluginContext): Promise<void> {
    this.ctx = ctx;
    ctx.logger.info("UptimePlugin loaded.");
  }

  async onEnable(): Promise<void> {
    this.ctx.registerCommand(uptimeCommand);
    this.ctx.logger.info(`Command "${uptimeCommand.name}" registered (aliases: ${uptimeCommand.aliases?.join(", ")}).`);
  }

  async onDisable(): Promise<void> {
    this.ctx.logger.info("UptimePlugin disabled.");
  }

  async onUnload(): Promise<void> {
    this.ctx.logger.info("UptimePlugin unloaded.");
  }
}

export default new UptimePlugin();