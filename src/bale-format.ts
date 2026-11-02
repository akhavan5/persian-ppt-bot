/**
 * ربات بله: توابع خالص (بدون وابستگی به بقیه‌ی ماژول‌ها) برای شناسه‌ها، تشخیص پلتفرم و قالب‌بندی پیام.
 *
 * ایده‌ی اصلی: API بله شبیه تلگرام است، پس کل منطق ربات (bot.ts و Workflowها) دست‌نخورده می‌ماند و فقط لایه‌ی ارسال
 * (telegram.ts) بر اساس «شناسه‌ی گیرنده» تصمیم می‌گیرد پیام به تلگرام برود یا به بله.
 * شناسه‌ی هر کاربر/چت بله با یک عدد ثابت جمع می‌شود (BALE_ID_BASE) تا
 *  ۱) با شناسه‌ی تلگرام هرگز یکی نشود (اعتبار، پلن، تنظیمات و فایل‌ها جدا بمانند)،
 *  ۲) هر جای کد (cron، Workflow، پخش همگانی) فقط از روی عدد بدانیم گیرنده در بله است،
 *  ۳) همچنان عدد مثبت و کمتر از ۱۵ رقم بماند (اتصال به حساب وب با normTgId در link.ts همان‌طور کار کند).
 * شناسه‌ی کاربران تلگرام در عمل خیلی کمتر از ۱۰^۱۲ است؛ شناسه‌ی بله هم بسیار کمتر از ۱۰^۱۴.
 */

import { RUBIKA_ID_BASE } from "./rubika-format";

export const BALE_ID_BASE = 100_000_000_000_000; // ۱۰^۱۴ (شناسه‌های بله در بازه‌ی [۱۰^۱۴، ۲×۱۰^۱۴)؛ روبیکا از RUBIKA_ID_BASE شروع می‌شود)
export const BALE_API_DEFAULT = "https://tapi.bale.ai";

export const isBaleId = (n: unknown): boolean => {
  const v = typeof n === "string" && /^\d+$/.test(n) ? Number(n) : n;
  return typeof v === "number" && Number.isSafeInteger(v) && v >= BALE_ID_BASE && v < RUBIKA_ID_BASE;
};
export const toBaleId = (n: number): number => BALE_ID_BASE + n;
export const fromBaleId = (n: number): number => n - BALE_ID_BASE;

// ---------- قالب‌بندی: HTML تلگرام ← Markdown بله ----------
// بله پارامتر parse_mode ندارد و همه‌ی پیام‌ها را Markdown نشان می‌دهد (docs.bale.ai):
//  *برجسته*  و  _کج_  (قبل از نویسه‌ی اول و بعد از نویسه‌ی دوم باید فاصله باشد)، [متن](آدرس)، ```کد```
const O_B = "\uE000", C_B = "\uE001", O_I = "\uE002", C_I = "\uE003"; // نشانگرهای موقت؛ در پایان به * و _ تبدیل می‌شوند

const decode = (s: string) =>
  s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/&amp;/g, "&");

/** نویسه‌هایی که در Markdown بله می‌توانند ناخواسته قالب بسازند (متن کاربر مثل موضوع ارائه) خنثی می‌شوند */
const neutral = (s: string) =>
  s.replace(/[\uE000-\uE003]/g, "").replace(/\*/g, "∗").replace(/`/g, "ˋ").replace(/\]\(/g, "］(").replace(/(^|[\s(])_(?=\S)/g, "$1＿");

type Frame = { tag: string; out: string; href?: string };

/** تگ‌های تلگرام (b/strong, i/em, u/ins, s/strike/del, code, pre, a, tg-spoiler, span) ← Markdown بله */
export function htmlToBaleMd(html: string): string {
  const stack: Frame[] = [{ tag: "", out: "" }];
  const top = () => stack[stack.length - 1];
  const inside = (names: string[]) => stack.some((f) => names.includes(f.tag));
  const re = /<(\/?)([a-zA-Z][\w-]*)((?:\s[^>]*)?)>|([^<]+|<)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    if (m[4] !== undefined) { // متن
      const raw = decode(m[4]);
      top().out += inside(["code", "pre"]) ? raw.replace(/`/g, "ˋ") : neutral(raw);
      continue;
    }
    const closing = m[1] === "/";
    let tag = m[2].toLowerCase();
    if (tag === "strong") tag = "b"; else if (tag === "em") tag = "i"; else if (tag === "ins") tag = "u"; else if (tag === "strike" || tag === "del") tag = "s";
    if (tag === "br") { top().out += "\n"; continue; }
    if (!["b", "i", "u", "s", "code", "pre", "a", "tg-spoiler", "span", "blockquote"].includes(tag)) continue; // تگ ناشناخته: نادیده
    if (!closing) {
      const href = tag === "a" ? decode(m[3].match(/href\s*=\s*"([^"]*)"/i)?.[1] ?? m[3].match(/href\s*=\s*'([^']*)'/i)?.[1] ?? "") : undefined;
      stack.push({ tag, out: "", href });
      continue;
    }
    // بستن: نزدیک‌ترین تگ باز هم‌نام
    let i = stack.length - 1;
    while (i > 0 && stack[i].tag !== tag) i--;
    if (i === 0) continue; // بستن بی‌جفت
    while (stack.length - 1 > i) { const f = stack.pop()!; top().out += f.out; } // تگ‌های بازِ داخلی که بسته نشده‌اند
    const f = stack.pop()!;
    top().out += wrap(f, stack);
  }
  while (stack.length > 1) { const f = stack.pop()!; top().out += f.out; }
  let s = stack[0].out;
  // فاصله‌ی لازم قبل از نشانگر باز و بعد از نشانگر بسته (قانون بله)
  s = s.replace(new RegExp(`([^\\s${O_B}${O_I}])([${O_B}${O_I}])`, "g"), "$1 $2")
       .replace(new RegExp(`([${C_B}${C_I}])([^\\s${C_B}${C_I}])`, "g"), "$1 $2");
  return s.replace(new RegExp(`[${O_B}${C_B}]`, "g"), "*").replace(new RegExp(`[${O_I}${C_I}]`, "g"), "_");
}

