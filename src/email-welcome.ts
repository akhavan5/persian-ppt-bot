/** ایمیل خوش‌آمد: بعد از ساخت حساب جدید با ایمیل (ورود با گوگل) فرستاده می‌شود.
 *  قالب مخصوص کلاینت‌های ایمیل: جدول‌بندی، استایل درون‌خطی، راست‌به‌چپ، بدون SVG/فونت وب (Gmail و Outlook پشتیبانی نمی‌کنند). */
import type { Env } from "./env";
import type { WebUser } from "./auth";
import { SIGNUP_CREDITS } from "./settings";
import { toFa } from "./util";
import { BRAND, sendEmail, siteOf } from "./email";

const BOT_URL = "https://t.me/pptsaz_bot";
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const FONT = "Vazirmatn,Tahoma,'Segoe UI',Arial,sans-serif";
const BLUE = "#2563eb", CYAN = "#06b6d4", INK = "#0f1b33", MUTED = "#5b6b86", LINE = "#e3e9f5", SOFT = "#eef4ff";

/** نام کوتاه برای سلام: اولین بخش نام؛ اگر خالی بود «دوست عزیز» */
const firstName = (name: string) => name.trim().split(/\s+/)[0]?.slice(0, 24) || "دوست عزیز";

const STEPS: [string, string][] = [
  ["موضوع یا متنت را بنویس", "یک موضوع کوتاه، متن مقاله یا حتی لینک یک صفحه؛ هر چه داری بده."],
  ["مدل، تعداد اسلاید و تصویر را انتخاب کن", "قالب فارسی و راست‌چین، با فونت‌های خوانا، بدون دردسر."],
  ["فایل PPTX را بگیر و ویرایش کن", "ارائه‌ی آماده را در پاورپوینت باز کن و هر چه خواستی عوض کن."],
];
const FEATURES = ["📄 تبدیل Word به ارائه", "📑 تبدیل PDF به ارائه", "🔗 ساخت ارائه از لینک", "🖼 اسلاید با تصویر", "🗒 یادداشت سخنران", "📊 اینفوگرافیک و جزوه"];

