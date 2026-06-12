// ─── Shared UI Formatter ─────────────────────────────────────────────────────
// Single source of truth for all bot message styling.
// All plugins import from here — never build raw message strings manually.

export const BRAND = "⸪⟅𝐕̶݈̂͜𝔈̟͢⃟݃།̶𝝬̶۪͛ۡ⸸𝚬̱̩⩨ܵ𝐁᮫͎ܺ݀ࣸ᷼᷍⃢ː𝚬̶݄݈݊𝐓݂ ❈ 🦢";
export const DIV   = "━━━━━━━━━━━━";

// ─── Bold unicode digits ──────────────────────────────────────────────────────
// ممنوع استخدام 0-9 مباشرة في الرسائل — استخدم toBold() دائماً.

const BOLD_DIGIT: Record<string, string> = {
  "0": "𝟶", "1": "𝟷", "2": "𝟸", "3": "𝟹", "4": "𝟺",
  "5": "𝟻", "6": "𝟼", "7": "𝟽", "8": "𝟾", "9": "𝟿",
};

/** تحويل أي عدد إلى نمط الأرقام المزخرفة — يدعم أي عدد مهما كبر. */
export function toBold(n: number): string {
  return String(n)
    .split("")
    .map((c) => BOLD_DIGIT[c] ?? c)
    .join("");
}

// ─── Category metadata ────────────────────────────────────────────────────────

export interface CategoryMeta {
  /** مفتاح الفئة — يطابق قيمة `category` في ICommand */
  key:      string;
  /** الاسم المعروض في قائمة الأوامر */
  label:    string;
  /** رمز القسم */
  emoji:    string;
  /** كلمات البحث التي تُفعّل عرض هذا القسم */
  triggers: string[];
}

/**
 * الأقسام الثلاثة الرسمية للبوت.
 * أضف أوامر جديدة لأي قسم عبر category: "system" | "private" | "admin"
 * في تعريف ICommand — ستظهر تلقائياً في القائمة.
 */
export const CATEGORY_META: CategoryMeta[] = [
  {
    key:      "system",
    label:    "اوامر النظام",
    emoji:    "🪅",
    triggers: ["نظام", "system", "sys"],
  },
  {
    key:      "private",
    label:    "اوامر خاصة",
    emoji:    "🌨",
    triggers: ["خاصة", "خاص", "special", "private"],
  },
  {
    key:      "admin",
    label:    "اوامر الادارة",
    emoji:    "🏴",
    triggers: ["ادارة", "الادارة", "إدارة", "الإدارة", "admin", "adm"],
  },
];

/** ترجمة كلمة مفتاح عربية/إنجليزية إلى CategoryMeta، أو null إن لم تُعرَف. */
export function resolveCategory(keyword: string): CategoryMeta | null {
  const k = keyword.trim().toLowerCase();
  return CATEGORY_META.find((c) => c.triggers.some((t) => t.toLowerCase() === k)) ?? null;
}

// ─── Minimal command entry (avoids circular imports) ─────────────────────────

export interface CmdEntry {
  name:         string;
  description?: string;
}

// ─── Dynamic main menu ───────────────────────────────────────────────────────

/**
 * بناء رسالة القائمة الرئيسية ديناميكياً.
 *
 * @param prefix    - البادئة الحالية
 * @param catCounts - عدد الأوامر لكل category key (من CommandRegistry.byCategory())
 */
export function buildCommandsMessage(
  prefix:    string,
  catCounts: Map<string, number>,
): string {
  const groupLines = CATEGORY_META.map((cat) => {
    const count = catCounts.get(cat.key) ?? 0;
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

// ─── Dynamic category detail ─────────────────────────────────────────────────

/**
 * بناء رسالة تفاصيل قسم واحد من الأوامر الحية.
 *
 * @param meta   - بيانات الفئة
 * @param cmds   - الأوامر الحية من Registry لهذا القسم
 * @param prefix - البادئة الحالية
 */
export function buildCategoryMessage(
  meta:   CategoryMeta,
  cmds:   CmdEntry[],
  prefix: string,
): string {
  const cmdLines = cmds.map(
    (c) => `. ̶ׁ${meta.emoji} ${prefix}${c.name} — ${c.description ?? ""}`
  );

  return [
    BRAND,
    `⌗ ⨯ ${meta.emoji} ${meta.label} ${DIV}`,
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

// ─── Generic reply header ─────────────────────────────────────────────────────

export function pluginHeader(section: string): string {
  return `${BRAND}\n⌗ ⨯ ${section} ${DIV}`;
}
