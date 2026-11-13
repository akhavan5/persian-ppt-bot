/**
 * ربات سروش‌پلاس: توابع خالص (بدون وابستگی به بقیه‌ی ماژول‌ها) برای شناسه‌ها، قالب پیام و دکمه‌ها.
 *
 * API سروش‌پلاس (https://api.splus.ir/bot<token>/METHOD) تقریباً هم‌شکل تلگرام است و parse_mode=HTML را هم می‌پذیرد،
 * پس مثل بله کل منطق ربات (bot.ts و Workflowها) دست‌نخورده می‌ماند و فقط لایه‌ی ارسال (telegram.ts) بر اساس «شناسه‌ی گیرنده» مسیر را انتخاب می‌کند.
 * شناسه‌ی هر کاربر/چت سروش‌پلاس با SPLUS_ID_BASE جمع می‌شود تا با بقیه‌ی پلتفرم‌ها هرگز یکی نشود (اعتبار، پلن، فایل‌ها جدا بمانند)
 * و همچنان عددی مثبت و کمتر از ۱۵ رقم بماند (normTgId در link.ts).
 * بازه‌ها: تلگرام < ۱۰^۱۴ ≤ بله < ۲×۱۰^۱۴ ≤ روبیکا < ۳×۱۰^۱۴ ≤ ایتا < ۴×۱۰^۱۴ ≤ سروش‌پلاس < ۱۰^۱۵.
 */

export const SPLUS_ID_BASE = 400_000_000_000_000; // ۴×۱۰^۱۴
const SPLUS_ID_LIMIT = 1_000_000_000_000_000; // ۱۰^۱۵
export const SPLUS_API_DEFAULT = "https://api.splus.ir";

export const isSplusId = (n: unknown): boolean => {
  const v = typeof n === "string" && /^\d+$/.test(n) ? Number(n) : n;
  return typeof v === "number" && Number.isSafeInteger(v) && v >= SPLUS_ID_BASE && v < SPLUS_ID_LIMIT;
};
export const toSplusId = (n: number): number => SPLUS_ID_BASE + n;
export const fromSplusId = (n: number): number => n - SPLUS_ID_BASE;

// ---------- قالب‌بندی ----------
// تگ‌های پشتیبانی‌شده‌ی HTML سروش‌پلاس: b, strong, i, em, u, ins, s, strike, del, a, code, pre, blockquote (مثل تلگرام، بدون spoiler)
/** تگ‌های spoiler/span (مخصوص تلگرام) حذف می‌شوند و متنشان می‌ماند */
const stripUnsupported = (html: string): string =>
  html.replace(/<\/?(?:tg-spoiler|span|tg-emoji)(?:\s[^>]*)?>/gi, "");

/** متن‌های «تلگرام» در پیام‌های سروش‌پلاس به «سروش‌پلاس» تبدیل می‌شوند (فقط متن ارسالی؛ لینک‌ها دست نمی‌خورند چون فارسی ندارند) */
export function splusWording(s: string): string {
  return s.replace(/تلگرامت/g, "سروش‌پلاست").replace(/تلگرامی/g, "سروش‌پلاسی").replace(/تلگرام/g, "سروش‌پلاس");
}

/** متن/کپشن HTML تلگرام ← HTML سروش‌پلاس */
export const splusText = (html: string): string => splusWording(stripUnsupported(html));

type AnyBtn = { text?: string; callback_data?: string; url?: string; web_app?: { url?: string }; [k: string]: unknown };

/** دکمه‌های سروش‌پلاس فقط text + (url | callback_data) دارند؛ دکمه‌ی web_app (Mini App) به لینک سایت تبدیل می‌شود */
export function splusMarkup(markup: unknown, siteUrl: string): unknown {
  const mk = markup as { inline_keyboard?: AnyBtn[][] } | undefined;
  if (!mk || !Array.isArray(mk.inline_keyboard)) return markup;
  const rows = mk.inline_keyboard.map((row) => row.map((b): AnyBtn => {
    const text = splusWording(String(b.text ?? "").replace(/<[^>]+>/g, ""));
    if (b.web_app) return { text, url: siteUrl };
    if (b.url) return { text, url: b.url };
    return { text, callback_data: String(b.callback_data ?? "").slice(0, 64) };
  })).filter((row) => row.length);
  return { inline_keyboard: rows };
}

// ---------- آپدیت ----------
const mapUser = (u: any) => (u && typeof u.id === "number" ? { ...u, id: toSplusId(u.id) } : u);
const mapMessage = (m: any) =>
  m && m.chat && typeof m.chat.id === "number" ? { ...m, from: mapUser(m.from), chat: { ...m.chat, id: toSplusId(m.chat.id) } } : m;

/** آپدیت سروش‌پلاس ← آپدیت هم‌شکل تلگرام با شناسه‌های جابه‌جاشده. آپدیت‌های بی‌ربط (edited_message و …) null می‌شوند */
export function normalizeSplusUpdate(update: any): any | null {
  if (update?.callback_query?.from) {
    const cq = update.callback_query;
    return { ...update, callback_query: { ...cq, from: mapUser(cq.from), message: mapMessage(cq.message) } };
  }
  if (update?.message?.from && update.message.chat) return { ...update, message: mapMessage(update.message) };
  return null;
}
