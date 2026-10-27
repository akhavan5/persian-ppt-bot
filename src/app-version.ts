/**
 * نسخه‌ی اپ اندروید (versionCode) که /api/config به اپ می‌دهد.
 *  - latest: آخرین نسخه‌ی منتشرشده ⇒ کاربرانِ پایین‌تر «نسخه‌ی جدید موجود است» می‌بینند (قابل رد کردن)
 *  - min: حداقل نسخه‌ی مجاز ⇒ کاربرانِ پایین‌تر فقط صفحه‌ی «به‌روزرسانی لازم است» را می‌بینند (۰ = بدون بررسی)
 * مدیر با /appver در ربات مقدار را (بدون دیپلوی) عوض می‌کند؛ بدون آن، از ANDROID_LATEST_VERSION و ANDROID_MIN_VERSION خوانده می‌شود.
 */
import type { Env } from "./env";
import { esc, sendMessage } from "./telegram";
import { toFa } from "./util";

const KEY = "app:ver";

export interface AppVersions { latest: number; min: number; url: string; urls: { bazaar: string; myket: string }; manual: boolean }

export async function getAppVersions(env: Env): Promise<AppVersions> {
  let o: { latest?: unknown; min?: unknown } | null = null;
  try { o = await env.KV.get(KEY, "json"); } catch { /* بدون مقدار دستی */ }
  const num = (x: unknown) => (Number.isInteger(x) && (x as number) >= 0 ? (x as number) : null);
  const manual = !!o && num(o.latest) !== null && num(o.min) !== null;
  const pkg = (env.ANDROID_PACKAGE || "ir.pptsaz.app").trim();
  const custom = (env.ANDROID_UPDATE_URL ?? "").trim();
  const bazaar = (env.ANDROID_UPDATE_URL_BAZAAR ?? "").trim() || custom || `https://cafebazaar.ir/app/${pkg}`;
  const myket = (env.ANDROID_UPDATE_URL_MYKET ?? "").trim() || `https://myket.ir/app/${pkg}`;
  return {
    latest: manual ? (o!.latest as number) : Number(env.ANDROID_LATEST_VERSION) || 0,
    min: manual ? (o!.min as number) : Number(env.ANDROID_MIN_VERSION) || 0,
    url: custom || `https://cafebazaar.ir/app/${pkg}`, // برای نسخه‌های قدیمی اپ که فقط url را می‌شناسند
    urls: { bazaar, myket },
    manual,
  };
}

const HELP = "<code>/appver 5</code> — آخرین نسخه ۵ (حداقل مجاز همان قبلی)\n<code>/appver 5 3</code> — آخرین ۵، و نسخه‌های زیر ۳ اجباری به‌روزرسانی شوند\n<code>/appver 5 0</code> — بدون به‌روزرسانی اجباری\n<code>/appver clear</code> — برگشت به متغیرهای محیطی";

async function status(env: Env, chatId: number, head: string) {
  const v = await getAppVersions(env);
  const n = (x: number) => toFa(String(x));
  await sendMessage(env, chatId,
    `${head}📱 <b>نسخه‌ی اپ اندروید</b> (${v.manual ? "تنظیم دستی با /appver" : "از متغیرهای محیطی"})\n` +
    `آخرین نسخه: ${v.latest ? n(v.latest) : "اعلام نشده"}${v.latest ? " — پایین‌تر از آن پیشنهاد به‌روزرسانی می‌بیند" : ""}\n` +
    `حداقل مجاز: ${v.min ? n(v.min) : "بدون بررسی"}${v.min ? ` — پایین‌تر از آن به‌روزرسانی اجباری می‌بیند` : ""}\n` +
    `بازار: ${esc(v.urls.bazaar)}\nمایکت: ${esc(v.urls.myket)}\n\n${HELP}`);
}

/** /appver  |  /appver <آخرین> [<حداقل>]  |  /appver clear */
export async function appVerCommand(env: Env, chatId: number, text: string): Promise<void> {
  const a = text.trim().split(/\s+/).slice(1).map((x) => x.toLowerCase());
  if (a[0] === "clear") {
    await env.KV.delete(KEY);
    return void (await status(env, chatId, "✅ تنظیم دستی پاک شد.\n\n"));
  }
  if (a.length) {
    const cur = await getAppVersions(env);
    const latest = Number(a[0]);
    const min = a.length > 1 ? Number(a[1]) : cur.min;
    if (!Number.isInteger(latest) || !Number.isInteger(min) || latest < 0 || min < 0) return void (await sendMessage(env, chatId, `عدد نامعتبر است.\n\n${HELP}`));
    // حداقل مجاز بالاتر از آخرین نسخه‌ی منتشرشده یعنی قفل شدن همه‌ی کاربران؛ اجازه نمی‌دهیم
    if (min > latest) return void (await sendMessage(env, chatId, `⛔️ حداقل مجاز (${toFa(String(min))}) نباید از آخرین نسخه (${toFa(String(latest))}) بیشتر باشد؛ همه‌ی کاربران قفل می‌شدند.\n\n${HELP}`));
    await env.KV.put(KEY, JSON.stringify({ latest, min }));
    return void (await status(env, chatId, "✅ ذخیره شد.\n\n"));
  }
  await status(env, chatId, "");
}
