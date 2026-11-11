/** ارسال کد یک‌بارمصرف (OTP) در بله با سرویس «سفیر» (safir.bale.ai)؛ مکمل پیامک.
 *  - پیامک همیشه فرستاده می‌شود و رسیدن به بله جلوی آن را نمی‌گیرد؛ بله فقط وقتی پیامک ناموفق بود راه جایگزین است (auth.ts: sendOtpEx).
 *  - بدون SAFIR_API_KEY خاموش است و رفتار پیامک هیچ تغییری نمی‌کند.
 *  هرگز خطا پرتاب نمی‌کند: false = به بله نرسید (کاربر بله ندارد، اعتبار کم است، خطای شبکه…). */
import type { Env } from "./env";

const SAFIR_URL = "https://safir.bale.ai/api/v3/send_message";
/** شناسه‌ی بازوی فرستنده (عمومی است، محرمانه نیست)؛ با SAFIR_BOT_ID عوض می‌شود */
const DEFAULT_BOT_ID = 1186583240;

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

/** OTP را در بله می‌فرستد. true = کد در بله رسید. */
export async function sendBaleOtp(env: Env, mobile: string, code: string): Promise<boolean> {
  if (!safirEnabled(env)) return false;
  return safirSend(env, mobile, { otp_message: { otp: code } }, 8_000);
}
