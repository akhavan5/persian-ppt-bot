/**
 * برنامک ایتا: ارسال پیام از طریق API «ایتایار» (https://eitaayar.ir/api/app/sendMessage) و پیام خوش‌آمدگویی.
 *
 * ایتا فقط ارسال «متن» را برای برنامک‌ها دارد (نه فایل)؛ پس فایل‌ها را کاربر داخل برنامک دانلود می‌کند و اعلان‌ها (آماده شدن ارائه، کد، پاداش دعوت)
 * متن ساده‌اند. ارسال فقط وقتی ممکن است که کاربر به برنامه «دسترسی ارسال پیام» داده باشد (allows_write_to_pm / requestWriteAccess).
 */
import type { Env } from "./env";
import { fromEitaaId, htmlToEitaaMd } from "./eitaa-format";

const API = "https://eitaayar.ir/api/app/sendMessage";

export const eitaaEnabled = (env: Env): boolean => !!env.EITAA_APP_TOKEN;
export const eitaaLink = (env: Env): string => (env.EITAA_MINIAPP_LINK || "").trim().replace(/\/+$/, "");

type Btn = { text?: string; url?: string; web_app?: { url?: string } };

/** دکمه‌های اینلاین تلگرام در ایتا وجود ندارند؛ دکمه‌ی لینک/اپ به یک خط لینک زیر پیام تبدیل می‌شود */
function buttonLines(env: Env, markup: unknown): string {
  const rows = (markup as { inline_keyboard?: Btn[][] } | undefined)?.inline_keyboard;
  if (!Array.isArray(rows)) return "";
  const out: string[] = [];
  for (const row of rows) for (const b of row) {
    const label = String(b.text ?? "").replace(/<[^>]+>/g, "").replace(/[\[\]]/g, "").trim();
    const url = b.web_app ? eitaaLink(env) : b.url ?? "";
    if (label && /^https?:\/\//i.test(url)) out.push(`[${label}](${url})`);
  }
  return out.join("\n");
}

/** ارسال به شناسه‌ی «جابه‌جاشده» (EITAA_ID_BASE)؛ خطا پرتاب می‌شود */
export async function eitaaSendMessage(env: Env, chatId: number, html: string, markup?: unknown): Promise<void> {
  if (!env.EITAA_APP_TOKEN) throw new Error("Eitaa: EITAA_APP_TOKEN تنظیم نشده است");
  const links = buttonLines(env, markup);
  const text = (htmlToEitaaMd(html) + (links ? "\n\n" + links : "")).slice(0, 4000);
  const res = await fetch(API, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token: env.EITAA_APP_TOKEN, chat_id: fromEitaaId(chatId), text }),
    signal: AbortSignal.timeout(20_000),
  });
  const j = (await res.json().catch(() => null)) as { ok?: boolean; result?: { message?: string } | string; description?: string; message?: string } | null;
  if (!j?.ok) {
    console.error("eitaa api error", res.status, JSON.stringify(j).slice(0, 300));
    // ایتا خطا را داخل result.message می‌گذارد (HTTP همیشه ۲۰۰)؛ بدون آن متن خطا «200» می‌شد و GONE_RE نمی‌توانست تشخیصش بدهد
    const rm = typeof j?.result === "object" ? j.result?.message : undefined;
    throw new Error(`Eitaa sendMessage: ${j?.description ?? j?.message ?? rm ?? res.status}`);
  }
}

/** متدهای تلگرامی که ربات صدا می‌زند: فقط sendMessage معنا دارد؛ بقیه (ویرایش، کلیک، منو، …) در ایتا بی‌اثرند */
export async function eitaaTg(env: Env, method: string, body: Record<string, unknown>): Promise<unknown> {
  if (method !== "sendMessage") return true;
  await eitaaSendMessage(env, Number(body.chat_id), String(body.text ?? ""), body.reply_markup);
  return { message_id: 0 };
}

/** پیام خوش‌آمدگویی اولین ورود (الزام انتشار در مرکز برنامک‌ها: برنامک بعد از اولین ورود در تب برنامک‌ها دیده شود).
 *  برای هر کاربر فقط یک بار؛ اگر ارسال نشد (هنوز دسترسی نداده) نشانگر برداشته می‌شود تا بعداً دوباره امتحان شود. */
export async function eitaaWelcome(env: Env, eitaaId: number): Promise<boolean> {
  const key = `ewel:${eitaaId}`;
  if (await env.KV.get(key).catch(() => null)) return false;
  await env.KV.put(key, "1");
  try {
    await eitaaSendMessage(env, eitaaId,
      "👋 به <b>پاورپوینت‌ساز فارسی</b> خوش آمدی!\n\nموضوع یا متن را بده تا با هوش مصنوعی یک ارائه‌ی کامل فارسی (PPTX) برایت بسازم؛ بدون نیاز به دانش طراحی.\n" +
      "فایل‌های ساخته‌شده ۲۴ ساعت داخل برنامک نگه داشته می‌شوند.",
      { inline_keyboard: [[{ text: "🚀 ساخت ارائه", web_app: { url: eitaaLink(env) } }]] });
    return true;
  } catch (e) {
    await env.KV.delete(key).catch(() => {});
    console.error("eitaa welcome", String(e).slice(0, 200));
    return false;
  }
}
