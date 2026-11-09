/**
 * User-Agent اپ‌های بومی: «PptSazApp/<نسخه> (<مشخصات>)»؛ مشخصات با «;» جدا می‌شود.
 *  - اندروید: «PptSazApp/1.0.4 (myket; Android 14)»
 *  - iOS:     «PptSazApp/1.0.0 (ios; iOS 17.2)»  (iOS راهی برای فهمیدن فروشگاه نصب ندارد؛ فقط سیستم‌عامل و نسخه ثبت می‌شود)
 * فقط برای آمار و گزارش مدیر است (امنیتی نیست). نسخه‌های قدیمی اندروید فقط «PptSazApp/<نسخه>» می‌فرستند؛ فروشگاهشان معلوم نیست
 * و در آمار زیر «اپ قدیمی» می‌آیند.
 *
 * PWA (نصب‌شده از Safari/Chrome با «Add to Home Screen») User-Agent جدا ندارد؛ خود صفحه (index.html) در حالت standalone
 * هدر «x-pwa: ios | other» می‌فرستد و pwaOf() آن را می‌خواند. iPhone/iPad از navigator.standalone تشخیص داده می‌شود.
 */
export type AndroidStore = "bazaar" | "myket";
export type AppStore = AndroidStore;
export type AppOs = "android" | "ios";

const ANDROID_STORES: readonly string[] = ["bazaar", "myket"];
export const STORE_LABEL: Record<AppStore, string> = { bazaar: "کافه‌بازار", myket: "مایکت" };

export interface AppUA { os: AppOs | null; store: AppStore | null; ver: string; /** نسخه‌ی سیستم‌عامل دستگاه (اندروید یا iOS) */ osv: string | null }

export function parseAppUA(ua: string | null | undefined): AppUA | null {
  const m = /PptSazApp\/([\w.\-]{1,20})(?:\s*\(([^)]{0,80})\))?/.exec(ua ?? "");
  if (!m) return null;
  let os: AppOs | null = null, store: AppStore | null = null, osv: string | null = null;
  for (const raw of (m[2] ?? "").split(";")) {
    const t = raw.trim().toLowerCase();
    const a = /^android\s+([\w.]{1,12})$/.exec(t), i = /^ios\s+([\w.]{1,12})$/.exec(t);
    if (a) { os = "android"; osv = a[1]; }
    else if (i) { os = "ios"; osv = i[1]; }
    else if (t === "ios") os = "ios";
    else if (ANDROID_STORES.includes(t)) store = t as AndroidStore;
  }
  if (store && !os) os = "android"; // فروشگاه اندروید ⇒ اندروید
  return { os, store, ver: m[1], osv };
}

/** پلتفرم آمار. اندروید: bazaar | myket | app (نسخه‌ی قدیمی بدون فروشگاه)؛ iOS: ios؛ وب نصب‌شده: pwa_ios | pwa */
export type AppPlatform = AndroidStore | "app" | "ios";
export type PwaPlatform = "pwa_ios" | "pwa";

export const appPlatform = (a: AppUA): AppPlatform =>
  a.os === "ios" ? "ios" : (a.store ?? "app");

/** فیلدهایی که روی حساب کاربر نگه داشته می‌شود (فقط مقدارهای معلوم). andv = نسخه‌ی سیستم‌عامل (اندروید یا iOS؛ os مشخص می‌کند کدام) */
export const appFields = (a: AppUA) => ({
  ...(a.os ? { os: a.os } : {}),
  ...(a.store ? { store: a.store } : {}),
  appv: a.ver,
  ...(a.osv ? { andv: a.osv } : {}),
});

/** درخواست از وب‌اپ نصب‌شده (PWA)؟ هدر x-pwa را خود صفحه در حالت standalone می‌فرستد؛ iPhone/iPad = "ios"، بقیه = "other" */
export const pwaOf = (req: Request): "ios" | "other" | null => {
  const h = (req.headers.get("x-pwa") ?? "").trim().toLowerCase();
  return h === "ios" ? "ios" : h === "other" ? "other" : null;
};
export const pwaPlatform = (p: "ios" | "other"): PwaPlatform => (p === "ios" ? "pwa_ios" : "pwa");

/** برچسب نسخه‌ی سیستم‌عامل برای نمایش: «A14» / «iOS 17.2» */
export const osTag = (os: AppOs | null | undefined, v: string) => (os === "ios" ? `iOS ${v}` : `A${v}`);
