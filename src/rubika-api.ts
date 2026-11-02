/**
 * لایه‌ی ارسال به روبیکا: متدهای «شبیه تلگرام» که بقیه‌ی کد صدا می‌زند (tg() در telegram.ts) به API روبیکا
 * (https://botapi.rubika.ir/v3/<token>/<method>) ترجمه می‌شوند. فقط از env و rubika-format.ts استفاده می‌کند
 * (بدون import از bot.ts/telegram.ts) تا وابستگی دایره‌ای ساخته نشود.
 *
 * نگاشت‌ها در KV (D1) نگه داشته می‌شوند:
 *  rb:c:<شناسه‌ی عددی چت> ← { c: شناسه‌ی چت روبیکا (b0…), f/l/u: نام، نام‌خانوادگی، نام‌کاربری }   (بدون انقضا؛ برای ارسال به کاربر)
 *  rb:m:<دستگیره‌ی پیام>  ← { c: چت, m: شناسه‌ی اصلی پیام, k: ۱ اگر دکمه دارد }                    (۷ روز؛ برای ویرایش/حذف پیام)
 *  rb:a:<دستگیره‌ی جدید>  ← دستگیره‌ی قبلی؛ وقتی ویرایش دکمه ممکن نبود و پیام حذف و دوباره فرستاده شد، کارت قدیمی همان دستگیره را نگه می‌دارد
 */
import type { Env } from "./env";
import { RUBIKA_API_DEFAULT, hasLinkButton, rubikaKeypad, rubikaMsgHandle, rubikaText, type RubikaKeypad } from "./rubika-format";

export const rubikaEnabled = (env: Env): boolean => !!env.RUBIKA_BOT_TOKEN;
const siteOf = (env: Env) => (env.SITE_URL || "https://pptsaz.ir").replace(/\/+$/, "");
const MSG_TTL = 7 * 86400;