export function welcomeEmail(env: Env, name: string): { subject: string; html: string; text: string } {
  const site = siteOf(env);
  const n = esc(firstName(name));
  const credits = toFa(String(SIGNUP_CREDITS));
  const subject = `🎁 خوش آمدی! ${credits} ارائه‌ی رایگان منتظر توست`;
  const pre = `${credits} اعتبار هدیه به حسابت اضافه شد؛ اولین ارائه‌ات را همین حالا بساز.`;

  const stepRows = STEPS.map(([t, d], i) => `
            <tr>
              <td width="44" valign="top" style="padding:0 0 18px 0;">
                <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
                  <td align="center" valign="middle" width="34" height="34" bgcolor="${SOFT}" style="width:34px;height:34px;border-radius:17px;background:${SOFT};color:${BLUE};font:700 15px/34px ${FONT};">${toFa(String(i + 1))}</td>
                </tr></table>
              </td>
              <td valign="top" style="padding:0 0 18px 0;font-family:${FONT};text-align:right;">
                <div style="font:700 15px/1.7 ${FONT};color:${INK};">${t}</div>
                <div style="font:400 13px/1.9 ${FONT};color:${MUTED};">${d}</div>
              </td>
            </tr>`).join("");

  const chip = (t: string) => `<td width="50%" style="padding:0 0 10px 10px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td align="center" bgcolor="#ffffff" style="border:1px solid ${LINE};border-radius:12px;padding:10px 8px;font:600 13px/1.6 ${FONT};color:${INK};">${t}</td></tr></table></td>`;
  const chipRows = [0, 2, 4].map((i) => `<tr>${chip(FEATURES[i])}${chip(FEATURES[i + 1])}</tr>`).join("");

  const html = `<!doctype html>
<html lang="fa" dir="rtl" xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light only">
<meta name="supported-color-schemes" content="light only">
<title>${esc(subject)}</title>
</head>
<body style="margin:0;padding:0;background:#f1f5fb;-webkit-text-size-adjust:100%;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;mso-hide:all;">${pre}&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#f1f5fb" style="background:#f1f5fb;">
<tr><td align="center" style="padding:28px 12px;">
  <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;">

    <!-- سربرگ -->
    <tr><td align="center" bgcolor="${BLUE}" style="background:${BLUE};background-image:linear-gradient(135deg,${BLUE} 0%,${CYAN} 100%);border-radius:22px 22px 0 0;padding:34px 24px 30px;">
      <img src="${site}/icon-192.png" width="64" height="64" alt="${BRAND}" style="display:block;border:0;border-radius:16px;margin:0 auto 14px;">
      <div style="font:700 26px/1.5 ${FONT};color:#ffffff;">${n}، خوش آمدی! 👋</div>
      <div style="font:400 14px/1.9 ${FONT};color:#dbeafe;">به ${BRAND} پیوستی؛ ارائه‌ی فارسی بساز، بدون دردسر.</div>
    </td></tr>

    <!-- بدنه -->
    <tr><td bgcolor="#ffffff" style="background:#ffffff;padding:30px 28px 8px;font-family:${FONT};text-align:right;">

      <!-- هدیه -->
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
        <td align="center" bgcolor="${SOFT}" style="background:${SOFT};border:1px solid #cfe0ff;border-radius:18px;padding:20px 16px;">
          <div style="font:600 13px/1.8 ${FONT};color:${MUTED};">هدیه‌ی ثبت‌نام</div>
          <div style="font:800 44px/1.3 ${FONT};color:${BLUE};">${credits} <span style="font:700 18px/1.3 ${FONT};color:${INK};">ارائه‌ی رایگان</span></div>
          <div style="font:400 12.5px/1.9 ${FONT};color:${MUTED};">اعتبار هدیه همین حالا به حسابت اضافه شده است.</div>
        </td>
      </tr></table>

      <!-- دکمه -->
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td align="center" style="padding:26px 0 8px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
          <td align="center" bgcolor="${BLUE}" style="border-radius:14px;background:${BLUE};background-image:linear-gradient(135deg,${BLUE},#1d4ed8);">
            <a href="${site}/" target="_blank" style="display:inline-block;padding:15px 40px;font:700 16px/1.4 ${FONT};color:#ffffff;text-decoration:none;border-radius:14px;">ساخت اولین ارائه ←</a>
          </td>
        </tr></table>
      </td></tr></table>

      <!-- مراحل -->
      <div style="font:700 17px/1.8 ${FONT};color:${INK};padding:22px 0 14px;">در سه قدم ارائه‌ات آماده است</div>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${stepRows}
      </table>
    </td></tr>

    <!-- امکانات -->
    <tr><td bgcolor="#f8faff" style="background:#f8faff;padding:22px 28px 12px 18px;border-top:1px solid ${LINE};font-family:${FONT};text-align:right;">
      <div style="font:700 15px/1.8 ${FONT};color:${INK};padding:0 0 12px 10px;">کارهایی که می‌توانی بکنی</div>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${chipRows}</table>
    </td></tr>

    <!-- تلگرام -->
    <tr><td bgcolor="#ffffff" align="center" style="background:#ffffff;padding:24px 28px 30px;border-top:1px solid ${LINE};border-radius:0 0 22px 22px;font-family:${FONT};">
      <div style="font:400 13.5px/2 ${FONT};color:${MUTED};">ترجیح می‌دهی از موبایل و داخل تلگرام بسازی؟</div>
      <a href="${BOT_URL}" target="_blank" style="font:700 14px/2 ${FONT};color:${BLUE};text-decoration:none;">ربات تلگرام ${BRAND} ←</a>
    </td></tr>

    <!-- پانوشت -->
    <tr><td align="center" style="padding:20px 16px 4px;font:400 12px/2 ${FONT};color:#8a97ad;">
      این ایمیل را به‌خاطر ثبت‌نامت در <a href="${site}/" style="color:#8a97ad;">${site.replace(/^https?:\/\//, "")}</a> برایت فرستادیم.<br>
      سؤالی داشتی؟ همین ایمیل را پاسخ بده، می‌خوانیمش.
    </td></tr>

  </table>
</td></tr>
</table>
</body>
</html>`;

  const text = [
    `${firstName(name)}، خوش آمدی به ${BRAND}!`,
    "",
    `${credits} ارائه‌ی رایگان به‌عنوان هدیه‌ی ثبت‌نام به حسابت اضافه شده است.`,
    "",
    "در سه قدم ارائه‌ات آماده است:",
    ...STEPS.map(([t], i) => `${toFa(String(i + 1))}. ${t}`),
    "",
    `شروع: ${site}/`,
    `ربات تلگرام: ${BOT_URL}`,
    "",
    "سؤالی داشتی؟ همین ایمیل را پاسخ بده.",
  ].join("\n");

  return { subject, html, text };
}

/** بعد از ساخت حساب جدید صدا زده می‌شود (فقط وقتی ایمیل دارد). هرگز خطا پرتاب نمی‌کند. */
export async function sendWelcomeEmail(env: Env, u: Pick<WebUser, "id" | "email" | "name">): Promise<boolean> {
  if (!u.email) return false;
  const m = welcomeEmail(env, u.name);
  return sendEmail(env, { to: u.email, ...m, tag: "welcome", idempotencyKey: `welcome-${u.id}` });
}
