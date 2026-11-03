/**
 * برنامک ایتا: توابع خالص برای شناسه‌ها و قالب‌بندی پیام.
 *
 * شناسه‌ی هر کاربر ایتا با EITAA_ID_BASE جمع می‌شود تا با تلگرام، بله و روبیکا هرگز یکی نشود (اعتبار، پلن، فایل‌ها جدا بمانند)
 * و همچنان عددی مثبت و کمتر از ۱۵ رقم بماند (normTgId در link.ts). بازه‌ها: تلگرام < ۱۰^۱۴ ≤ بله < ۲×۱۰^۱۴ ≤ روبیکا < ۳×۱۰^۱۴ ≤ ایتا.
 * این فایل عمداً به ماژول دیگری وابسته نیست.
 */
export const EITAA_ID_BASE = 300_000_000_000_000; // ۳×۱۰^۱۴
const EITAA_ID_MAX = 700_000_000_000_000; // سقف شناسه‌ی خود ایتا تا مجموع از ۱۰^۱۵ رد نشود (شناسه‌های واقعی خیلی کوچک‌ترند)

export const isEitaaId = (n: unknown): boolean => {
  const v = typeof n === "string" && /^\d+$/.test(n) ? Number(n) : n;
  return typeof v === "number" && Number.isSafeInteger(v) && v >= EITAA_ID_BASE && v < 1_000_000_000_000_000;
};
export const toEitaaId = (n: number): number => EITAA_ID_BASE + n;
export const fromEitaaId = (n: number): number => n - EITAA_ID_BASE;
export const validEitaaRawId = (n: unknown): n is number => typeof n === "number" && Number.isSafeInteger(n) && n > 0 && n < EITAA_ID_MAX;

const decode = (s: string) =>
  s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/&amp;/g, "&");

/** نشانه‌های Markdown ایتا در متن عادی با \ خنثی می‌شوند */
const escMd = (s: string) => s.replace(/([\\*_`\[\]])/g, "\\$1");

/** متن‌های «تلگرام» در پیام‌های ایتا به «ایتا» تبدیل می‌شوند (فقط متن؛ لینک‌ها دست نمی‌خورند) */
export const eitaaWording = (s: string): string => s.replace(/تلگرامت/g, "ایتات").replace(/تلگرامی/g, "ایتایی").replace(/تلگرام/g, "ایتا");

/** HTML تلگرام (b, i, code, pre, a) ← Markdown ایتا: **پررنگ**، __کج__، `کد`، ```بلوک```، [متن](آدرس) */
export function htmlToEitaaMd(html: string): string {
  let out = "";
  let href: string | null = null;
  let inPre = false, inCode = false;
  const re = /<(\/?)([a-zA-Z][\w-]*)((?:\s[^>]*)?)>|([^<]+|<)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    if (m[4] !== undefined) {
      const raw = decode(m[4]);
      out += inPre || inCode ? raw.replace(/`/g, "ˋ") : escMd(raw);
      continue;
    }
    const close = m[1] === "/";
    let tag = m[2].toLowerCase();
    if (tag === "strong") tag = "b"; else if (tag === "em") tag = "i";
    if (tag === "br") { out += "\n"; continue; }
    if (tag === "b") out += "**";
    else if (tag === "i") out += "__";
    else if (tag === "code" && !inPre) { out += "`"; inCode = !close; }
    else if (tag === "pre") { out += close ? "\n```" : "```\n"; inPre = !close; }
    else if (tag === "a") {
      if (!close) { href = decode(m[3].match(/href\s*=\s*"([^"]*)"/i)?.[1] ?? m[3].match(/href\s*=\s*'([^']*)'/i)?.[1] ?? ""); out += "["; }
      else { const u = (href ?? "").replace(/\s/g, "%20").replace(/\)/g, "%29"); out += /^https?:\/\//i.test(u) ? `](${u})` : "]"; href = null; }
    }
  }
  // لینک بی‌آدرس (tg:// و …) فقط متن می‌ماند
  return eitaaWording(out.replace(/\[([^\]]*)\](?!\()/g, "$1")).trim();
}
