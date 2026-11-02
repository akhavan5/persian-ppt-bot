/**
 * ربات روبیکا: توابع خالص (بدون وابستگی به بقیه‌ی ماژول‌ها) برای شناسه‌ها، قالب‌بندی متن و دکمه‌ها.
 *
 * تفاوت اصلی روبیکا با تلگرام و بله: شناسه‌ی چت و پیام در روبیکا «رشته» است (مثل b0QF… و ۱۸ رقم برای پیام)،
 * ولی کل کد ربات (bot.ts و Workflowها) شناسه‌ی عددی انتظار دارد. پس:
 *  ۱) شناسه‌ی هر چت روبیکا با SHA-256 به یک عدد ۴۶ بیتی تبدیل و با RUBIKA_ID_BASE جمع می‌شود (بدون جدول و بدون شمارنده؛
 *     همیشه برای یک چت همان عدد می‌شود). بازه‌ها از هم جدا هستند: تلگرام < ۱۰^۱۴ ≤ بله < ۲×۱۰^۱۴ ≤ روبیکا.
 *  ۲) شناسه‌ی پیام هم به همین شکل به یک «دستگیره‌ی» عددی تبدیل می‌شود و رشته‌ی اصلی در KV می‌ماند (rubika-api.ts).
 * مجموع هر شناسه کمتر از ۱۵ رقم می‌ماند، پس اتصال به حساب وب با normTgId در link.ts همان‌طور کار می‌کند.
 */

export const RUBIKA_ID_BASE = 200_000_000_000_000; // ۲×۱۰^۱۴
export const RUBIKA_API_DEFAULT = "https://botapi.rubika.ir";

export const isRubikaId = (n: unknown): boolean => {
  const v = typeof n === "string" && /^\d+$/.test(n) ? Number(n) : n;
  return typeof v === "number" && Number.isSafeInteger(v) && v >= RUBIKA_ID_BASE;
};

/** SHA-256 ← عدد صحیح ۴۶ بیتی (کمتر از ۷٫۰۴×۱۰^۱۳) */
export async function hash46(s: string): Promise<number> {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));
  let n = 0;
  for (let i = 0; i < 5; i++) n = n * 256 + d[i]; // ۴۰ بیت
  return n * 64 + (d[5] & 63); // + ۶ بیت = ۴۶ بیت (همچنان کاملاً داخل اعداد صحیح امن)
}

/** شناسه‌ی عددی ربات برای یک چت خصوصی روبیکا (b0…) */
export const rubikaUserId = async (chatGuid: string): Promise<number> => RUBIKA_ID_BASE + (await hash46(`rb-chat:${chatGuid}`));
/** دستگیره‌ی عددی یک پیام روبیکا (همیشه > ۰) */
export const rubikaMsgHandle = async (chatGuid: string, mid: string): Promise<number> => 1 + (await hash46(`rb-msg:${chatGuid}|${mid}`));

// ---------- قالب‌بندی: HTML تلگرام ← متن ساده ----------
// روبیکا برای قالب‌بندی «metadata» با اندیس نویسه می‌خواهد و یک metadata نامعتبر کل پیام را رد می‌کند؛
// واحد اندیس (کد-پوینت یا UTF-16) در مستندات نیامده و ایموجی‌های ربات اندیس را جابه‌جا می‌کرد. پس فعلاً متن ساده می‌رود.

const decode = (s: string) =>
  s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/&amp;/g, "&");

