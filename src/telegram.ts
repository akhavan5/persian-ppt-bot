import type { Env } from "./env";
import { BALE_API_DEFAULT, baleMarkup, baleText, fromBaleId, isBaleId } from "./bale-format";

const apiBase = (env: Env) => env.TELEGRAM_API_BASE || "https://api.telegram.org";

export const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// ---------- تلگرام یا بله؟ ----------
// شناسه‌ی گیرنده‌ی بله با BALE_ID_BASE جمع شده (bale-format.ts)، پس هر ارسال فقط از روی chat_id مسیر خودش را پیدا می‌کند.
// متدهای بدون chat_id (answerCallbackQuery، getFile، getMe) فقط داخل پردازش آپدیت بله صدا زده می‌شوند و از پرچم env.PLATFORM می‌فهمند.
interface Route { bale: boolean; base: string; token: string }
function route(env: Env, chatId?: unknown): Route {
  const known = chatId !== undefined && chatId !== null && chatId !== "";
  const bale = known ? isBaleId(chatId) : env.PLATFORM === "bale";
  return bale
    ? { bale, base: (env.BALE_API_BASE || BALE_API_DEFAULT).replace(/\/+$/, ""), token: env.BALE_BOT_TOKEN ?? "" }
    : { bale, base: apiBase(env), token: env.TELEGRAM_BOT_TOKEN };
}
/** نسخه‌ی env برای پردازش چیزی که از بله آمده (مثلاً خواندن فایل در Workflow)؛ برای گیرنده‌ی تلگرام همان env برمی‌گردد */
export const envFor = (env: Env, chatId: unknown): Env => (isBaleId(chatId) && env.PLATFORM !== "bale" ? { ...env, PLATFORM: "bale" } : env);
/** آدرس دانلود فایل (بعد از getFile)؛ پلتفرم از پرچم env.PLATFORM می‌آید (getFile شناسه‌ی چت ندارد) */
export const fileUrl = (env: Env, filePath: string): string => {
  const r = route(env);
  return `${r.base}/file/bot${r.token}/${filePath}`;
};
const siteOf = (env: Env) => (env.SITE_URL || "https://pptsaz.ir").replace(/\/+$/, "");

/** متدهایی که در مستندات بله نیامده یا برای تجربه‌ی کاربر ضروری نیستند؛ خطایشان بی‌صدا نادیده گرفته می‌شود */
const BALE_OPTIONAL = new Set(["answerCallbackQuery", "editMessageReplyMarkup", "editMessageCaption", "setMyCommands", "deleteMyCommands", "setChatMenuButton", "sendChatAction"]);

/** پارامترهای تلگرام را به پارامترهای قابل‌فهم برای بله تبدیل می‌کند (بدون parse_mode: متن HTML به Markdown بله تبدیل می‌شود) */
function baleParams(env: Env, method: string, body: Record<string, unknown>): Record<string, unknown> {
  const b: Record<string, unknown> = { ...body };
  for (const k of ["parse_mode", "link_preview_options", "disable_web_page_preview", "caption_entities", "entities", "message_thread_id"]) delete b[k];
  if (isBaleId(b.chat_id)) b.chat_id = fromBaleId(Number(b.chat_id));
  if (isBaleId(b.user_id)) b.user_id = fromBaleId(Number(b.user_id));
  if (typeof b.text === "string") b.text = baleText(b.text).slice(0, 4096);
  if (typeof b.caption === "string" && method !== "editMessageCaption") b.caption = baleText(b.caption).slice(0, 1024);
  if (b.reply_markup) b.reply_markup = baleMarkup(b.reply_markup, siteOf(env));
  return b;
}

