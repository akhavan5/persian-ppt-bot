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

import { EITAA_ID_BASE } from "./eitaa-format";

export const RUBIKA_ID_BASE = 200_000_000_000_000; // ۲×۱۰^۱۴
export const RUBIKA_API_DEFAULT = "https://botapi.rubika.ir";

export const isRubikaId = (n: unknown): boolean => {
  const v = typeof n === "string" && /^\d+$/.test(n) ? Number(n) : n;
  return typeof v === "number" && Number.isSafeInteger(v) && v >= RUBIKA_ID_BASE && v < EITAA_ID_BASE; // بالاتر از آن شناسه‌ی ایتاست
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

// ---------- قالب‌بندی: HTML تلگرام ← متن + metadata روبیکا ----------
// طبق مستندات روبیکا، sendMessage یک metadata با اجزای { type, from_index, length, link_url? } می‌گیرد؛ اندیس و طول بر اساس UTF-16 است
// (همان اندیس رشته‌ی جاوااسکریپت؛ ایموجی ۲ واحد) و حداکثر ۳۰ جزء. یک جزء نامعتبر کل پیام را رد می‌کند، پس ارسال سه‌مرحله‌ای است (rubika-api.ts).
// ویرایش پیام (editMessageText) metadata ندارد و متن ساده می‌شود. دکمه‌ی لینک هم در مدل Button فیلد آدرس ندارد؛ لینک‌ها در پایان پیام به‌شکل متن لینک‌دار می‌آیند.

export interface MetaPart { type: string; from_index: number; length: number; link_url?: string }
export interface RichText { text: string; parts: MetaPart[] }
export interface LinkBtn { label: string; url: string }

const decode = (s: string) =>
  s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/&amp;/g, "&");

/** متن‌های «تلگرام» در پیام‌های روبیکا به «روبیکا» تبدیل می‌شوند (لینک‌ها دست نمی‌خورند) */
export function rubikaWording(s: string): string {
  return s.replace(/تلگرامت/g, "روبیکات").replace(/تلگرامی/g, "روبیکایی").replace(/تلگرام/g, "روبیکا");
}

const TAG_TYPE: Record<string, string> = {
  b: "Bold", strong: "Bold", i: "Italic", em: "Italic", u: "Underline", ins: "Underline",
  s: "Strike", strike: "Strike", del: "Strike", code: "Mono", pre: "Pre", blockquote: "Quote", "tg-spoiler": "Spoiler",
};

/** HTML تلگرام ← { text, parts }؛ لینک http(s) به جزء Link تبدیل می‌شود (tg:// و … فقط متن می‌ماند) */
export function htmlToRubika(html: string): RichText {
  let out = "";
  const parts: MetaPart[] = [];
  const stack: { tag: string; type?: string; from: number; url?: string }[] = [];
  const src = html.replace(/<br\s*\/?>/gi, "\n");
  const re = /<(\/?)([A-Za-z][\w-]*)([^>]*)>|([^<]+)|</g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    if (m[4] !== undefined) { out += rubikaWording(decode(m[4])); continue; }
    if (m[2] === undefined) { out += "<"; continue; } // «<» تنهای بی‌تگ
    const tag = m[2].toLowerCase();
    if (!m[1]) { // تگ باز
      let type: string | undefined = TAG_TYPE[tag];
      let url: string | undefined;
      if (tag === "a") {
        const h = /href\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(m[3] ?? "");
        const u = decode(h?.[1] ?? h?.[2] ?? "");
        if (/^https?:\/\//i.test(u)) { type = "Link"; url = u; }
      } else if (tag === "span" && /tg-spoiler/i.test(m[3] ?? "")) type = "Spoiler";
      else if (tag === "code" && stack.some((x) => x.type === "Pre")) type = undefined; // <pre><code> یک بلاک است
      stack.push({ tag, type, from: out.length, url });
    } else { // تگ بسته
      for (let i = stack.length - 1; i >= 0; i--) {
        if (stack[i].tag !== tag) continue;
        const [t] = stack.splice(i, 1);
        const length = out.length - t.from;
        if (t.type && length > 0) parts.push({ type: t.type, from_index: t.from, length, ...(t.url ? { link_url: t.url } : {}) });
        break;
      }
    }
  }
  return { text: out, parts };
}

