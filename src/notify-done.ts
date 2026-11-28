/**
 * اعلان «آماده شد» به بقیه‌ی کانال‌های کاربر (ارائه، پوستر، جزوه، اسلاید صوتی، پادکست).
 *
 * هر ورک‌فلو پیام آماده‌شدن را به کانال مبدأ خودش می‌فرستد (چت ربات، پیام مینی‌اپ، وب‌پوش یا اعلان محلی اپ).
 * این تابع همان خبر را به باقی کانال‌های قابل‌دسترس حساب می‌رساند (notifyUser) و کانالی را که همین حالا خبر گرفته حذف می‌کند تا پیام دوبار نرسد.
 * ایمیل فقط برای «ارائه» می‌رود (d.slides = true) و با فایل PPTX پیوست می‌شود؛ پوستر، جزوه، صوت و پادکست ایمیل ندارند (برای هر خروجی ایمیل زیاد است).
 * اگر فایل برای پیوست بزرگ باشد یا خوانده نشود، همان ایمیل بدون پیوست و با دکمه‌ی باز کردن سایت می‌رود.
 * هرگز خطا پرتاب نمی‌کند؛ فراخواننده آن را در گام بدون تلاش مجدد صدا بزند.
 */
import type { Env } from "./env";
import type { Uid } from "./settings";
import { notifyUser, type EmailContent, type NotifyKind } from "./notify";
import { appReadyMarkup } from "./deck-service";
import { loadFileDirect } from "./files";
import { BRAND, toBase64 } from "./email";
import { mailUrl } from "./email-blocks";
import { firstName, render } from "./plan-notify";
import { toFa } from "./util";

/** سقف حجم PPTX برای پیوست (بایت): ۴۰ مگابایت = سقف ایمیل در Resend. فایل‌های ذخیره‌شده حداکثر ۲۴ مگابایت‌اند (files.ts) که پس از base64 حدود ۳۲ مگابایت می‌شود و زیر سقف می‌ماند. اگر سرویس سرریز (Brevo) سقف کمتری دارد این عدد را کم کن. */
const MAX_ATTACH_BYTES = 40 * 1024 * 1024;

export interface DoneNotice {
  /** عنوان اعلان اپ/مرورگر */ title: string;
  /** متن ساده‌ی اعلان اپ/مرورگر */ body: string;
  /** متن پیام‌رسان‌ها (HTML تلگرامی) */ html: string;
  /** برچسب اعلان اپ/مرورگر (مثلاً deck-done) */ tag: string;
  /** شناسه‌ی فایل برای دکمه‌ی «مشاهده در سایت» و پیوست ایمیل */ fileId?: string;
  /** پیام ارائه است؟ (دکمه‌ی Google Slides و ایمیل با پیوست PPTX فقط برای ارائه) */ slides?: boolean;
  /** کانال تحویل وب بود؟ (سایت، اپ یا مینی‌اپ) */ web: boolean;
  /** فقط وب: از مینی‌اپ/ایتا بود؟ */ viaMiniApp: boolean;
  /** پلتفرم مبدأ (bazaar/myket/app/ios = اپ) */ plat?: string;
  /** چتی که همین حالا پیام همین رویداد را گرفته (ربات: همان چت؛ مینی‌اپ: چت پیام مینی‌اپ) */ originChat?: number | null;
}

/** ایمیل فوری «ارائه آماده شد» با فایل PPTX پیوست (یا فقط لینک سایت اگر فایل بزرگ است/خوانده نشد) */
async function deckEmail(env: Env, uid: Uid, d: DoneNotice, who: { to: string; name: string }): Promise<EmailContent> {
  let file: Awaited<ReturnType<typeof loadFileDirect>> = null;
  try { if (d.fileId) file = await loadFileDirect(env, uid, d.fileId); }
  catch (e) { console.error("notify-done email file", String(e).slice(0, 160)); }

  const attach = !!file && file.data.byteLength > 0 && file.data.byteLength <= MAX_ATTACH_BYTES;
  const rows: [string, string][] = file ? [["عنوان", file.entry.title], ["تعداد اسلاید", toFa(String(file.entry.slides))]] : [];
  const paras = [
    attach ? "فایل PPTX ارائه به همین ایمیل پیوست شده است." : "فایل ارائه آماده است؛ برای دانلود دکمه‌ی زیر را بزن.",
    "فایل‌ها ۲۴ ساعت در سایت نگه داشته می‌شوند.",
  ];
  const title = file?.entry.title;
  const mail = render(env, `✅ ${title ? `«${title}» آماده شد` : "ارائه‌ات آماده شد"} — ${BRAND}`, {
    head: d.title, sub: `${firstName(who.name)}، ارائه‌ات آماده است`, paras, rows,
    cta: "باز کردن در سایت ←", color: "#2563eb", href: mailUrl(env, "/", d.tag, "cta"), campaign: d.tag, promo: false,
    foot: "این پیام را به‌خاطر حساب‌ت در پاورپوینت‌ساز دریافت کرده‌ای.", preview: d.body.replace(/\s+/g, " ").slice(0, 120),
  });
  return attach && file ? { ...mail, attachments: [{ filename: file.entry.name, content: toBase64(file.data) }] } : mail;
}

export async function notifyOtherChannels(env: Env, uid: Uid, d: DoneNotice): Promise<void> {
  try {
    const appOrigin = d.plat === "bazaar" || d.plat === "myket" || d.plat === "app" || d.plat === "ios"; // اپ خودش اعلان محلی نشان می‌دهد
    const except: NotifyKind[] = [];
    if (!d.slides) except.push("email"); // ایمیل فقط برای ارائه (با پیوست PPTX)؛ پوستر/جزوه/صوت/پادکست ایمیل ندارند
    if (appOrigin) except.push("app");
    if (d.web && !d.viaMiniApp) except.push("web"); // وب‌پوش همین کاربر قبلاً رفته
    const r = await notifyUser(env, uid, {
      title: d.title, body: d.body, html: d.html, tag: d.tag, url: "/",
      extra: (id) => appReadyMarkup(env, id, d.fileId, d.slides ?? false),
      ...(d.slides ? { email: (who) => deckEmail(env, uid, d, who), emailTag: d.tag, key: d.fileId ? `done-${uid}-${d.fileId}` : undefined } : {}),
      except,
      ...(d.originChat ? { exceptIds: [d.originChat] } : {}),
    });
    console.log("notify-others", d.tag, JSON.stringify({ delivered: r.delivered, failed: r.failed, reachable: r.reachable }));
  } catch (e) {
    console.error("notify-others", String(e).slice(0, 200));
  }
}