export async function tg<T = any>(env: Env, method: string, body: Record<string, unknown> = {}): Promise<T> {
  const r = route(env, body.chat_id ?? body.user_id);
  const payload = r.bale ? baleParams(env, method, body) : body;
  const res = await fetch(`${r.base}/bot${r.token}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(30_000),
  });
  const j = (await res.json().catch(() => ({ ok: false, description: `HTTP ${res.status}` }))) as any;
  if (!j.ok) {
    const name = r.bale ? "bale" : "telegram";
    console.error(`${name} api error`, method, JSON.stringify(j).slice(0, 400));
    if (r.bale && BALE_OPTIONAL.has(method)) return true as T;
    throw new Error(`${r.bale ? "Bale" : "Telegram"} ${method}: ${j.description ?? res.status}`);
  }
  return j.result as T;
}

export async function sendMessage(env: Env, chatId: number, text: string, extra: Record<string, unknown> = {}) {
  try {
    return await tg<{ message_id: number }>(env, "sendMessage", { chat_id: chatId, text, parse_mode: "HTML", link_preview_options: { is_disabled: true }, ...extra });
  } catch (e) {
    // اگر تلگرام HTML پیام را نپذیرفت، همان متن را بدون قالب‌بندی بفرست تا پیام گم نشود
    if (!String(e).includes("parse entities")) throw e;
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
  form.append("chat_id", String(rt.bale ? fromBaleId(chatId) : chatId));
  form.append("caption", rt.bale ? baleText(caption).slice(0, 1024) : caption);
  if (!rt.bale) form.append("parse_mode", "HTML");
  return form;
}

const PPTX_MIME = "application/vnd.openxmlformats-officedocument.presentationml.presentation";

/** extra.reply_markup (مثلاً دکمه‌ی PDF) به‌صورت JSON در فرم فرستاده می‌شود؛ mime پیش‌فرض pptx است */
export async function sendDocument(env: Env, chatId: number, data: Uint8Array, filename: string, caption: string, extra: { reply_markup?: unknown; mime?: string } = {}) {
  const rt = route(env, chatId);
  const form = mediaForm(env, rt, chatId, caption);
  if (extra.reply_markup) form.append("reply_markup", JSON.stringify(rt.bale ? baleMarkup(extra.reply_markup, siteOf(env)) : extra.reply_markup));
  form.append("document", new Blob([data], { type: extra.mime ?? PPTX_MIME }), filename);
  const r = await fetch(`${rt.base}/bot${rt.token}/sendDocument`, {
    method: "POST", body: form, signal: AbortSignal.timeout(120_000),
  });
  const j = (await r.json().catch(() => ({ ok: false, description: `HTTP ${r.status}` }))) as any;
  if (!j.ok) throw new Error(`${rt.bale ? "Bale" : "Telegram"} sendDocument: ${j.description ?? r.status}`);
}

/** ارسال فایل صوتی (پخش‌کننده‌ی تلگرام با عنوان و مدت). تلگرام رسماً MP3/M4A می‌خواهد؛ اگر WAV را نپذیرفت، همان فایل به‌صورت سند فرستاده می‌شود (باز هم داخل تلگرام پخش می‌شود). */
export async function sendAudio(env: Env, chatId: number, data: Uint8Array, filename: string, caption: string, extra: { title?: string; performer?: string; duration?: number; mime?: string } = {}) {
  const mime = extra.mime ?? "audio/wav";
  const rt = route(env, chatId);
  const form = mediaForm(env, rt, chatId, caption);
  if (extra.title) form.append("title", extra.title.slice(0, 200));
  if (extra.performer) form.append("performer", extra.performer.slice(0, 100));
  if (extra.duration) form.append("duration", String(extra.duration));
  form.append("audio", new Blob([data], { type: mime }), filename);
  try {
    const r = await fetch(`${rt.base}/bot${rt.token}/sendAudio`, { method: "POST", body: form, signal: AbortSignal.timeout(180_000) });
    const j = (await r.json().catch(() => ({ ok: false, description: `HTTP ${r.status}` }))) as any;
    if (j.ok) return;
    console.error(`${rt.bale ? "bale" : "telegram"} sendAudio`, String(j.description ?? r.status).slice(0, 200));
  } catch (e) {
    console.error(`${rt.bale ? "bale" : "telegram"} sendAudio`, String(e).slice(0, 200));
  }
  await sendDocument(env, chatId, data, filename, caption, { mime });
}

/** ارسال عکس (پیش‌نمایش داخل چت). سقف تلگرام: ۱۰ مگابایت و مجموع عرض+ارتفاع ≤ ۱۰۰۰۰ پیکسل */
export async function sendPhoto(env: Env, chatId: number, data: Uint8Array, filename: string, caption: string, mime = "image/png") {
  const rt = route(env, chatId);
  const form = mediaForm(env, rt, chatId, caption);
  form.append("photo", new Blob([data], { type: mime }), filename);
  const r = await fetch(`${rt.base}/bot${rt.token}/sendPhoto`, {
    method: "POST", body: form, signal: AbortSignal.timeout(120_000),
  });
  const j = (await r.json().catch(() => ({ ok: false, description: `HTTP ${r.status}` }))) as any;
  if (!j.ok) throw new Error(`${rt.bale ? "Bale" : "Telegram"} sendPhoto: ${j.description ?? r.status}`);
}

export const BOT_COMMANDS = [
  { command: "start", description: "شروع و راهنما" },
  { command: "menu", description: "منوی دکمه‌ای (اعتبار، تنظیمات، فایل‌ها و …)" },
  { command: "settings", description: "تنظیمات (تم، لحن، فونت، تعداد اسلاید)" },
  { command: "credit", description: "اعتبار باقی‌مانده و شارژ" },
  { command: "files", description: "فایل‌های ۲۴ ساعت اخیر من" },
  { command: "app", description: "باز کردن اپ ساخت ارائه (Mini App)" },
  { command: "site", description: "ورود خودکار به سایت (پلن‌ها و پرداخت)" },
  { command: "invite", description: "دعوت دوستان (هر ۱۰ دعوت = ۱ اعتبار پلاس)" },
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
