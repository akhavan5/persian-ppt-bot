import type { Env } from "./env";

const apiBase = (env: Env) => env.TELEGRAM_API_BASE || "https://api.telegram.org";

export const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export async function tg<T = any>(env: Env, method: string, body: Record<string, unknown> = {}): Promise<T> {
  const r = await fetch(`${apiBase(env)}/bot${env.TELEGRAM_BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  const j = (await r.json()) as any;
  if (!j.ok) throw new Error(`Telegram ${method}: ${j.description ?? r.status}`);
  return j.result as T;
}

export const sendMessage = (env: Env, chatId: number, text: string, extra: Record<string, unknown> = {}) =>
  tg<{ message_id: number }>(env, "sendMessage", { chat_id: chatId, text, parse_mode: "HTML", link_preview_options: { is_disabled: true }, ...extra });

/** ویرایش پیام؛ خطای «message is not modified» نادیده گرفته می‌شود. */
export async function editMessage(env: Env, chatId: number, messageId: number, text: string, extra: Record<string, unknown> = {}) {
  try {
    await tg(env, "editMessageText", { chat_id: chatId, message_id: messageId, text, parse_mode: "HTML", ...extra });
  } catch (e) {
    if (!String(e).includes("not modified")) throw e;
  }
}

export async function sendDocument(env: Env, chatId: number, data: Uint8Array, filename: string, caption: string) {
  const form = new FormData();
  form.append("chat_id", String(chatId));
  form.append("caption", caption);
  form.append("parse_mode", "HTML");
  form.append("document", new Blob([data], {
    type: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  }), filename);
  const r = await fetch(`${apiBase(env)}/bot${env.TELEGRAM_BOT_TOKEN}/sendDocument`, {
    method: "POST", body: form, signal: AbortSignal.timeout(120_000),
  });
  const j = (await r.json()) as any;
  if (!j.ok) throw new Error(`Telegram sendDocument: ${j.description ?? r.status}`);
}

export const BOT_COMMANDS = [
  { command: "start", description: "شروع و راهنما" },
  { command: "settings", description: "تنظیمات (تم، لحن، فونت، تعداد اسلاید)" },
  { command: "id", description: "نمایش شناسه‌ی عددی من" },
];
