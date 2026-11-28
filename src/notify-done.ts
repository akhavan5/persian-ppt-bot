/**
 * اعلان «آماده شد» به بقیه‌ی کانال‌های کاربر (ارائه، پوستر، جزوه، اسلاید صوتی، پادکست).
 *
 * هر ورک‌فلو پیام آماده‌شدن را به کانال مبدأ خودش می‌فرستد (چت ربات، پیام مینی‌اپ، وب‌پوش یا اعلان محلی اپ).
 * این تابع همان خبر را به باقی کانال‌های قابل‌دسترس حساب می‌رساند (notifyUser) و کانالی را که همین حالا خبر گرفته حذف می‌کند تا پیام دوبار نرسد.
 * ایمیل عمداً نیست. هرگز خطا پرتاب نمی‌کند؛ فراخواننده آن را در گام بدون تلاش مجدد صدا بزند.
 */
import type { Env } from "./env";
import type { Uid } from "./settings";
import { notifyUser, type NotifyKind } from "./notify";
import { appReadyMarkup } from "./deck-service";

export interface DoneNotice {
  /** عنوان اعلان اپ/مرورگر */ title: string;
  /** متن ساده‌ی اعلان اپ/مرورگر */ body: string;
  /** متن پیام‌رسان‌ها (HTML تلگرامی) */ html: string;
  /** برچسب اعلان اپ/مرورگر (مثلاً deck-done) */ tag: string;
  /** شناسه‌ی فایل برای دکمه‌ی «مشاهده در سایت» */ fileId?: string;
  /** دکمه‌ی Google Slides هم باشد؟ (فقط پیام ارائه) */ slides?: boolean;
  /** کانال تحویل وب بود؟ (سایت، اپ یا مینی‌اپ) */ web: boolean;
  /** فقط وب: از مینی‌اپ/ایتا بود؟ */ viaMiniApp: boolean;
  /** پلتفرم مبدأ (bazaar/myket/app/ios = اپ) */ plat?: string;
  /** چتی که همین حالا پیام همین رویداد را گرفته (ربات: همان چت؛ مینی‌اپ: چت پیام مینی‌اپ) */ originChat?: number | null;
}

export async function notifyOtherChannels(env: Env, uid: Uid, d: DoneNotice): Promise<void> {
  try {
    const appOrigin = d.plat === "bazaar" || d.plat === "myket" || d.plat === "app" || d.plat === "ios"; // اپ خودش اعلان محلی نشان می‌دهد
    const except: NotifyKind[] = ["email"];
    if (appOrigin) except.push("app");
    if (d.web && !d.viaMiniApp) except.push("web"); // وب‌پوش همین کاربر قبلاً رفته
    const r = await notifyUser(env, uid, {
      title: d.title, body: d.body, html: d.html, tag: d.tag, url: "/",
      extra: (id) => appReadyMarkup(env, id, d.fileId, d.slides ?? false),
      except,
      ...(d.originChat ? { exceptIds: [d.originChat] } : {}),
    });
    console.log("notify-others", d.tag, JSON.stringify({ delivered: r.delivered, failed: r.failed, reachable: r.reachable }));
  } catch (e) {
    console.error("notify-others", String(e).slice(0, 200));
  }
}
