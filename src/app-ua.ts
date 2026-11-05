/**
 * User-Agent اپ اندروید: «PptSazApp/<نسخه> (<فروشگاه>; Android <نسخه‌ی اندروید>)»، مثلاً «PptSazApp/1.0.4 (myket; Android 14)».
 * فقط برای آمار و گزارش مدیر است (امنیتی نیست). نسخه‌های قدیمی اپ فقط «PptSazApp/<نسخه>» می‌فرستند؛ فروشگاهشان معلوم نیست
 * و در آمار زیر «اپ قدیمی» می‌آیند (فروشگاه فقط از نسخه‌ای که این بخش را دارد به بعد درست شمرده می‌شود).
 */
export type AppStore = "bazaar" | "myket";
const APP_STORES: readonly string[] = ["bazaar", "myket"];

export interface AppUA { store: AppStore | null; ver: string; android: string | null }

export function parseAppUA(ua: string | null | undefined): AppUA | null {
  const m = /PptSazApp\/([\w.\-]{1,20})(?:\s*\(([^)]{0,80})\))?/.exec(ua ?? "");
  if (!m) return null;
  let store: AppStore | null = null, android: string | null = null;
  for (const raw of (m[2] ?? "").split(";")) {
    const t = raw.trim();
    const a = /^Android\s+([\w.]{1,12})$/i.exec(t);
    if (a) android = a[1];
    else if (APP_STORES.includes(t.toLowerCase())) store = t.toLowerCase() as AppStore;
  }
  return { store, ver: m[1], android };
}

/** پلتفرم آمار: bazaar | myket (نسخه‌ی جدید)، app (نسخه‌ی قدیمی بدون فروشگاه) */
export const appPlatform = (a: AppUA): "bazaar" | "myket" | "app" => a.store ?? "app";

/** فیلدهایی که روی حساب کاربر نگه داشته می‌شود (فقط مقدارهای معلوم) */
export const appFields = (a: AppUA) => ({
  ...(a.store ? { store: a.store } : {}),
  appv: a.ver,
  ...(a.android ? { andv: a.android } : {}),
});