/** اجزای معتبر برای متنی با طول max: بریده‌شده، بدون جزء خالی، حداکثر ۳۰ تا */
function fitParts(parts: MetaPart[], len: number): MetaPart[] {
  return parts
    .filter((p) => p.length > 0 && p.from_index >= 0 && p.from_index < len)
    .map((p) => (p.from_index + p.length > len ? { ...p, length: len - p.from_index } : p))
    .sort((a, b) => a.from_index - b.from_index)
    .slice(0, 30);
}

/** پیام با قالب‌بندی: لینک‌های دکمه‌ها (links) به‌شکل متن لینک‌دار در انتهای پیام می‌آیند */
export function buildRich(base: RichText, links: LinkBtn[], max = 4096): RichText {
  let text = base.text;
  const parts = [...base.parts];
  if (links.length) {
    text += (text ? "\n\n" : "");
    links.forEach((l, i) => {
      if (i) text += "\n";
      const label = rubikaWording(l.label);
      parts.push({ type: "Link", from_index: text.length, length: label.length, link_url: l.url });
      text += label;
    });
  }
  text = text.slice(0, max);
  return { text: text || "…", parts: text ? fitParts(parts, text.length) : [] };
}

/** متن ساده (بدون metadata): لینک «متن» به‌شکل «متن (آدرس)» و لینک دکمه‌ها به‌شکل «نام: آدرس» */
export function buildPlain(html: string, links: LinkBtn[], max = 4096): RichText {
  const withUrls = html.replace(/<br\s*\/?>/gi, "\n").replace(/<a\s[^>]*?href\s*=\s*(?:"([^"]*)"|'([^']*)')[^>]*>([\s\S]*?)<\/a>/gi, (_m, a: string | undefined, b: string | undefined, t: string) => {
    const url = decode(a ?? b ?? "");
    const label = t.replace(/<[^>]+>/g, "");
    if (!/^https?:\/\//i.test(url)) return label;
    return !label.trim() || decode(label).trim() === url ? url : `${label} (${url})`;
  });
  const body = rubikaWording(decode(withUrls.replace(/<[^>]+>/g, "")));
  const tail = links.length ? `\n\n${links.map((l) => `${rubikaWording(l.label)}: ${l.url}`).join("\n")}` : "";
  return { text: (body + tail).slice(0, max) || "…", parts: [] };
}

/** متن ساده‌ی یک HTML (برای کپشن فایل و ویرایش پیام) */
export const rubikaText = (html: string, max = 4096): string => buildPlain(html, [], max).text;

// ---------- دکمه‌ها: inline_keyboard تلگرام ← inline_keypad روبیکا ----------
type AnyBtn = { text?: string; callback_data?: string; url?: string; web_app?: { url?: string }; [k: string]: unknown };
interface RBtn { id: string; type: "Simple"; button_text: string }
export interface RubikaKeypad { rows: { buttons: RBtn[] }[] }

/**
 * فقط دکمه‌های Simple ساخته می‌شود (callback_data ← id). دکمه‌ی لینک/Mini App در مدل Button روبیکا آدرس ندارد،
 * پس به لیست links برمی‌گردد و در متن پیام به‌شکل لینک می‌آید. Mini App (web_app) به صفحه‌ی سایت باز می‌شود.
 */
export function rubikaKeypad(markup: unknown, siteUrl: string): { keypad?: RubikaKeypad; links: LinkBtn[] } {
  const mk = markup as { inline_keyboard?: AnyBtn[][] } | undefined;
  if (!mk || !Array.isArray(mk.inline_keyboard)) return { links: [] };
  const links: LinkBtn[] = [];
  let n = 0;
  const rows = mk.inline_keyboard.map((row) => row.flatMap((b): RBtn[] => {
    const text = rubikaWording(String(b.text ?? "").replace(/<[^>]+>/g, "")).trim() || "•";
    const link = b.web_app ? siteUrl : b.url;
    if (link) { links.push({ label: text, url: link }); return []; }
    return [{ id: String(b.callback_data ?? "").slice(0, 64) || `b${n++}`, type: "Simple", button_text: text }];
  })).filter((r) => r.length).map((buttons) => ({ buttons }));
  return { ...(rows.length ? { keypad: { rows } } : {}), links };
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
