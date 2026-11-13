/**
 * ربات سروش‌پلاس: دریافت وبهوک، تبدیل آپدیت به شکل آپدیت تلگرام و ثبت وبهوک.
 *
 * تمام منطق ربات (منوها، ویزارد، اعتبار، Workflowها) همان bot.ts است؛ این ماژول فقط
 *  ۱) شناسه‌های کاربر/چت را با SPLUS_ID_BASE جمع می‌کند تا با بقیه‌ی پلتفرم‌ها قاطی نشود (splus-format.ts)،
 *  ۲) آپدیت را با env علامت‌خورده‌ی PLATFORM="splus" به handleUpdate می‌دهد؛ ارسال پاسخ‌ها در telegram.ts از روی شناسه به سروش‌پلاس می‌رود.
 * سروش‌پلاس هدر محرمانه‌ی وبهوک ندارد (setWebhook فقط url می‌گیرد)، پس راز در خود آدرس است: /splus/<راز>.
 * وبهوک فقط روی پورت‌های ۴۴۳، ۸۰، ۸۸ و ۸۴۴۳ کار می‌کند و آدرس باید از اینترنت (برای سرورهای سروش‌پلاس) قابل دسترس باشد.
 */
import type { Env } from "./env";
import { handleUpdate } from "./bot";
import { BOT_COMMANDS, sendMessage, tg } from "./telegram";
import { normalizeSplusUpdate } from "./splus-format";

export const splusEnabled = (env: Env): boolean => !!env.SPLUS_BOT_TOKEN;

/** راز آدرس وبهوک: همان TELEGRAM_WEBHOOK_SECRET */
export function splusSecret(env: Env): string {
  return (env.TELEGRAM_WEBHOOK_SECRET || "").trim();
}

/** آدرس کامل وبهوک که به سروش‌پلاس داده می‌شود */
export function splusWebhookUrl(env: Env): string {
  const base = (env.SPLUS_WEBHOOK_BASE || env.SITE_URL || "https://pptsaz.ir").replace(/\/+$/, "");
  return `${base}/splus/${splusSecret(env)}`;
}

/** پردازش یک آپدیت سروش‌پلاس (در ctx.waitUntil صدا زده می‌شود) */
export async function handleSplusUpdate(env: Env, update: unknown): Promise<void> {
  const u = normalizeSplusUpdate(update);
  if (!u) return;
  const senv: Env = { ...env, PLATFORM: "splus" };
  try {
    await handleUpdate(senv, u);
  } catch (e) {
    console.error("handleSplusUpdate", e instanceof Error ? e.message.slice(0, 300) : e);
    const chatId = u.message?.chat?.id ?? u.callback_query?.message?.chat?.id;
    if (chatId) await sendMessage(senv, chatId, "⚠️ مشکلی پیش آمد. چند لحظه بعد دوباره امتحان کن.").catch(() => {});
  }
}

/** ثبت وبهوک و دستورها روی سروش‌پلاس (از /splus-setup صدا زده می‌شود) */
export async function setupSplus(env: Env): Promise<{ ok: boolean; error?: string; bot?: string; webhook?: string; pending?: number; last_error?: string }> {
  if (!splusEnabled(env)) return { ok: false, error: "SPLUS_BOT_TOKEN تنظیم نشده است." };
  if (!splusSecret(env)) return { ok: false, error: "TELEGRAM_WEBHOOK_SECRET تنظیم نشده است." };
  const senv: Env = { ...env, PLATFORM: "splus" };
  try {
    const me = await tg<{ username?: string }>(senv, "getMe");
    await tg(senv, "setWebhook", { url: splusWebhookUrl(env), allowed_updates: ["message", "callback_query"] });
    await tg(senv, "setMyCommands", { commands: BOT_COMMANDS }).catch((e) => console.error("splus setMyCommands", String(e).slice(0, 200))); // دستورها اختیاری‌اند؛ خطایشان وبهوک را خراب نکند
    const info = await tg<{ url?: string; pending_update_count?: number; last_error_message?: string }>(senv, "getWebhookInfo").catch(() => null);
    const host = (() => { try { return new URL(info?.url || splusWebhookUrl(env)).host; } catch { return ""; } })();
    return { ok: true, bot: me.username ? `@${me.username}` : undefined, webhook: `https://${host}/splus/…`, pending: info?.pending_update_count, last_error: info?.last_error_message };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message.slice(0, 300) : String(e) };
  }
}
