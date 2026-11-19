/** ارسال کد یک‌بارمصرف (OTP) در بله با سرویس «سفیر» (safir.bale.ai)؛ مکمل پیامک.
 *  - پیامک همیشه فرستاده می‌شود و رسیدن به بله جلوی آن را نمی‌گیرد؛ بله فقط وقتی پیامک ناموفق بود راه جایگزین است (auth.ts: sendOtpEx).
 *  - بدون SAFIR_API_KEY خاموش است و رفتار پیامک هیچ تغییری نمی‌کند.
 *  هرگز خطا پرتاب نمی‌کند: false = به بله نرسید (کاربر بله ندارد، اعتبار کم است، خطای شبکه…). */
import type { Env } from "./env";

const SAFIR_URL = "https://safir.bale.ai/api/v3/send_message";
/** شناسه‌ی بازوی فرستنده (عمومی است، محرمانه نیست)؛ با SAFIR_BOT_ID عوض می‌شود */
const DEFAULT_BOT_ID = 1186583240;
/** قالب پیام خوش‌آمد (بدون فیلد) که در پنل کسب‌وکار بله تأیید شده؛ با SAFIR_WELCOME_TEMPLATE عوض می‌شود و مقدار off آن را خاموش می‌کند */
const DEFAULT_WELCOME_TEMPLATE = "413y0Z";

export const safirEnabled = (env: Env): boolean => !!(env.SAFIR_API_KEY ?? "").trim();

/** 09123456789 ← 989123456789 (سفیر شماره را فقط با پیش‌شماره‌ی ۹۸ و بدون صفر/نویسه‌ی اضافه می‌پذیرد) */
const toSafirPhone = (mobile: string) => "98" + mobile.replace(/^0/, "");

interface SafirRes { message_id?: string; error_data?: { code?: number; description?: string }[] | null }

async function safirSend(env: Env, mobile: string, messageData: Record<string, unknown>, timeoutMs: number): Promise<boolean> {
  const botId = Number(env.SAFIR_BOT_ID) || DEFAULT_BOT_ID;
  try {
    const r = await fetch(SAFIR_URL, {
      method: "POST",
      headers: { "content-type": "application/json", "api-access-key": (env.SAFIR_API_KEY ?? "").trim() },
      body: JSON.stringify({ request_id: crypto.randomUUID(), bot_id: botId, phone_number: toSafirPhone(mobile), message_data: messageData }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const j = (await r.json().catch(() => null)) as SafirRes | null;
    if (r.ok && j?.message_id && !(j.error_data && j.error_data.length)) return true;
    const e = j?.error_data?.[0];
    // کد ۱۷ = کاربر بله ندارد (عادی است و خطا نیست)؛ بقیه‌ی خطاها (اعتبار، محدودیت نرخ، …) برای پیگیری ثبت می‌شوند
    if (e?.code !== 17) console.error("safir send failed", r.status, e?.code ?? "", String(e?.description ?? "").slice(0, 120));
  } catch (e) {
    console.error("safir send error", String(e).slice(0, 200));
  }
  return false;
}

/** پیام خوش‌آمد (قالب تأییدشده) فقط یک بار برای هر شماره، اولین بار که کد در بله به او رسید؛ بعدش دیگر فرستاده نمی‌شود.
 *  خطا یا ناموفق بودنش هیچ اثری روی ورود ندارد (در صورت ناموفق بودن، دفعه‌ی بعد دوباره تلاش می‌شود). */
export async function sendWelcomeOnce(env: Env, mobile: string): Promise<void> {
  if (!safirEnabled(env)) return;
  const tpl = (env.SAFIR_WELCOME_TEMPLATE ?? DEFAULT_WELCOME_TEMPLATE).trim();
  if (!tpl || tpl.toLowerCase() === "off") return;
  try {
    const key = `bw:${mobile}`;
    if (await env.KV.get(key)) return;
    if (await safirSend(env, mobile, { template_message: { template_id: tpl, text_fields: {} } }, 6_000)) await env.KV.put(key, "1");
  } catch (e) {
    console.error("safir welcome error", String(e).slice(0, 200));
  }
}

/** OTP را در بله می‌فرستد؛ اگر رسید و این اولین بار است، پیام خوش‌آمد هم پشتش می‌آید. true = کد در بله رسید. */
export async function sendBaleOtp(env: Env, mobile: string, code: string): Promise<boolean> {
  if (!safirEnabled(env)) return false;
  const ok = await safirSend(env, mobile, { otp_message: { otp: code } }, 8_000);
  if (ok) await sendWelcomeOnce(env, mobile);
  return ok;
}