function wrap(f: Frame, stack: Frame[]): string {
  const inner = f.out;
  const core = inner.trim();
  if (!core) return inner;
  const lead = inner.slice(0, inner.indexOf(core)), trail = inner.slice(inner.indexOf(core) + core.length);
  const plain = (c: string) => c.replace(/[\uE000-\uE003]/g, "");
  const nestedInFmt = stack.some((x) => ["b", "i", "a", "code", "pre"].includes(x.tag));
  switch (f.tag) {
    case "b": return nestedInFmt ? inner : `${lead}${O_B}${plain(core)}${C_B}${trail}`;
    case "i": return nestedInFmt ? inner : `${lead}${O_I}${plain(core)}${C_I}${trail}`;
    case "code": return `${lead}\`${plain(core).replace(/`/g, "ˋ")}\`${trail}`;
    case "pre": return `${lead}\`\`\`\n${plain(core)}\n\`\`\`${trail}`;
    case "a": {
      const url = (f.href ?? "").replace(/\s/g, "%20").replace(/\)/g, "%29");
      if (!/^https?:\/\//i.test(url)) return inner; // tg:// و … در بله کار نمی‌کند؛ فقط متن
      return `${lead}[${plain(core).replace(/[\[\]]/g, "")}](${url})${trail}`;
    }
    default: return inner; // u, s, spoiler, span, blockquote: بله پشتیبانی نمی‌کند ← متن ساده
  }
}

/** متن‌های «تلگرام» در پیام‌های بله به «بله» تبدیل می‌شوند (فقط در متن ارسالی به بله؛ لینک‌ها دست نمی‌خورند) */
export function baleWording(s: string): string {
  return s.replace(/تلگرامت/g, "بله‌ات").replace(/تلگرامی/g, "بله‌ای").replace(/تلگرام/g, "بله");
}

/** متن نهایی پیام/کپشن برای بله: HTML ← Markdown ← واژه‌ها */
export const baleText = (html: string): string => baleWording(htmlToBaleMd(html));

type AnyBtn = { text?: string; callback_data?: string; url?: string; web_app?: { url?: string }; [k: string]: unknown };

/** دکمه‌ی web_app (Mini App) در بله هم باز می‌شود؛ با webApp=false (تلاش دوم بعد از خطا) به لینک ساده تبدیل می‌شود */
export const hasWebApp = (markup: unknown): boolean =>
  !!(markup as { inline_keyboard?: AnyBtn[][] } | undefined)?.inline_keyboard?.some((r) => r.some((b) => b.web_app));

export function baleMarkup(markup: unknown, siteUrl: string, webApp = true): unknown {
  const mk = markup as { inline_keyboard?: AnyBtn[][] } | undefined;
  if (!mk || !Array.isArray(mk.inline_keyboard)) return markup;
  const rows = mk.inline_keyboard.map((row) => row.map((b): AnyBtn => {
    const text = baleWording(String(b.text ?? "").replace(/<[^>]+>/g, ""));
    if (b.web_app) return webApp && b.web_app.url ? { text, web_app: { url: b.web_app.url } } : { text, url: b.web_app.url || siteUrl };
    if (b.url) return { text, url: b.url };
    return { text, callback_data: String(b.callback_data ?? "").slice(0, 64) };
  })).filter((row) => row.length);
  return { inline_keyboard: rows };
}

// ---------- آپدیت ----------
const mapUser = (u: any) => (u && typeof u.id === "number" ? { ...u, id: toBaleId(u.id) } : u);
const mapMessage = (m: any) =>
  m && m.chat && typeof m.chat.id === "number" ? { ...m, from: mapUser(m.from), chat: { ...m.chat, id: toBaleId(m.chat.id) } } : m;

/** آپدیت بله ← آپدیت هم‌شکل تلگرام با شناسه‌های جابه‌جاشده. آپدیت‌های بی‌ربط (edited_message، پرداخت و …) null می‌شوند */
export function normalizeBaleUpdate(update: any): any | null {
  if (update?.callback_query?.from) {
    const cq = update.callback_query;
    return { ...update, callback_query: { ...cq, from: mapUser(cq.from), message: mapMessage(cq.message) } };
  }
  if (update?.message?.from && update.message.chat) return { ...update, message: mapMessage(update.message) };
  return null;
}

