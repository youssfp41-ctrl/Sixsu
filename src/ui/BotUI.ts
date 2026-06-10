// ─── Shared UI Formatter ─────────────────────────────────────────────────────
// Single source of truth for all bot message styling.
// All plugins import from here — never build raw message strings manually.

export const BRAND = "⸪⟅𝐕̶݈̂͜𝔈̟͢⃟݃།̶𝝬̶۪͛ۡ⸸𝚬̱̩⩨ܵ𝐁᮫͎ܺ݀ࣸ᷼᷍⃢ː𝚶̶݄݈݊𝐓݂ ❈ 🦢";
export const DIV   = "━━━━━━━━━━━━";

// ─── Bold unicode digits ──────────────────────────────────────────────────────

const BOLD_DIGIT: Record<string, string> = {
  "0": "𝟶", "1": "𝟷", "2": "𝟸", "3": "𝟹", "4": "𝟺",
  "5": "𝟻", "6": "𝟼", "7": "𝟽", "8": "𝟾", "9": "𝟿",
};

function toBold(n: number): string {
  return String(n)
    .split("")
    .map((c) => BOLD_DIGIT[c] ?? c)
    .join("");
}

// ─── Command group definitions ────────────────────────────────────────────────

interface CmdGroup {
  label: string;
  emoji: string;
  count: number;
}

const BASE_GROUPS: CmdGroup[] = [
  { label: "اوامر النظام",   emoji: "🪅", count: 3 },
  { label: "اوامر خاصة",    emoji: "🌨", count: 1 },
  { label: "اوامر الادارة", emoji: "🏴", count: 3 },
];

// ─── Commands list message ────────────────────────────────────────────────────

export function buildCommandsMessage(prefix: string, isAdmin: boolean): string {
  const groups: CmdGroup[] = BASE_GROUPS.map((g) => ({ ...g }));
  if (isAdmin && groups[2]) groups[2].count += 1;

  const [sys, spc, adm] = groups as [CmdGroup, CmdGroup, CmdGroup];

  const groupLines = [
    `${sys.label} ${toBold(sys.count)} . ̶ׁ${sys.emoji} ▾ `,
    `${spc.label} ${toBold(spc.count)} . ̶ׁ${spc.emoji} ▾`,
    `${adm.label} ${toBold(adm.count)} . ̶ׁ${adm.emoji} ▾ `,
  ];

  return [
    BRAND,
    `⌗ ⨯ أمر البادئة الحالي هو  ' ${prefix} ' ${DIV}`,
    ...groupLines,
    `${DIV} `,
    `🪭 . ៹࣪- لعرض التفاصيل  :[اوامر"اسم الامر"]`,
    BRAND,
  ].join("\n");
}

// ─── Uptime data contract ─────────────────────────────────────────────────────

export interface UptimeData {
  uptimeSec:   number;
  freeMemMB:   string;
  usedMemMB:   string;
  totalMemMB:  string;
  cpuPct:      number;
  cpuCores:    number;
  nodeVersion: string;
  osType:      string;
  arch:        string;
  latencyMs:   number;
}

function fmtUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return `${s}ث:${m}د:${h}س:${d}يوم`;
}

// ─── Uptime message ───────────────────────────────────────────────────────────

export function buildUptimeMessage(data: UptimeData): string {
  return [
    `، معلومات النظام ̸̸🪭ˑ˖`,
    ` ${DIV} `,
    `. 🎉وقت التشغيل: ${fmtUptime(data.uptimeSec)}`,
    ` 🌨 الرام المتبقي: ${data.freeMemMB} MB `,
    `🎫 رام النظام: ${data.usedMemMB}/${data.totalMemMB} MB`,
    ` 🪇استهلاك المعالج: ${data.cpuPct}% `,
    `🎬الانوية: ${data.cpuCores} `,
    `📜اصدار Node: ${data.nodeVersion} `,
    `⛓️النظام: ${data.osType} ${data.arch} `,
    `⌛الاستجابة: ${data.latencyMs}ms ${DIV}`,
  ].join("\n");
}
