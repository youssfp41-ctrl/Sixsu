// ─── Shared UI Formatter ─────────────────────────────────────────────────────
// Single source of truth for all bot message styling.
// All plugins import from here — never build raw message strings manually.

export const BRAND = "⸪⟅𝐕̶݈̂͜𝔈̟͢⃟݃།̶𝝬̶۪͛ۡ⸸𝚬̱̩⩨ܵ𝐁᮫͎ܺ݀ࣸ᷼᷍⃢ː𝚬̶݄݈݊𝐓݂ ❈ 🦢";
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

// ─── Category definitions ─────────────────────────────────────────────────────

interface CmdEntry {
  name: string;
  desc: string;
}

interface CategoryDef {
  key:    string;
  label:  string;
  emoji:  string;
  cmds:   CmdEntry[];
  /** Arabic trigger words that map to this category */
  triggers: string[];
}

export const CATEGORIES: CategoryDef[] = [
  {
    key:      "system",
    label:    "اوامر النظام",
    emoji:    "🪅",
    triggers: ["نظام", "system", "sys"],
    cmds: [
      { name: "اوامر",  desc: "عرض قائمة الأوامر" },
      { name: "ابتيم",  desc: "معلومات النظام والتشغيل" },
      { name: "بادئة",  desc: "البادئة الحالية للأوامر" },
    ],
  },
  {
    key:      "special",
    label:    "اوامر خاصة",
    emoji:    "🌨",
    triggers: ["خاصة", "خاص", "special"],
    cmds: [
      { name: "بلاك",  desc: "إرسال رسالة تلقائية متكررة داخل القروب" },
    ],
  },
  {
    key:      "admin",
    label:    "اوامر الادارة",
    emoji:    "🏴",
    triggers: ["ادارة", "الادارة", "إدارة", "الإدارة", "admin", "adm"],
    cmds: [
      { name: "ادمن",   desc: "عرض وإدارة أدمن القروب" },
      { name: "اغلاق",  desc: "تفعيل أو إيقاف وضع الإغلاق" },
      { name: "قروبات", desc: "عرض وإدارة القروبات المتاحة" },
    ],
  },
];

/** Resolve an Arabic/English keyword to a CategoryDef, or null if not found. */
export function resolveCategory(keyword: string): CategoryDef | null {
  const k = keyword.trim().toLowerCase();
  return CATEGORIES.find((c) => c.triggers.some((t) => t.toLowerCase() === k)) ?? null;
}

// ─── Full commands list ───────────────────────────────────────────────────────

export function buildCommandsMessage(prefix: string, isAdmin: boolean): string {
  const adminCat = CATEGORIES.find((c) => c.key === "admin")!;
  const adminCount = isAdmin ? adminCat.cmds.length + 1 : adminCat.cmds.length;

  const groupLines = CATEGORIES.map((cat) => {
    const count = cat.key === "admin" ? adminCount : cat.cmds.length;
    return `${cat.label} ${toBold(count)} . ̶ׁ${cat.emoji} ▾`;
  });

  return [
    BRAND,
    `⌗ ⨯ أمر البادئة الحالي هو  ' ${prefix} ' ${DIV}`,
    ...groupLines,
    `${DIV} `,
    `🪭 . ៹࣪- لعرض التفاصيل  :[اوامر"اسم القسم"]`,
    BRAND,
  ].join("\n");
}

// ─── Single category detail ───────────────────────────────────────────────────

export function buildCategoryMessage(cat: CategoryDef, prefix: string): string {
  const cmdLines = cat.cmds.map(
    (c) => `. ̶ׁ${cat.emoji} ${prefix}${c.name} — ${c.desc}`
  );

  return [
    BRAND,
    `⌗ ⨯ ${cat.emoji} ${cat.label} ${DIV}`,
    ...cmdLines,
    `${DIV} `,
    `🪭 . ៹࣪- للقائمة الكاملة: ${prefix}اوامر`,
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

// ─── Generic reply header (for non-commands plugins) ─────────────────────────
// Replaces the old per-plugin HEADER constants.

export function pluginHeader(section: string): string {
  return `${BRAND}\n⌗ ⨯ ${section} ${DIV}`;
}
