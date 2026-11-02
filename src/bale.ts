/**
 * ربات بله: دریافت وبهوک، تبدیل آپدیت بله به شکل آپدیت تلگرام و ثبت وبهوک.
 *
 * تمام منطق ربات (منوها، ویزارد، اعتبار، Workflowها) همان bot.ts است؛ این ماژول فقط
 *  ۱) شناسه‌های کاربر/چت بله را با BALE_ID_BASE جمع می‌کند تا با تلگرام قاطی نشود (bale-format.ts)،
 *  ۲) آپدیت را با env علامت‌خورده‌ی PLATFORM="bale" به handleUpdate می‌دهد؛ ارسال پاسخ‌ها در telegram.ts از روی شناسه به بله می‌رود.
 * بله هدر محرمانه‌ی وبهوک ندارد (setWebhook فقط url می‌گیرد)، پس راز در خود آدرس است: /bale/<راز>.
 */
import type { Env } from "./env";
import { handleUpdate } from "./bot";
import { BOT_COMMANDS, sendMessage, tg } from "./telegram";
import { normalizeBaleUpdate } from "./bale-format";

export const baleEnabled = (env: Env): boolean => !!env.BALE_BOT_TOKEN;

/** راز آدرس وبهوک؛ فقط حروف/عدد/خط‌تیره/زیرخط و حداقل ۱۶ نویسه پذیرفته می‌شود (وگرنه وبهوک بله خاموش می‌ماند) */
export function baleSecret(env: Env): string {
  const s = (env.BALE_WEBHOOK_SECRET || env.TELEGRAM_WEBHOOK_SECRET || "").trim();
  return /^[A-Za-z0-9_-]{16,128}$/.test(s) ? s : "";
}

/** آدرس کامل وبهوک که به بله داده می‌شود (دامنه‌ی سایت؛ بله از ایران به آن می‌زند) */
export function baleWebhookUrl(env: Env): string {
  const base = (env.BALE_WEBHOOK_BASE || env.SITE_URL || "https://pptsaz.ir").replace(/\/+$/, "");
  return `${base}/bale/${baleSecret(env)}`;
}

/** پردازش یک آپدیت بله (در ctx.waitUntil صدا زده می‌شود) */
export async function handleBaleUpdate(env: Env, update: unknown): Promise<void> {
  const u = normalizeBaleUpdate(update);
  if (!u) return;
  const benv: Env = { ...env, PLATFORM: "bale" };
  try {
    await handleUpdate(benv, u);
  } catch (e) {
    console.error("handleBaleUpdate", e instanceof Error ? e.message.slice(0, 300) : e);
    const chatId = u.message?.chat?.id ?? u.callback_query?.message?.chat?.id;
    if (chatId) await sendMessage(benv, chatId, "⚠️ مشکلی پیش آمد. چند لحظه بعد دوباره امتحان کن.").catch(() => {});
  }
}

/** ثبت وبهوک و دستورها روی بله (از /bale-setup صدا زده می‌شود) */
export async function setupBale(env: Env): Promise<{ ok: boolean; error?: string; bot?: string; webhook?: string; pending?: number }> {
  if (!baleEnabled(env)) return { ok: false, error: "BALE_BOT_TOKEN تنظیم نشده است." };
  if (!baleSecret(env)) return { ok: false, error: "BALE_WEBHOOK_SECRET (یا TELEGRAM_WEBHOOK_SECRET) باید فقط شامل حروف انگلیسی/عدد/خط‌تیره/زیرخط و حداقل ۱۶ نویسه باشد." };
  const benv: Env = { ...env, PLATFORM: "bale" };
  try {
    const me = await tg<{ username?: string }>(benv, "getMe");
    await tg(benv, "setWebhook", { url: baleWebhookUrl(env) });
    await tg(benv, "setMyCommands", { commands: BOT_COMMANDS }).catch(() => {}); // در مستندات بله نیست؛ اگر نبود بی‌اثر است
    const info = await tg<{ url?: string; pending_update_count?: number }>(benv, "getWebhookInfo").catch(() => null);
    const host = (() => { try { return new URL(info?.url || baleWebhookUrl(env)).host; } catch { return ""; } })();
    return { ok: true, bot: me.username ? `@${me.username}` : undefined, webhook: `https://${host}/bale/…`, pending: info?.pending_update_count };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message.slice(0, 300) : String(e) };
  }
}
