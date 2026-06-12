import os from "os";
import { IPlugin, PluginManifest } from "../../types/IPlugin";
import { IPluginContext }          from "../../types/IPluginContext";
import { ICommand }                from "../../../commands/types/ICommand";
import { Context }                 from "../../../context/Context";
import { buildUptimeMessage }      from "../../../ui/BotUI";

// ─── Helpers ───────────────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  const mb = bytes / 1024 / 1024;
  return `${mb.toFixed(1)}`;
}

function getCpuUsage(): Promise<number> {
  return new Promise((resolve) => {
    const start = process.cpuUsage();
    setTimeout(() => {
      const end   = process.cpuUsage(start);
      const total = end.user + end.system;
      const pct   = (total / 1_000_000 / 0.1) * 100;
      resolve(Math.min(Math.round(pct * 10) / 10, 100));
    }, 100);
  });
}

// ─── Command ───────────────────────────────────────────────────────────────

const uptimeCommand: ICommand = {
  name:        "ابتيم",
  aliases:     ["uptime", "stats", "حالة"],
  description: "يعرض معلومات تشغيل البوت الحالية",
  usage:       "ابتيم",
  category:    "system",
  adminOnly:   false,
  hidden:      false,

  async execute(ctx: Context): Promise<void> {
    await ctx.typingOn();

    // Measure ping BEFORE getCpuUsage (which blocks 100ms)
    const pingStart = Date.now();

    // Gather system info
    const uptimeSec  = process.uptime();
    const totalMemMB = (os.totalmem() / 1024 / 1024).toFixed(1);
    const freeMemMB  = (os.freemem() / 1024 / 1024).toFixed(1);
    const usedMemMB  = ((os.totalmem() - os.freemem()) / 1024 / 1024).toFixed(1);
    const cpuCores   = os.cpus().length;
    const nodeVersion = process.version;
    const osType     = os.type();
    const arch       = os.arch();

    // Record latency before the 100ms CPU sampling window
    const latencyMs  = Date.now() - pingStart;

    // CPU usage sample (~100ms)
    const cpuPct = await getCpuUsage();

    const msg = buildUptimeMessage({
      uptimeSec,
      freeMemMB,
      usedMemMB,
      totalMemMB,
      cpuPct,
      cpuCores,
      nodeVersion,
      osType,
      arch,
      latencyMs,
    });

    await ctx.reply(msg);
  },
};

// ─── Plugin ────────────────────────────────────────────────────────────────

class UptimePlugin implements IPlugin {
  readonly manifest: PluginManifest = {
    name:        "uptime",
    version:     "1.0.0",
    description: "يعرض معلومات تشغيل البوت — مدة التشغيل، الرام، المعالج، Node.js، وزمن الاستجابة.",
    author:      "Sixseven-6677",
  };

  private ctx!: IPluginContext;

  async onLoad(ctx: IPluginContext): Promise<void> {
    this.ctx = ctx;
    ctx.logger.info("UptimePlugin loaded.");
  }

  async onEnable(): Promise<void> {
    this.ctx.registerCommand(uptimeCommand);
    this.ctx.logger.info(
      `Command "${uptimeCommand.name}" registered (aliases: ${uptimeCommand.aliases?.join(", ")}).`
    );
  }

  async onDisable(): Promise<void> {
    this.ctx.logger.info("UptimePlugin disabled.");
  }

  async onUnload(): Promise<void> {
    this.ctx.logger.info("UptimePlugin unloaded.");
  }
}

export default new UptimePlugin();
