/** ارسال ایمیل با Resend (https://resend.com/docs/api-reference/emails/send-email) و سرریز به Brevo.
 *  همیشه اول Resend؛ اگر سهمیه‌ی Resend پر بود یا خطای سروری داد، همان ایمیل با Brevo می‌رود (BREVO_API_KEY) و بعد از ۱۵ دقیقه دوباره Resend امتحان می‌شود.
 *  بدون هیچ‌کدام از کلیدها هیچ ایمیلی فرستاده نمی‌شود و بقیه‌ی برنامه بدون تغییر کار می‌کند.
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
export const emailEnabled = (env: Env) => !!env.RESEND_API_KEY?.trim() || !!env.BREVO_API_KEY?.trim();

/** فرستنده: EMAIL_FROM (مثل «پاورپوینت‌ساز فارسی <info@pptsaz.ir>»)؛ پیش‌فرض info@ روی دامنه‌ی سایت */
function fromAddress(env: Env): string {
  const f = env.EMAIL_FROM?.trim();
  // فقط نشانی خالی (مثل info@pptsaz.ir) ⇒ در صندوق کاربر «info» نشان داده می‌شود؛ نام برند را جلویش می‌گذاریم
  if (f) return /^[^<>\s@]+@[^<>\s@]+$/.test(f) ? `${BRAND} <${f}>` : f;
  return `${BRAND} <info@${new URL(siteOf(env)).hostname}>`;
}

const RESEND_BLOCK_KEY = "mail:resend-block";
const RESEND_BLOCK_TTL = 900; // ثانیه؛ بعد از آن اولین ایمیل دوباره سراغ Resend می‌رود

interface Sent { ok: boolean; /** سهمیه‌ی روزانه/ماهانه تمام شده */ quota?: boolean; /** خطای درخواست (بدنه‌ی ناقص/آدرس نامعتبر): سرویس دوم هم رد می‌کند */ bad?: boolean }

async function viaResend(env: Env, m: EmailMsg): Promise<Sent> {
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
    if (r.ok) return { ok: true };
    const body = (await r.text().catch(() => "")).slice(0, 300);
    console.error("resend", r.status, body);
    return { ok: false, quota: r.status === 429 && /quota/i.test(body), bad: r.status === 400 || r.status === 422 };
  } catch (e) {
    console.error("resend", e);
    return { ok: false };
  }
}

/** «نام <نشانی>» یا فقط «نشانی» ← { name, email } برای فرستنده‌ی Brevo */
function parseFrom(from: string): { name?: string; email: string } {
  const mt = from.match(/^\s*(.*?)\s*<([^<>\s]+)>\s*$/);
  return mt ? { ...(mt[1] ? { name: mt[1].replace(/^"|"$/g, "") } : {}), email: mt[2] } : { email: from.trim() };
}

async function viaBrevo(env: Env, m: EmailMsg): Promise<boolean> {
  try {
    const r = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: { "api-key": env.BREVO_API_KEY!.trim(), "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        sender: parseFrom(fromAddress(env)),
        to: [{ email: m.to }],
        subject: m.subject,
        htmlContent: m.html,
        textContent: m.text,
        ...(env.EMAIL_REPLY_TO?.trim() ? { replyTo: { email: env.EMAIL_REPLY_TO.trim() } } : {}),
        ...(m.tag ? { tags: [m.tag] } : {}),
        ...(m.attachments?.length ? { attachment: m.attachments.map((a) => ({ name: a.filename, content: a.content })) } : {}),
      }),
      signal: AbortSignal.timeout(m.attachments?.length ? 25000 : 6000),
    });
    if (!r.ok) {
      console.error("brevo", r.status, (await r.text().catch(() => "")).slice(0, 300));
      return false;
    }
    return true;
  } catch (e) {
    console.error("brevo", e);
    return false;
  }
}

export async function sendEmail(env: Env, m: EmailMsg): Promise<boolean> {
  if (!emailEnabled(env)) return false;
  const hasResend = !!env.RESEND_API_KEY?.trim(), hasBrevo = !!env.BREVO_API_KEY?.trim();
  // Resend تا وقتی سهمیه‌اش پر شده کنار می‌ماند (فقط اگر Brevo هست)؛ بعد از مدت کوتاه خودش دوباره امتحان می‌شود
  const blocked = hasResend && hasBrevo && !!(await env.KV.get(RESEND_BLOCK_KEY).catch(() => null));
  if (hasResend && !blocked) {
    const r = await viaResend(env, m);
    if (r.ok) return true;
    if (r.bad || !hasBrevo) return false;
    if (r.quota) await env.KV.put(RESEND_BLOCK_KEY, "1", { expirationTtl: RESEND_BLOCK_TTL }).catch(() => {});
  }
  return hasBrevo ? viaBrevo(env, m) : false;
}

/** بایت‌ها → base64 (تکه‌تکه تا حافظه‌ی رشته‌ی میانی بزرگ نشود) */
export function toBase64(buf: ArrayBuffer): string {
  const u = new Uint8Array(buf), parts: string[] = [];
  for (let i = 0; i < u.length; i += 0x8000) parts.push(String.fromCharCode(...u.subarray(i, i + 0x8000)));
  return btoa(parts.join(""));
}
