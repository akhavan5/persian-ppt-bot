/**
 * ربات روبیکا: آپدیت‌های روبیکا به آپدیت هم‌شکل تلگرام تبدیل می‌شوند و همان bot.ts جواب می‌دهد
 * (فقط لایه‌ی ارسال در telegram.ts ← rubika-api.ts فرق دارد؛ منطق ربات و Workflowها دست‌نخورده است).
 *
 *  ۱) روبیکا هدر محرمانه نمی‌فرستد؛ راز بخشی از آدرس وبهوک است: /rubika/<TELEGRAM_WEBHOOK_SECRET>
 *  ۲) دو نوع آپدیت می‌آید: ReceiveUpdate (پیام و شروع ربات) و ReceiveInlineMessage (زدن دکمه‌ی شیشه‌ای)؛
 *     هر دو به همین یک آدرس ثبت می‌شوند و از روی شکل بدنه تشخیص داده می‌شوند.
 *  ۳) شناسه‌ی چت (b0…) به شناسه‌ی عددی تبدیل می‌شود (rubika-format.ts) و فقط گفتگوی خصوصی پاسخ داده می‌شود.
 */
import type { Env } from "./env";
import { handleUpdate } from "./bot";
import { BOT_COMMANDS, sendMessage } from "./telegram";
import { rubikaCall, rubikaEnabled } from "./rubika-api";
import { normalizeRubikaUpdate } from "./rubika-update";

export { rubikaEnabled };

/** راز آدرس وبهوک: همان TELEGRAM_WEBHOOK_SECRET (بدون هیچ شرط طولی) */
export function rubikaSecret(env: Env): string {
  return (env.TELEGRAM_WEBHOOK_SECRET || "").trim();
}

/** آدرس کامل وبهوک که روبیکا به آن می‌زند (باید از ایران قابل دسترس و HTTPS باشد) */
export function rubikaWebhookUrl(env: Env): string {
  const base = (env.RUBIKA_WEBHOOK_BASE || env.SITE_URL || "https://pptsaz.ir").replace(/\/+$/, "");
  return `${base}/rubika/${rubikaSecret(env)}`;
}

/** پردازش یک آپدیت روبیکا (با ctx.waitUntil صدا زده می‌شود) */
export async function handleRubikaUpdate(env: Env, body: unknown): Promise<void> {
  const renv: Env = { ...env, PLATFORM: "rubika" };
  let u: any = null;
  try {
    u = await normalizeRubikaUpdate(renv, body);
    if (!u) return;
    await handleUpdate(renv, u);
  } catch (e) {
    console.error("handleRubikaUpdate", e instanceof Error ? e.message.slice(0, 300) : e);
    const chatId = u?.message?.chat?.id ?? u?.callback_query?.message?.chat?.id;
    if (chatId) await sendMessage(renv, chatId, "⚠️ مشکلی پیش آمد. چند لحظه بعد دوباره امتحان کن.").catch(() => {});
  }
}

/** ثبت وبهوک و دستورها (با /rubika-setup یک بار در مرورگر) */
export async function setupRubika(env: Env): Promise<{ ok: boolean; error?: string; bot?: string; webhook?: string }> {
  if (!rubikaEnabled(env)) return { ok: false, error: "RUBIKA_BOT_TOKEN تنظیم نشده است." };
  if (!rubikaSecret(env)) return { ok: false, error: "TELEGRAM_WEBHOOK_SECRET تنظیم نشده است." };
  try {
    const me = await rubikaCall<any>(env, "getMe");
    const url = rubikaWebhookUrl(env);
    await rubikaCall(env, "updateBotEndpoints", { url, type: "ReceiveUpdate" });
    await rubikaCall(env, "updateBotEndpoints", { url, type: "ReceiveInlineMessage" });
    await rubikaCall(env, "setCommands", { bot_commands: BOT_COMMANDS.map((c) => ({ command: c.command, description: c.description })) }).catch(() => {}); // منوی دستورها اختیاری است
    const b = me.bot ?? me;
    return { ok: true, bot: b.username ? `@${b.username}` : undefined, webhook: `https://${new URL(url).host}/rubika/…` };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message.slice(0, 300) : String(e) };
  }
}
