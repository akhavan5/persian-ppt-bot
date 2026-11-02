/**
 * تبدیل آپدیت روبیکا به آپدیت هم‌شکل تلگرام (بدون وابستگی به bot.ts تا جداگانه قابل آزمون باشد).
 * جزئیات در rubika.ts و rubika-format.ts.
 */
import type { Env } from "./env";
import { mimeOfName, rubikaMsgHandle, rubikaUserId } from "./rubika-format";
import { callbackHandle, rubikaCall, saveChat, type ChatRec } from "./rubika-api";

/** چت را اولین بار که دیده می‌شود ثبت می‌کند (نام از getChat)؛ بعدش فقط خواندن از KV */
async function ensureChat(env: Env, n: number, chat: string): Promise<ChatRec> {
  const old = (await env.KV.get(`rb:c:${n}`, "json").catch(() => null)) as ChatRec | null;
  if (old?.c === chat) return old;
  const rec: ChatRec = { c: chat };
  try {
    const d = await rubikaCall<any>(env, "getChat", { chat_id: chat });
    const c = d.chat ?? d;
    if (c.first_name) rec.f = String(c.first_name).slice(0, 64);
    if (c.last_name) rec.l = String(c.last_name).slice(0, 64);
    if (c.username) rec.u = String(c.username).slice(0, 64);
  } catch { /* نام اختیاری است */ }
  await saveChat(env, n, rec);
  return rec;
}

const fromOf = (n: number, r: ChatRec) => ({ id: n, is_bot: false, first_name: r.f ?? "", ...(r.l ? { last_name: r.l } : {}), ...(r.u ? { username: r.u } : {}) });

/** آپدیت روبیکا ← آپدیت هم‌شکل تلگرام؛ آپدیت‌های بی‌ربط (گروه، ویرایش، حذف و …) null می‌شوند */
export async function normalizeRubikaUpdate(env: Env, body: any): Promise<any | null> {
  // --- زدن دکمه‌ی شیشه‌ای (ReceiveInlineMessage) ---
  const im = body?.inline_message;
  if (im?.chat_id) {
    const chat = String(im.chat_id);
    const button = im.aux_data?.button_id;
    if (button === undefined || button === null || !chat.startsWith("b")) return null;
    const n = await rubikaUserId(chat);
    const rec = await ensureChat(env, n, chat);
    const h = await callbackHandle(env, chat, String(im.message_id));
    return {
      update_id: 0,
      callback_query: {
        id: `${chat}:${im.message_id}:${Date.now()}`,
        from: fromOf(n, rec),
        message: { message_id: h, chat: { id: n, type: "private" } },
        data: String(button),
      },
    };
  }

  // --- پیام یا شروع ربات (ReceiveUpdate) ---
  const up = body?.update;
  if (!up?.chat_id) return null;
  const chat = String(up.chat_id);
  if (!chat.startsWith("b")) return null; // فقط گفتگوی خصوصی با ربات (گروه/کانال نه)
  const m = up.new_message;
  let text = "";
  if (up.type === "StartedBot") text = "/start";
  else if (up.type === "NewMessage" && m) {
    if (m.sender_type && m.sender_type !== "User") return null;
    text = String(m.text ?? "");
  } else return null;

  const startId = m?.aux_data?.start_id ?? up.start_id;
  if (startId && (!text.trim() || /^\/start\s*$/i.test(text.trim()))) text = `/start ${startId}`;

  const n = await rubikaUserId(chat);
  // «شروع ربات» ممکن است هم به‌صورت StartedBot و هم پیام «/start» برسد؛ جواب فقط یک بار داده می‌شود
  if (/^\/start(\s|$)/i.test(text.trim())) {
    const k = `rb:st:${n}`;
    if (await env.KV.get(k).catch(() => null)) return null;
    await env.KV.put(k, "1", { expirationTtl: 15 }).catch(() => {});
  }
  const rec = await ensureChat(env, n, chat);
  const mid = String(m?.message_id ?? `${up.type}-${Date.now()}`);
  const msg: any = {
    message_id: await rubikaMsgHandle(chat, mid),
    date: Number(m?.time) || Math.floor(Date.now() / 1000),
    chat: { id: n, type: "private" },
    from: fromOf(n, rec),
  };
  const f = m?.file;
  if (f?.file_id) { // فایل (سند، عکس، ویس): به‌شکل document می‌رود؛ نوع از روی پسوند نام فایل فهمیده می‌شود (fileRefOf ویس/صوت را هم از پسوند می‌شناسد)
    const name = String(f.file_name ?? "file");
    msg.document = { file_id: String(f.file_id), file_name: name, mime_type: mimeOfName(name), file_size: Number(f.size) || undefined };
    if (text) msg.caption = text;
  } else {
    msg.text = text;
  }
  return { update_id: 0, message: msg };
}

