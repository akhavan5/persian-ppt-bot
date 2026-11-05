/** ارسال ایمیل با Resend (https://resend.com/docs/api-reference/emails/send-email).
 *  بدون RESEND_API_KEY هیچ ایمیلی فرستاده نمی‌شود و بقیه‌ی برنامه بدون تغییر کار می‌کند.
 *  ارسال هرگز نباید ثبت‌نام یا پرداخت را خراب کند؛ پس خطاها فقط لاگ می‌شوند و false برمی‌گردد. */
import type { Env } from "./env";

export const BRAND = "پاورپوینت‌ساز فارسی";

export interface EmailMsg {
  to: string;
  subject: string;
  html: string;
  text: string;
  /** برچسب برای آمار در داشبورد Resend (مثلاً welcome) */
  tag?: string;
  /** کلید یکتا: اگر همان ایمیل دوباره (مثلاً با تلاش مجدد) درخواست شود، Resend فقط یک‌بار می‌فرستد */
  idempotencyKey?: string;
  /** پیوست‌ها؛ content = base64 (سقف کل ایمیل در Resend ۴۰ مگابایت است) */
  attachments?: { filename: string; content: string }[];
}

export const siteOf = (env: Env) => (env.SITE_URL || "https://pptsaz.ir").replace(/\/+$/, "");
export const emailEnabled = (env: Env) => !!env.RESEND_API_KEY?.trim();

/** فرستنده: EMAIL_FROM (مثل «پاورپوینت‌ساز فارسی <hello@pptsaz.ir>»)؛ پیش‌فرض hello@ روی دامنه‌ی سایت */
function fromAddress(env: Env): string {
  const f = env.EMAIL_FROM?.trim();
  // فقط نشانی خالی (مثل info@pptsaz.ir) ⇒ در صندوق کاربر «info» نشان داده می‌شود؛ نام برند را جلویش می‌گذاریم
  if (f) return /^[^<>\s@]+@[^<>\s@]+$/.test(f) ? `${BRAND} <${f}>` : f;
  return `${BRAND} <hello@${new URL(siteOf(env)).hostname}>`;
}

export async function sendEmail(env: Env, m: EmailMsg): Promise<boolean> {
  if (!emailEnabled(env)) return false;
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        authorization: `Bearer ${env.RESEND_API_KEY!.trim()}`,
        "content-type": "application/json",
        ...(m.idempotencyKey ? { "idempotency-key": m.idempotencyKey } : {}),
      },
      body: JSON.stringify({
        from: fromAddress(env),
        to: [m.to],
        subject: m.subject,
        html: m.html,
        text: m.text,
        ...(env.EMAIL_REPLY_TO?.trim() ? { reply_to: env.EMAIL_REPLY_TO.trim() } : {}),
        ...(m.tag ? { tags: [{ name: "type", value: m.tag }] } : {}),
        ...(m.attachments?.length ? { attachments: m.attachments } : {}),
      }),
      signal: AbortSignal.timeout(m.attachments?.length ? 25000 : 6000), // ثبت‌نام منتظر ایمیل نمی‌ماند؛ آپلود پیوست زمان بیشتری می‌خواهد
    });
    if (!r.ok) {
      console.error("resend", r.status, (await r.text().catch(() => "")).slice(0, 300));
      return false;
    }
    return true;
  } catch (e) {
    console.error("resend", e);
    return false;
  }
}

/** بایت‌ها → base64 (تکه‌تکه تا حافظه‌ی رشته‌ی میانی بزرگ نشود) */
export function toBase64(buf: ArrayBuffer): string {
  const u = new Uint8Array(buf), parts: string[] = [];
  for (let i = 0; i < u.length; i += 0x8000) parts.push(String.fromCharCode(...u.subarray(i, i + 0x8000)));
  return btoa(parts.join(""));
}