/** یک فراخوانی API روبیکا (همه‌ی متدها POST با JSON). پاسخ موفق: { status: "OK", data: {...} } */
export async function rubikaCall<T = any>(env: Env, method: string, body: Record<string, unknown> = {}, timeoutMs = 30_000): Promise<T> {
  const base = (env.RUBIKA_API_BASE || RUBIKA_API_DEFAULT).replace(/\/+$/, "");
  const res = await fetch(`${base}/v3/${env.RUBIKA_BOT_TOKEN ?? ""}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const j = (await res.json().catch(() => ({ status: `HTTP_${res.status}` }))) as any;
  if (j?.status !== "OK") {
    console.error("rubika api error", method, JSON.stringify(j).slice(0, 400));
    throw new Error(`Rubika ${method}: ${j?.status ?? res.status}${j?.dev_message ? ` ${String(j.dev_message).slice(0, 160)}` : ""}`);
  }
  return (j.data ?? {}) as T;
}

// ---------- نگاشت چت و پیام ----------
export interface ChatRec { c: string; f?: string; l?: string; u?: string }
interface MsgRec { c: string; m: string; k: 0 | 1 }

const chatCache = new Map<number, string>();
export async function chatGuidOf(env: Env, n: number): Promise<string> {
  const hit = chatCache.get(n);
  if (hit) return hit;
  const r = (await env.KV.get(`rb:c:${n}`, "json")) as ChatRec | null;
  if (!r?.c) throw new Error("Rubika: chat unknown");
  chatCache.set(n, r.c);
  return r.c;
}
export async function saveChat(env: Env, n: number, rec: ChatRec): Promise<void> {
  chatCache.set(n, rec.c);
  await env.KV.put(`rb:c:${n}`, JSON.stringify(rec));
}

const getMsg = async (env: Env, h: number): Promise<MsgRec | null> => (await env.KV.get(`rb:m:${h}`, "json")) as MsgRec | null;
const putMsg = (env: Env, h: number, rec: MsgRec) => env.KV.put(`rb:m:${h}`, JSON.stringify(rec), { expirationTtl: MSG_TTL });
async function newHandle(env: Env, chat: string, mid: string, k: 0 | 1): Promise<number> {
  const h = await rubikaMsgHandle(chat, mid);
  await putMsg(env, h, { c: chat, m: mid, k });
  return h;
}
/** دستگیره‌ی پیامی که کاربر روی دکمه‌اش زده (از آپدیت ورودی)؛ اگر پیام بعد از ویرایش دوباره فرستاده شده باشد، دستگیره‌ی کارت اول برمی‌گردد */
export async function callbackHandle(env: Env, chat: string, mid: string): Promise<number> {
  const h = await rubikaMsgHandle(chat, mid);
  const alias = Number(await env.KV.get(`rb:a:${h}`).catch(() => null));
  if (Number.isSafeInteger(alias) && alias > 0) return alias;
  if (!(await getMsg(env, h).catch(() => null))) await putMsg(env, h, { c: chat, m: mid, k: 1 }).catch(() => {});
  return h;
}

// ---------- ارسال ----------
const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n) : s);

/** پیام متنی با دکمه؛ اگر روبیکا دکمه‌ی لینک را نپذیرفت، یک بار با لینک‌های داخل متن دوباره می‌فرستد */
async function sendText(env: Env, chat: string, html: string, markup: unknown, replyTo?: string): Promise<{ mid: string; k: 0 | 1 }> {
  const attempt = async (links: "button" | "text") => {
    const { keypad, extra } = rubikaKeypad(markup, siteOf(env), links);
    const text = clip(rubikaText(html) + (extra ? `\n\n${extra}` : ""), 4096) || "…";
    const d = await rubikaCall<{ message_id?: string | number }>(env, "sendMessage", {
      chat_id: chat, text, ...(keypad ? { inline_keypad: keypad } : {}), ...(replyTo ? { reply_to_message_id: replyTo } : {}),
    });
    return { mid: String(d.message_id ?? ""), k: (keypad ? 1 : 0) as 0 | 1 };
  };
  try { return await attempt("button"); } catch (e) {
    if (!hasLinkButton(markup)) throw e;
    return await attempt("text");
  }
}

let keypadMethod: string | null = null; // نام متدی که ویرایش دکمه با آن جواب داد (مستندات روبیکا دو نام آورده)
async function editKeypad(env: Env, chat: string, mid: string, keypad: RubikaKeypad): Promise<boolean> {
  for (const m of keypadMethod ? [keypadMethod] : ["editMessageKeypad", "editInlineKeypad"]) {
    try { await rubikaCall(env, m, { chat_id: chat, message_id: mid, inline_keypad: keypad }); keypadMethod = m; return true; } catch { /* نام بعدی */ }
  }
  keypadMethod = null;
  return false;
}

/**
 * دکمه‌های پیام را مثل تلگرام «جایگزین» می‌کند (markup خالی/نبودن = حذف دکمه‌ها).
 * اگر ویرایش دکمه شدنی نبود و متن هم در دست بود، پیام حذف و با دکمه‌های تازه دوباره فرستاده می‌شود و دستگیره‌ی قبلی به آن اشاره می‌کند.
 */
async function applyKeypad(env: Env, h: number, rec: MsgRec, markup: unknown, html?: string): Promise<void> {
  const { keypad } = rubikaKeypad(markup, siteOf(env), "button");
  if (keypad) {
    if (await editKeypad(env, rec.c, rec.m, keypad)) { if (!rec.k) await putMsg(env, h, { ...rec, k: 1 }); return; }
    if (html === undefined) return;
    await rubikaCall(env, "deleteMessage", { chat_id: rec.c, message_id: rec.m }).catch(() => {});
    const s = await sendText(env, rec.c, html, markup);
    await putMsg(env, h, { c: rec.c, m: s.mid, k: s.k });
    await env.KV.put(`rb:a:${await rubikaMsgHandle(rec.c, s.mid)}`, String(h), { expirationTtl: MSG_TTL });
    return;
  }
  if (rec.k && (await editKeypad(env, rec.c, rec.m, { rows: [] }))) await putMsg(env, h, { ...rec, k: 0 });
}

/** فایل را آپلود و با sendFile می‌فرستد (requestSendFile ← آدرس آپلود ← file_id). برمی‌گرداند: دستگیره‌ی پیام */
export async function rubikaSendFile(
  env: Env, chatId: number, data: Uint8Array, filename: string, caption: string,
  type: "File" | "Image" | "Music", markup?: unknown,
): Promise<number> {
  const chat = await chatGuidOf(env, chatId);
  const { upload_url } = await rubikaCall<{ upload_url?: string }>(env, "requestSendFile", { type });
  if (!upload_url) throw new Error("Rubika requestSendFile: no upload_url");
  const form = new FormData();
  form.append("file", new Blob([data]), filename);
  const up = await fetch(upload_url, { method: "POST", body: form, signal: AbortSignal.timeout(120_000) });
  const uj = (await up.json().catch(() => ({}))) as any;
  const fileId = uj?.data?.file_id ?? uj?.file_id;
  if (!fileId) { console.error("rubika upload error", up.status, JSON.stringify(uj).slice(0, 300)); throw new Error(`Rubika upload: ${uj?.status ?? up.status}`); }
  const attempt = async (links: "button" | "text") => {
    const { keypad, extra } = rubikaKeypad(markup, siteOf(env), links);
    const text = clip(rubikaText(caption) + (extra ? `\n\n${extra}` : ""), 1024);
    const d = await rubikaCall<{ message_id?: string | number }>(env, "sendFile", {
      chat_id: chat, file_id: fileId, ...(text ? { text } : {}), ...(keypad ? { inline_keypad: keypad } : {}),
    }, 60_000);
    return { mid: String(d.message_id ?? ""), k: (keypad ? 1 : 0) as 0 | 1 };
  };
  let s: { mid: string; k: 0 | 1 };
  try { s = await attempt("button"); } catch (e) {
    if (!hasLinkButton(markup)) throw e;
    s = await attempt("text");
  }
  return await newHandle(env, chat, s.mid, s.k);
}

// ---------- ترجمه‌ی متدهای تلگرام ----------
/** tg(env, method, body) برای گیرنده‌ی روبیکا؛ خروجی هم‌شکل تلگرام است (مثلاً { message_id } عددی) */
export async function rubikaTg(env: Env, method: string, body: Record<string, unknown>): Promise<any> {
  switch (method) {
    // روبیکا معادل ندارد یا برای تجربه‌ی کاربر ضروری نیست
    case "answerCallbackQuery": case "sendChatAction": case "setChatMenuButton": case "deleteMyCommands": case "editMessageCaption":
      return true;

    case "getMe": {
      const d = await rubikaCall<any>(env, "getMe");
      const b = d.bot ?? d;
      return { id: b.bot_id, username: b.username, first_name: b.bot_title };
    }
    case "setMyCommands": {
      if (body.scope) return true; // منوی مخصوص چت مدیر در روبیکا نیست
      const cmds = ((body.commands as { command: string; description: string }[]) ?? []).map((c) => ({ command: c.command, description: c.description }));
      await rubikaCall(env, "setCommands", { bot_commands: cmds });
      return true;
    }
    case "getFile": { // روبیکا آدرس کامل دانلود می‌دهد؛ fileUrl() آن را همان‌طور برمی‌گرداند
      const d = await rubikaCall<{ download_url?: string }>(env, "getFile", { file_id: body.file_id });
      return { file_path: d.download_url };
    }
    case "sendMessage": {
      const chat = await chatGuidOf(env, Number(body.chat_id));
      const replyTo = body.reply_to_message_id ? (await getMsg(env, Number(body.reply_to_message_id)))?.m : undefined;
      const s = await sendText(env, chat, String(body.text ?? ""), body.reply_markup, replyTo);
      return { message_id: await newHandle(env, chat, s.mid, s.k) };
    }
    case "editMessageText": {
      const h = Number(body.message_id);
      const rec = await getMsg(env, h);
      if (!rec) throw new Error("Rubika editMessageText: message unknown or expired");
      const html = String(body.text ?? "");
      const hasMarkup = body.reply_markup !== undefined;
      try {
        await rubikaCall(env, "editMessageText", { chat_id: rec.c, message_id: rec.m, text: clip(rubikaText(html), 4096) || "…" });
      } catch (e) {
        if (!hasMarkup) throw e; // متن بدون تغییر + فقط دکمه‌ی تازه: خطای متن نادیده گرفته می‌شود
      }
      // مثل تلگرام: ویرایش بدون reply_markup یعنی دکمه‌ها برداشته شوند
      await applyKeypad(env, h, rec, body.reply_markup, html);
      return true;
    }
    case "editMessageReplyMarkup": {
      const h = Number(body.message_id);
      const rec = await getMsg(env, h);
      if (!rec) return true;
      await applyKeypad(env, h, rec, body.reply_markup).catch((e) => console.error("rubika keypad", e instanceof Error ? e.message : e));
      return true;
    }
    case "deleteMessage": {
      const rec = await getMsg(env, Number(body.message_id));
      if (!rec) return true;
      await rubikaCall(env, "deleteMessage", { chat_id: rec.c, message_id: rec.m });
      return true;
    }
    default:
      throw new Error(`Rubika: ${method} is not supported`);
  }
}
