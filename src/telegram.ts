import type { Env } from "./env";
import { BALE_API_DEFAULT, baleMarkup, baleText, fromBaleId, hasWebApp, isBaleId } from "./bale-format";
import { isRubikaId } from "./rubika-format";
import { rubikaSendFile, rubikaTg } from "./rubika-api";
import { isEitaaId } from "./eitaa-format";
import { id3Site, tagMp3 } from "./id3";
import { eitaaTg } from "./eitaa";
import { SPLUS_API_DEFAULT, fromSplusId, isSplusId, splusMarkup, splusText } from "./splus-format";

const apiBase = (env: Env) => env.TELEGRAM_API_BASE || "https://api.telegram.org";

export const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// ---------- تلگرام یا بله؟ ----------
// شناسه‌ی گیرنده‌ی بله با BALE_ID_BASE جمع شده (bale-format.ts)، پس هر ارسال فقط از روی chat_id مسیر خودش را پیدا می‌کند.
// متدهای بدون chat_id (answerCallbackQuery، getFile، getMe) فقط داخل پردازش آپدیت بله صدا زده می‌شوند و از پرچم env.PLATFORM می‌فهمند.
interface Route { bale: boolean; rubika: boolean; splus: boolean; base: string; token: string }
function route(env: Env, chatId?: unknown): Route {
  const known = chatId !== undefined && chatId !== null && chatId !== "";
  // روبیکا: آدرس و توکن را rubika-api.ts خودش از env می‌خواند (متدها و قالب پاسخ با تلگرام فرق دارد)
  if (known ? isRubikaId(chatId) : env.PLATFORM === "rubika") return { bale: false, rubika: true, splus: false, base: "", token: "" };
  // سروش‌پلاس: API هم‌شکل تلگرام با HTML؛ آدرس و توکن از env
  if (known ? isSplusId(chatId) : env.PLATFORM === "splus") return { bale: false, rubika: false, splus: true, base: (env.SPLUS_API_BASE || SPLUS_API_DEFAULT).replace(/\/+$/, ""), token: env.SPLUS_BOT_TOKEN ?? "" };
  const bale = known ? isBaleId(chatId) : env.PLATFORM === "bale";
  return bale
    ? { bale, rubika: false, splus: false, base: (env.BALE_API_BASE || BALE_API_DEFAULT).replace(/\/+$/, ""), token: env.BALE_BOT_TOKEN ?? "" }
    : { bale, rubika: false, splus: false, base: apiBase(env), token: env.TELEGRAM_BOT_TOKEN };
}
/** نسخه‌ی env برای پردازش چیزی که از بله آمده (مثلاً خواندن فایل در Workflow)؛ برای گیرنده‌ی تلگرام همان env برمی‌گردد */
export const envFor = (env: Env, chatId: unknown): Env =>
  isRubikaId(chatId) ? (env.PLATFORM !== "rubika" ? { ...env, PLATFORM: "rubika" } : env)
  : isSplusId(chatId) ? (env.PLATFORM !== "splus" ? { ...env, PLATFORM: "splus" } : env)
  : isBaleId(chatId) && env.PLATFORM !== "bale" ? { ...env, PLATFORM: "bale" } : env;
