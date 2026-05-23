import os from "os";
import { ICommand }          from "../../../../commands/types/ICommand";
import { IPluginContext }     from "../../../types/IPluginContext";
import {
  IResponseBuilder,
  SERVICES,
} from "../services/IUtilityServices";

function fmtBytes(bytes: number): string {
  if (bytes >= 1_073_741_824) return `${(bytes / 1_073_741_824).toFixed(2)} GB`;
  if (bytes >= 1_048_576)     return `${(bytes / 1_048_576).toFixed(1)} MB`;
  return `${(bytes / 1_024).toFixed(0)} KB`;
}

function fmtUptime(totalSeconds: number): string {
  const d = Math.floor(totalSeconds / 86_400);
  const h = Math.floor((totalSeconds % 86_400) / 3_600);
  const m = Math.floor((totalSeconds % 3_600) / 60);
  const s = Math.floor(totalSeconds % 60);
  return [
    d > 0 ? `${d}d` : "",
    h > 0 ? `${h}h` : "",
    m > 0 ? `${m}m` : "",
    `${s}s`,
  ].filter(Boolean).join(" ");
}

/**
 * /uptime — process uptime, memory, CPU, Node version.
 * More readable than /status — focused on runtime health.
 */
export function createUptimeCommand(pluginCtx: IPluginContext): ICommand {
  return {
    name:        "uptime",
    aliases:     ["up"],
    description: "يعرض مدة التشغيل واستخدام الذاكرة والـ CPU",
    usage:       "/uptime",
    category:    "utility",

    async execute(ctx) {
      const fmt = pluginCtx.consumeService<IResponseBuilder>(SERVICES.RESPONSE_BUILDER);

      const mem      = process.memoryUsage();
      const uptimeSec = process.uptime();
      const freeMem  = os.freemem();
      const totalMem = os.totalmem();
      const usedMem  = totalMem - freeMem;
      const cpuLoad  = os.loadavg()[0].toFixed(2);
      const cpuCount = os.cpus().length;

      // Heap usage percentage
      const heapPct = ((mem.heapUsed / mem.heapTotal) * 100).toFixed(0);

      const lines = [
        `⏱️  Uptime:       ${fmtUptime(uptimeSec)}`,
        ``,
        `💾  Heap:         ${fmtBytes(mem.heapUsed)} / ${fmtBytes(mem.heapTotal)} (${heapPct}%)`,
        `📦  RSS:          ${fmtBytes(mem.rss)}`,
        `🖥️  RAM used:     ${fmtBytes(usedMem)} / ${fmtBytes(totalMem)}`,
        ``,
        `📊  CPU load:     ${cpuLoad} (${cpuCount} cores)`,
        `📦  Node.js:      ${process.version}`,
        `🖥️  Platform:    ${os.type()} ${os.arch()}`,
      ];

      const reply = fmt
        ? fmt.success("حالة التشغيل", lines)
        : lines.join("\n");

      await ctx.reply(reply);
    },
  };
}
