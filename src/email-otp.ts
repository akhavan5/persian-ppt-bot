/** ایمیل کد ورود/تایید ۶ رقمی (ثبت‌نام و ورود با ایمیل، افزودن ایمیل در پروفایل).
 *  قالب ساده و سبک برای همه‌ی کلاینت‌های ایمیل: جدول‌بندی، استایل درون‌خطی، راست‌به‌چپ. */
import type { Env } from "./env";
import { toFa } from "./util";
import { BRAND, sendEmail, siteOf } from "./email";

const FONT = "Vazirmatn,Tahoma,'Segoe UI',Arial,sans-serif";
const BLUE = "#2563eb", INK = "#0f1b33", MUTED = "#5b6b86", SOFT = "#eef4ff";

export function otpEmail(env: Env, code: string): { subject: string; html: string; text: string } {
  const site = siteOf(env);
  const subject = `${toFa(code)} کد ورود شما به ${BRAND}`;
  const html = `<!doctype html>
<html lang="fa" dir="rtl">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light only"><title>${BRAND}</title></head>
<body style="margin:0;padding:0;background:#f1f5fb;-webkit-text-size-adjust:100%;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;mso-hide:all;">کد ورود شما ${toFa(code)} است؛ ۵ دقیقه اعتبار دارد.</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#f1f5fb" style="background:#f1f5fb;">
<tr><td align="center" style="padding:28px 12px;">
  <table role="presentation" width="480" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:480px;">
    <tr><td align="center" bgcolor="${BLUE}" style="background:${BLUE};border-radius:20px 20px 0 0;padding:26px 20px;">
      <img src="${site}/icon-192.png" width="52" height="52" alt="${BRAND}" style="display:block;border:0;border-radius:13px;margin:0 auto 10px;">
      <div style="font:700 18px/1.7 ${FONT};color:#ffffff;">${BRAND}</div>
    </td></tr>
    <tr><td bgcolor="#ffffff" align="center" style="background:#ffffff;border-radius:0 0 20px 20px;padding:28px 24px 30px;font-family:${FONT};text-align:center;">
      <div style="font:700 16px/1.9 ${FONT};color:${INK};">کد ورود یا ثبت‌نام شما</div>
      <div style="font:400 13px/1.9 ${FONT};color:${MUTED};padding-bottom:16px;">این کد را در صفحه‌ی ورود وارد کن.</div>
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center"><tr>
        <td align="center" bgcolor="${SOFT}" style="background:${SOFT};border:1px solid #cfe0ff;border-radius:14px;padding:14px 30px;direction:ltr;font:800 34px/1.3 'Courier New',Consolas,monospace;letter-spacing:8px;color:${BLUE};">${code}</td>
      </tr></table>
      <div style="font:400 12.5px/2 ${FONT};color:${MUTED};padding-top:18px;">کد ۵ دقیقه اعتبار دارد و فقط یک‌بار قابل استفاده است.<br>اگر این درخواست از طرف تو نبوده، این ایمیل را نادیده بگیر؛ هیچ اتفاقی نمی‌افتد.</div>
    </td></tr>
  </table>
</td></tr>
</table>
</body>
</html>`;
  const text = [`کد ورود شما به ${BRAND}: ${code}`, "", "این کد ۵ دقیقه اعتبار دارد و فقط یک‌بار قابل استفاده است.", "اگر این درخواست از طرف تو نبوده، این ایمیل را نادیده بگیر."].join("\n");
  return { subject, html, text };
}

/** هرگز خطا پرتاب نمی‌کند؛ false = ارسال نشد */
export async function sendOtpEmail(env: Env, to: string, code: string): Promise<boolean> {
  const m = otpEmail(env, code);
  return sendEmail(env, { to, ...m, tag: "otp" });
}