/** آدرس دانلود فایل (بعد از getFile)؛ پلتفرم از پرچم env.PLATFORM می‌آید (getFile شناسه‌ی چت ندارد) */
export const fileUrl = (env: Env, filePath: string): string => {
  if (/^https?:\/\//i.test(filePath)) return filePath; // روبیکا (getFile) آدرس کامل دانلود می‌دهد
  const r = route(env);
  return `${r.base}/file/bot${r.token}/${filePath}`;
};
const siteOf = (env: Env) => (env.SITE_URL || "https://pptsaz.ir").replace(/\/+$/, "");

/** متدهایی که برای تجربه‌ی کاربر ضروری نیستند؛ خطایشان بی‌صدا نادیده گرفته می‌شود (بقیه‌ی متدهای مستند بله، مثل setMyCommands و edit*، خطا را بالا می‌دهند) */
const BALE_OPTIONAL = new Set(["answerCallbackQuery", "sendChatAction"]);
/** متدهای تلگرامی که در API بله وجود ندارند؛ اصلاً فراخوانی نمی‌شوند (دکمه‌ی منوی بازو در بله از @botfather تنظیم می‌شود) */
const BALE_UNSUPPORTED = new Set(["setChatMenuButton"]);

/** متن خطا؛ اگر سرور «retry_after» را در parameters داد (بله) به متن اضافه می‌شود تا منطق تلاش‌مجدد (broadcast) آن را بخواند */
function apiError(label: string, method: string, j: any, status: number): Error {
  const wait = Number(j?.parameters?.retry_after);
  const desc = String(j?.description ?? status);
  return new Error(`${label} ${method}: ${desc}${Number.isFinite(wait) && wait > 0 && !/retry after/i.test(desc) ? ` (retry after ${Math.ceil(wait)})` : ""}`);
}

/** پارامترهای تلگرام را به پارامترهای قابل‌فهم برای بله تبدیل می‌کند (بدون parse_mode: متن HTML به Markdown بله تبدیل می‌شود) */
function baleParams(env: Env, method: string, body: Record<string, unknown>, webApp = true): Record<string, unknown> {
  const b: Record<string, unknown> = { ...body };
  for (const k of ["parse_mode", "link_preview_options", "disable_web_page_preview", "caption_entities", "entities", "message_thread_id"]) delete b[k];
  if (isBaleId(b.chat_id)) b.chat_id = fromBaleId(Number(b.chat_id));
  if (isBaleId(b.user_id)) b.user_id = fromBaleId(Number(b.user_id));
  if (typeof b.text === "string") b.text = baleText(b.text).slice(0, 4096);
  if (typeof b.caption === "string" && method !== "editMessageCaption") b.caption = baleText(b.caption).slice(0, 1024);
  if (b.reply_markup) b.reply_markup = baleMarkup(b.reply_markup, siteOf(env), webApp);
  return b;
}

/** پارامترهای تلگرام ← سروش‌پلاس: HTML همان است؛ شناسه‌ها به شناسه‌ی اصلی برمی‌گردند و گزینه‌های نامستند حذف می‌شوند */
function splusParams(env: Env, body: Record<string, unknown>): Record<string, unknown> {
  const b: Record<string, unknown> = { ...body };
  for (const k of ["link_preview_options", "disable_web_page_preview", "caption_entities", "entities", "message_thread_id"]) delete b[k];
  if (isSplusId(b.chat_id)) b.chat_id = fromSplusId(Number(b.chat_id));
  if (isSplusId(b.user_id)) b.user_id = fromSplusId(Number(b.user_id));
  if (typeof b.text === "string") b.text = splusText(b.text);
  if (typeof b.caption === "string") b.caption = splusText(b.caption);
  if (b.reply_markup) b.reply_markup = splusMarkup(b.reply_markup, siteOf(env));
  return b;
}

export async function tg<T = any>(env: Env, method: string, body: Record<string, unknown> = {}): Promise<T> {
  if (isEitaaId(body.chat_id ?? body.user_id)) return (await eitaaTg(env, method, body)) as T; // ایتا: فقط متن (eitaa.ts)
  const r = route(env, body.chat_id ?? body.user_id);
  if (r.rubika) return (await rubikaTg(env, method, body)) as T;
  if ((r.bale || r.splus) && BALE_UNSUPPORTED.has(method)) return true as T; // دکمه‌ی منوی بازو در بله و سروش‌پلاس از BotFather تنظیم می‌شود
  // کلاینت‌های قدیمی بله از answerCallbackQuery پشتیبانی نمی‌کنند (شناسه‌ی callback با «1» شروع می‌شود)؛ متن را به‌صورت پیام عادی می‌فرستیم
  if (r.bale && method === "answerCallbackQuery" && String(body.callback_query_id ?? "").startsWith("1")) {
    const chat = env.BALE_CQ_CHAT;
    const text = typeof body.text === "string" ? body.text.trim() : "";
    if (text && chat) await tg(env, "sendMessage", { chat_id: chat, text: esc(text) }).catch(() => {});
    return true as T;
  }
  const call = async (payload: unknown) => {
    const res = await fetch(`${r.base}/bot${r.token}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(30_000),
    });
    return { res, j: (await res.json().catch(() => ({ ok: false, description: `HTTP ${res.status}` }))) as any };
  };
  let { res, j } = await call(r.bale ? baleParams(env, method, body) : r.splus ? splusParams(env, body) : body);
  // اگر بله دکمه‌ی web_app (Mini App) را نپذیرفت، همان پیام یک بار با دکمه‌ی لینک ساده ارسال می‌شود تا کاربر بی‌پاسخ نماند
  if (!j.ok && r.bale && hasWebApp(body.reply_markup)) ({ res, j } = await call(baleParams(env, method, body, false)));
  if (!j.ok) {
    const name = r.bale ? "bale" : r.splus ? "splus" : "telegram";
    console.error(`${name} api error`, method, JSON.stringify(j).slice(0, 400));
    if ((r.bale || r.splus) && BALE_OPTIONAL.has(method)) return true as T;
    throw apiError(r.bale ? "Bale" : r.splus ? "Splus" : "Telegram", method, j, res.status);
  }
  return j.result as T;
}

export async function sendMessage(env: Env, chatId: number, text: string, extra: Record<string, unknown> = {}) {
  try {
    return await tg<{ message_id: number }>(env, "sendMessage", { chat_id: chatId, text, parse_mode: "HTML", link_preview_options: { is_disabled: true }, ...extra });
  } catch (e) {
    // اگر تلگرام HTML پیام را نپذیرفت، همان متن را بدون قالب‌بندی بفرست تا پیام گم نشود
    if (!/parse entities|can't parse|parse_mode|entit/i.test(String(e))) throw e;
    const plain = text.replace(/<[^>]+>/g, "");
    return await tg<{ message_id: number }>(env, "sendMessage", { chat_id: chatId, text: plain, link_preview_options: { is_disabled: true }, ...extra });
  }
}

/** ویرایش پیام؛ خطای «message is not modified» نادیده گرفته می‌شود. */
export async function editMessage(env: Env, chatId: number, messageId: number, text: string, extra: Record<string, unknown> = {}) {
  try {
    await tg(env, "editMessageText", { chat_id: chatId, message_id: messageId, text, parse_mode: "HTML", ...extra });
  } catch (e) {
    if (!/not modified|is not modified|same content/i.test(String(e))) throw e;
  }
}

/** فرم مشترک ارسال فایل: تلگرام با parse_mode=HTML، بله با کپشن Markdown (بدون parse_mode) و شناسه‌ی اصلی چت */
function mediaForm(_env: Env, rt: Route, chatId: number, caption: string): FormData {
  const form = new FormData();
  form.append("chat_id", String(rt.bale ? fromBaleId(chatId) : rt.splus ? fromSplusId(chatId) : chatId));
  form.append("caption", rt.bale ? baleText(caption).slice(0, 1024) : rt.splus ? splusText(caption) : caption);
  if (!rt.bale) form.append("parse_mode", "HTML");
  return form;
}

const PPTX_MIME = "application/vnd.openxmlformats-officedocument.presentationml.presentation";

/** extra.reply_markup (مثلاً دکمه‌ی PDF) به‌صورت JSON در فرم فرستاده می‌شود؛ mime پیش‌فرض pptx است */
export async function sendDocument(env: Env, chatId: number, data: Uint8Array, filename: string, caption: string, extra: { reply_markup?: unknown; mime?: string } = {}) {
  if (isEitaaId(chatId)) throw new Error("Eitaa: ارسال فایل به چت پشتیبانی نمی‌شود");
  const rt = route(env, chatId);
  if (rt.rubika) { await rubikaSendFile(env, chatId, data, filename, caption, "File", extra.reply_markup); return; }
  const form = mediaForm(env, rt, chatId, caption);
  if (extra.reply_markup) form.append("reply_markup", JSON.stringify(rt.bale ? baleMarkup(extra.reply_markup, siteOf(env)) : rt.splus ? splusMarkup(extra.reply_markup, siteOf(env)) : extra.reply_markup));
  form.append("document", new Blob([data], { type: extra.mime ?? PPTX_MIME }), filename);
  const r = await fetch(`${rt.base}/bot${rt.token}/sendDocument`, {
    method: "POST", body: form, signal: AbortSignal.timeout(120_000),
  });
  const j = (await r.json().catch(() => ({ ok: false, description: `HTTP ${r.status}` }))) as any;
  if (!j.ok) throw apiError(rt.bale ? "Bale" : rt.splus ? "Splus" : "Telegram", "sendDocument", j, r.status);
}

/** ارسال فایل صوتی (پخش‌کننده‌ی تلگرام با عنوان و مدت). تلگرام رسماً MP3/M4A می‌خواهد (خروجی پیش‌فرض اکنون MP3 است)؛ اگر WAV را نپذیرفت، همان فایل به‌صورت سند فرستاده می‌شود (باز هم داخل تلگرام پخش می‌شود). */
export async function sendAudio(env: Env, chatId: number, data: Uint8Array, filename: string, caption: string, extra: { title?: string; performer?: string; duration?: number; mime?: string; reply_markup?: unknown } = {}) {
  const mime = extra.mime ?? (/\.mp3$/i.test(filename) ? "audio/mpeg" : "audio/wav");
  if (isEitaaId(chatId)) throw new Error("Eitaa: ارسال فایل به چت پشتیبانی نمی‌شود");
  const rt = route(env, chatId);
  // خواننده‌ی پیش‌فرض = آدرس سایت؛ و برای MP3 برچسب ID3 داخل خود فایل (برای ذخیره/ارسال به پخش‌کننده‌های دیگر)
  extra = { ...extra, performer: extra.performer || id3Site(env).host };
  if (/\.mp3$/i.test(filename)) data = tagMp3(env, data, extra.title || filename.replace(/\.mp3$/i, ""), extra.performer === id3Site(env).host ? undefined : extra.performer);
  if (rt.rubika) { // روبیکا: «Music» فقط mp3 می‌پذیرد؛ بقیه (مثل WAV) به‌صورت فایل می‌روند
    await rubikaSendFile(env, chatId, data, filename, caption, /\.mp3$/i.test(filename) ? "Music" : "File");
    return;
  }
  const form = mediaForm(env, rt, chatId, caption);
  if (extra.title) form.append("title", extra.title.slice(0, 200));
  if (extra.performer) form.append("performer", extra.performer.slice(0, 100));
  if (extra.duration) form.append("duration", String(extra.duration));
  if (extra.reply_markup) form.append("reply_markup", JSON.stringify(rt.splus ? splusMarkup(extra.reply_markup, siteOf(env)) : extra.reply_markup));
  form.append("audio", new Blob([data], { type: mime }), filename);
  try {
    const r = await fetch(`${rt.base}/bot${rt.token}/sendAudio`, { method: "POST", body: form, signal: AbortSignal.timeout(180_000) });
    const j = (await r.json().catch(() => ({ ok: false, description: `HTTP ${r.status}` }))) as any;
    if (j.ok) return;
    console.error(`${rt.bale ? "bale" : rt.splus ? "splus" : "telegram"} sendAudio`, String(j.description ?? r.status).slice(0, 200));
  } catch (e) {
    console.error(`${rt.bale ? "bale" : rt.splus ? "splus" : "telegram"} sendAudio`, String(e).slice(0, 200));
  }
  await sendDocument(env, chatId, data, filename, caption, { mime, ...(extra.reply_markup ? { reply_markup: extra.reply_markup } : {}) });
}

/** ارسال عکس (پیش‌نمایش داخل چت). سقف تلگرام: ۱۰ مگابایت و مجموع عرض+ارتفاع ≤ ۱۰۰۰۰ پیکسل */
export async function sendPhoto(env: Env, chatId: number, data: Uint8Array, filename: string, caption: string, mime = "image/png") {
  const rt = route(env, chatId);
  if (rt.rubika) { // روبیکا: «Image» فقط jpg/png/gif/webp تا ۱۰ مگابایت؛ غیر از آن به‌صورت فایل
    await rubikaSendFile(env, chatId, data, filename, caption, /\.(png|jpe?g|gif|webp)$/i.test(filename) && data.length <= 10 * 1024 * 1024 ? "Image" : "File");
    return;
  }
  const form = mediaForm(env, rt, chatId, caption);
  form.append("photo", new Blob([data], { type: mime }), filename);
  const r = await fetch(`${rt.base}/bot${rt.token}/sendPhoto`, {
    method: "POST", body: form, signal: AbortSignal.timeout(120_000),
  });
  const j = (await r.json().catch(() => ({ ok: false, description: `HTTP ${r.status}` }))) as any;
  if (!j.ok) throw apiError(rt.bale ? "Bale" : rt.splus ? "Splus" : "Telegram", "sendPhoto", j, r.status);
}

export const BOT_COMMANDS = [
  { command: "start", description: "شروع و راهنما" },
  { command: "menu", description: "منوی دکمه‌ای (اعتبار، تنظیمات، فایل‌ها و …)" },
  { command: "settings", description: "تنظیمات (تم، لحن، فونت، تعداد اسلاید)" },
  { command: "credit", description: "اعتبار باقی‌مانده و شارژ" },
  { command: "profile", description: "پروفایل: ثبت موبایل/ایمیل با کد تایید (۱ اعتبار هدیه)" },
  { command: "link", description: "وضعیت اتصال پلتفرم‌ها (با تایید شماره‌ی موبایل)" },
  { command: "files", description: "فایل‌های ۲۴ ساعت اخیر من" },
  { command: "app", description: "باز کردن اپ ساخت ارائه (Mini App)" },
  { command: "site", description: "ورود خودکار به سایت (پلن‌ها و پرداخت)" },
  { command: "support", description: "پشتیبانی هوشمند: سؤال و مشکلت را از دستیار بپرس" },
  { command: "invite", description: "دعوت دوستان (هر ۵ دعوتِ موفق = ۱ اعتبار پلاس)" },
  { command: "id", description: "نمایش شناسه‌ی عددی من" },
];

/** منوی دستورهای مدیر (فقط برای چت خود مدیرها ثبت می‌شود) */
export const ADMIN_COMMANDS = [
  ...BOT_COMMANDS,
  { command: "admin", description: "پنل مدیریت (دکمه‌ای)" },
  { command: "cancel", description: "لغو ورودی در انتظار پنل" },
  { command: "appver", description: "نسخه‌ی اپ اندروید (دکمه‌ای در پنل)" },
  { command: "apppush", description: "اعلان به اپ اندروید: /apppush عنوان | متن | لینک" },
];
