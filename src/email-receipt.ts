/** رسید خرید پلن: بعد از هر خرید موفق (درگاه دیجی‌پی، کافه‌بازار، مایکت) هم به ایمیل حساب (اگر دارد) و هم به ربات تلگرام (اگر تلگرام وصل است) فرستاده می‌شود.
 *  هرگز خطا پرتاب نمی‌کند و پرداخت را خراب نمی‌کند؛ اگر ایمیل ثبت نشده یا RESEND_API_KEY نیست، ایمیل بی‌اثر است. */
import type { Env } from "./env";
import { getUserById } from "./auth";
import { toFa } from "./util";
import { getLinkedTg } from "./link";
import { esc as tgEsc, sendMessage } from "./telegram";
import { BRAND, sendEmail, siteOf } from "./email";

const FONT = "Vazirmatn,Tahoma,'Segoe UI',Arial,sans-serif";
const BLUE = "#2563eb", INK = "#0f1b33", MUTED = "#5b6b86", LINE = "#e3e9f5", SOFT = "#eef4ff";
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export interface Receipt {
  uid: string;
  planName: string;
  credits: number;
  days: number;
  /** مبلغ به تومان */
  toman: number;
  /** شماره‌ی سفارش (نمایشی؛ ممکن است خالی باشد) */
  order: string;
  /** کلید یکتای خرید: تکرار callback/تلاش مجدد ایمیل دوم نمی‌فرستد */
  idem: string;
  /** کد پیگیری درگاه یا بازار (اختیاری) */
  ref?: string;
  method: "درگاه پرداخت" | "کافه‌بازار" | "مایکت";
  paidAt: number;
  /** پایان اعتبار پلن (ms) */
  expAt?: number;
}

const faDate = (t: number) => new Date(t).toLocaleDateString("fa-IR", { timeZone: "Asia/Tehran", year: "numeric", month: "long", day: "numeric" });
const faTime = (t: number) => new Date(t).toLocaleTimeString("fa-IR", { timeZone: "Asia/Tehran", hour: "2-digit", minute: "2-digit" });
const money = (n: number) => `${toFa(n.toLocaleString("en-US"))} تومان`;

export function receiptEmail(env: Env, name: string, r: Receipt): { subject: string; html: string; text: string } {
  const site = siteOf(env);
  const subject = `رسید خرید پلن ${r.planName} — ${BRAND}`;
  const rows: [string, string][] = [
    ["پلن", `پلن ${r.planName}`],
    ["مبلغ پرداخت‌شده", money(r.toman)],
    ["اعتبار", `${toFa(String(r.credits))} اعتبار`],
    ["مدت", `${toFa(String(r.days))} روز`],
    ...(r.expAt ? [["اعتبار تا", faDate(r.expAt)] as [string, string]] : []),
    ["تاریخ خرید", `${faDate(r.paidAt)} — ${faTime(r.paidAt)}`],
    ["روش پرداخت", r.method],
    ...(r.ref ? [["کد پیگیری", r.ref] as [string, string]] : []),
    ...(r.order ? [["شماره‌ی سفارش", r.order] as [string, string]] : []),
  ];
  const first = name.trim().split(/\s+/)[0]?.slice(0, 24) || "دوست عزیز";
  const tr = rows.map(([k, v]) => `
        <tr>
          <td style="padding:11px 0;border-bottom:1px solid ${LINE};font:400 13px/1.8 ${FONT};color:${MUTED};text-align:right;">${k}</td>
          <td style="padding:11px 0;border-bottom:1px solid ${LINE};font:700 13.5px/1.8 ${FONT};color:${INK};text-align:left;unicode-bidi:plaintext;">${esc(v)}</td>
        </tr>`).join("");
  const html = `<!doctype html>
<html lang="fa" dir="rtl">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light only"><title>${esc(subject)}</title></head>
<body style="margin:0;padding:0;background:#f1f5fb;-webkit-text-size-adjust:100%;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;mso-hide:all;">پرداخت ${money(r.toman)} با موفقیت انجام شد و پلن ${esc(r.planName)} فعال است.</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#f1f5fb" style="background:#f1f5fb;">
<tr><td align="center" style="padding:28px 12px;">
  <table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:560px;">
    <tr><td align="center" bgcolor="${BLUE}" style="background:${BLUE};border-radius:20px 20px 0 0;padding:28px 20px;">
      <img src="${site}/icon-192.png" width="52" height="52" alt="${BRAND}" style="display:block;border:0;border-radius:13px;margin:0 auto 10px;">
      <div style="font:700 21px/1.6 ${FONT};color:#ffffff;">پرداخت موفق ✅</div>
      <div style="font:400 13.5px/1.9 ${FONT};color:#dbeafe;">${esc(first)}، ممنون از خریدت؛ پلن ${esc(r.planName)} فعال شد.</div>
    </td></tr>
    <tr><td bgcolor="#ffffff" style="background:#ffffff;padding:24px 26px 8px;font-family:${FONT};text-align:right;">
      <div style="font:700 16px/1.8 ${FONT};color:${INK};padding-bottom:6px;">رسید خرید</div>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${tr}
      </table>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td align="center" style="padding:24px 0 10px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
          <td align="center" bgcolor="${BLUE}" style="border-radius:13px;background:${BLUE};"><a href="${site}/" target="_blank" style="display:inline-block;padding:13px 34px;font:700 15px/1.4 ${FONT};color:#ffffff;text-decoration:none;border-radius:13px;">ساخت ارائه ←</a></td>
        </tr></table>
      </td></tr></table>
    </td></tr>
    <tr><td bgcolor="${SOFT}" align="center" style="background:${SOFT};border-radius:0 0 20px 20px;padding:16px 22px;font:400 12px/2 ${FONT};color:${MUTED};">
      این ایمیل رسید خرید توست؛ آن را نگه دار. برای پیگیری یا هر سؤالی، همین ایمیل را پاسخ بده.
    </td></tr>
  </table>
</td></tr>
</table>
</body>
</html>`;
  const text = [
    `رسید خرید — ${BRAND}`,
    "",
    ...rows.map(([k, v]) => `${k}: ${v}`),
    "",
    `شروع: ${site}/`,
    "سؤالی داشتی؟ همین ایمیل را پاسخ بده.",
  ].join("\n");
  return { subject, html, text };
}