/** تگ‌های HTML تلگرام ← متن ساده؛ لینک «متن» با آدرس متفاوت به‌شکل «متن (آدرس)» می‌آید */
export function htmlToPlain(html: string): string {
  let s = html.replace(/<br\s*\/?>/gi, "\n");
  s = s.replace(/<a\s[^>]*?href\s*=\s*(?:"([^"]*)"|'([^']*)')[^>]*>([\s\S]*?)<\/a>/gi, (_m, a: string | undefined, b: string | undefined, t: string) => {
    const url = decode(a ?? b ?? "");
    const label = t.replace(/<[^>]+>/g, "");
    if (!/^https?:\/\//i.test(url)) return label; // tg:// و … در روبیکا کار نمی‌کند؛ فقط متن
    return !label.trim() || decode(label).trim() === url ? url : `${label} (${url})`;
  });
  s = s.replace(/<[^>]+>/g, "");
  return decode(s);
}

/** متن‌های «تلگرام» در پیام‌های روبیکا به «روبیکا» تبدیل می‌شوند (لینک‌ها دست نمی‌خورند) */
export function rubikaWording(s: string): string {
  return s.replace(/تلگرامت/g, "روبیکات").replace(/تلگرامی/g, "روبیکایی").replace(/تلگرام/g, "روبیکا");
}

/** متن نهایی پیام/کپشن برای روبیکا */
export const rubikaText = (html: string): string => rubikaWording(htmlToPlain(html));

// ---------- دکمه‌ها: inline_keyboard تلگرام ← inline_keypad روبیکا ----------
type AnyBtn = { text?: string; callback_data?: string; url?: string; web_app?: { url?: string }; [k: string]: unknown };
interface RBtn { id: string; type: "Simple" | "Link"; button_text: string; button_link?: { type: "url"; link_url: string } }
export interface RubikaKeypad { rows: { buttons: RBtn[] }[] }

export const hasLinkButton = (markup: unknown): boolean =>
  !!(markup as { inline_keyboard?: AnyBtn[][] } | undefined)?.inline_keyboard?.some((r) => r.some((b) => !!b.url || !!b.web_app));

/**
 * links = "button": دکمه‌ی لینک (type=Link)؛ links = "text": لینک‌ها دکمه نمی‌شوند و به‌صورت «نام: آدرس» در extra برمی‌گردند
 * (تلاش دوم بعد از خطای روبیکا، تا اگر مدل دکمه‌ی لینک درست نبود کاربر بی‌پاسخ نماند).
 * Mini App (web_app) در روبیکا نیست؛ به صفحه‌ی سایت باز می‌شود.
 */
export function rubikaKeypad(markup: unknown, siteUrl: string, links: "button" | "text"): { keypad?: RubikaKeypad; extra: string } {
  const mk = markup as { inline_keyboard?: AnyBtn[][] } | undefined;
  if (!mk || !Array.isArray(mk.inline_keyboard)) return { extra: "" };
  const extra: string[] = [];
  let li = 0;
  const rows = mk.inline_keyboard.map((row) => row.flatMap((b): RBtn[] => {
    const text = rubikaWording(String(b.text ?? "").replace(/<[^>]+>/g, "")).trim() || "•";
    const link = b.web_app ? siteUrl : b.url;
    if (link) {
      if (links === "text") { extra.push(`${text}: ${link}`); return []; }
      return [{ id: `lnk${li++}`, type: "Link", button_text: text, button_link: { type: "url", link_url: link } }];
    }
    return [{ id: String(b.callback_data ?? "").slice(0, 64) || `b${li++}`, type: "Simple", button_text: text }];
  })).filter((r) => r.length).map((buttons) => ({ buttons }));
  return { ...(rows.length ? { keypad: { rows } } : {}), extra: extra.join("\n") };
}

// ---------- فایل ----------
const MIME: Record<string, string> = {
  pdf: "application/pdf", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  txt: "text/plain", md: "text/markdown", csv: "text/csv", json: "application/json",
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp",
  mp3: "audio/mpeg", m4a: "audio/mp4", aac: "audio/aac", wav: "audio/wav", ogg: "audio/ogg", oga: "audio/ogg", opus: "audio/ogg", flac: "audio/flac",
};
export const mimeOfName = (name: string): string => MIME[(name.split(".").pop() || "").toLowerCase()] ?? "";
