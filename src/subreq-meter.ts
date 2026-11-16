/**
 * شمارنده‌ی زیردرخواست‌های خروجی (fetch) برای هر اجرای Worker/Workflow.
 *
 * چرا: سقف ۵۰ زیردرخواست (پلن رایگان) برای کل نمونه است و بعد از رسیدن به آن «هر» زیردرخواست دیگری هم رد می‌شود؛
 * از جمله خودِ ساختن نمونه‌ی بعدی (AUDIO_WORKFLOW.create) و ویرایش پیام وضعیت. یعنی اگر تازه «بعد از» خطای سقف بخواهیم کار را
 * به نمونه‌ی بعدی بسپاریم، دیگر دیر شده است. این ماژول هر fetch را می‌شمارد و:
 *   ۱) پیش از شروع هر واحد کار (یک اسلاید، یک دسته MP3، …) می‌شود پرسید «جا برای یک واحد دیگر هست؟» (hasRoom)؛
 *   ۲) اگر وسط یک گام از «سقف نرم» رد شد، fetch را همان‌جا با خطای «Too many subrequests» رد می‌کند (قبل از ارسال)،
 *      پس چند زیردرخواست آخر برای handoff و پیام خطا سالم می‌مانند.
 */
import { AsyncLocalStorage } from "node:async_hooks";

/** سقف واقعی Cloudflare در پلن رایگان */
export const SUBREQ_LIMIT = 50;
/** ذخیره برای handoff (create + تلاش‌های مجدد) و پیام وضعیت */
export const SUBREQ_RESERVE = 8;

export class SubreqMeter {
  /** تعداد fetch انجام‌شده در این اجرا */
  n = 0;
  /** سقف نرم؛ بالاتر از آن fetch در کدِ شمرده‌شده رد می‌شود */
  cap = SUBREQ_LIMIT - SUBREQ_RESERVE;
  /** هزینه‌ی کارهایی که از راه fetch سراسری نمی‌گذرند (مثلاً مرورگر Browser Rendering) را دستی اضافه کن */
  charge(k: number) { this.n += k; }
  /** آیا برای کاری که در بدترین حالت متعارف k زیردرخواست می‌خواهد جا هست؟ */
  hasRoom(k: number) { return this.n + k <= this.cap; }
}

const als = new AsyncLocalStorage<SubreqMeter>();
let installed = false;

function install() {
  if (installed) return;
  installed = true;
  const orig = globalThis.fetch.bind(globalThis);
  globalThis.fetch = ((input: any, init?: any) => {
    const m = als.getStore();
    if (m) {
      if (m.n >= m.cap) return Promise.reject(new TypeError("Too many subrequests by single Worker invocation (self-limit)"));
      m.n++;
    }
    return orig(input, init);
  }) as typeof fetch;
}

/** fn را طوری اجرا می‌کند که همه‌ی fetchهایش (و کدهای async زیرمجموعه‌اش) روی m شمرده شوند */
export function metered<T>(m: SubreqMeter, fn: () => Promise<T>): Promise<T> {
  install();
  return als.run(m, fn);
}