export async function sendReceiptEmail(env: Env, r: Receipt): Promise<boolean> {
  try {
    const u = await getUserById(env, r.uid);
    if (!u?.email) return false;
    const m = receiptEmail(env, u.name, r);
    return await sendEmail(env, { to: u.email, ...m, tag: "receipt", idempotencyKey: `receipt-${r.idem}`.slice(0, 256) });
  } catch (e) {
    console.error("receipt email", e);
    return false;
  }
}

/** متن رسید برای ربات تلگرام (HTML) */
export function receiptTelegram(r: Receipt): string {
  const L = [
    "✅ <b>پرداخت موفق بود</b>",
    "",
    `🧾 <b>رسید خرید</b>`,
    `👑 پلن: <b>${tgEsc(r.planName)}</b>`,
    `💰 مبلغ: <b>${tgEsc(money(r.toman))}</b>`,
    `🎟 اعتبار: ${toFa(String(r.credits))} · مدت: ${toFa(String(r.days))} روز`,
    ...(r.expAt ? [`⏳ اعتبار تا: ${tgEsc(faDate(r.expAt))}`] : []),
    `📅 تاریخ خرید: ${tgEsc(faDate(r.paidAt))} — ${tgEsc(faTime(r.paidAt))}`,
    `💳 روش پرداخت: ${tgEsc(r.method)}`,
    ...(r.ref ? [`🔖 کد پیگیری: <code>${tgEsc(r.ref)}</code>`] : []),
    ...(r.order ? [`🧷 شماره‌ی سفارش: <code>${tgEsc(r.order)}</code>`] : []),
  ];
  return L.join("\n");
}

export async function sendReceiptTelegram(env: Env, r: Receipt): Promise<boolean> {
  try {
    const tgId = await getLinkedTg(env, r.uid);
    if (!tgId) return false;
    await sendMessage(env, tgId, receiptTelegram(r));
    return true;
  } catch (e) {
    console.error("receipt telegram", e);
    return false;
  }
}

/** رسید کامل: ایمیل + تلگرام (هر کدام که برای حساب موجود باشد) */
export async function sendReceipt(env: Env, r: Receipt): Promise<void> {
  await Promise.all([sendReceiptEmail(env, r), sendReceiptTelegram(env, r)]);
}
