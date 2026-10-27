/**
 * نسخه‌ی اپ اندروید (versionCode) که /api/config به اپ می‌دهد.
 *  - latest: آخرین نسخه‌ی منتشرشده ⇒ کاربرانِ پایین‌تر «نسخه‌ی جدید موجود است» می‌بینند (قابل رد کردن)
 *  - min: حداقل نسخه‌ی مجاز ⇒ کاربرانِ پایین‌تر فقط صفحه‌ی «به‌روزرسانی لازم است» را می‌بینند (۰ = بدون بررسی)
 * مدیر از پنل ربات (/admin ← 📱 اپ اندروید؛ یا دستور /appver) مقدار را (بدون دیپلوی) عوض می‌کند؛ بدون آن، از ANDROID_LATEST_VERSION و ANDROID_MIN_VERSION خوانده می‌شود.
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

export const APPVER_HELP = "<code>5</code> — آخرین نسخه ۵ (حداقل مجاز همان قبلی)\n<code>5 3</code> — آخرین ۵، و نسخه‌های زیر ۳ اجباری به‌روزرسانی شوند\n<code>5 0</code> — بدون به‌روزرسانی اجباری";

/** متن وضعیت نسخه‌ی اپ (برای پنل و دستور /appver) */
export async function appVerText(env: Env): Promise<string> {
  const v = await getAppVersions(env);
  const n = (x: number) => toFa(String(x));
  return `📱 <b>نسخه‌ی اپ اندروید</b> (${v.manual ? "تنظیم دستی از پنل" : "از متغیرهای محیطی"})\n` +
    `آخرین نسخه: ${v.latest ? n(v.latest) : "اعلام نشده"}${v.latest ? " — پایین‌تر از آن پیشنهاد به‌روزرسانی می‌بیند" : ""}\n` +
    `حداقل مجاز: ${v.min ? n(v.min) : "بدون بررسی"}${v.min ? ` — پایین‌تر از آن به‌روزرسانی اجباری می‌بیند` : ""}\n` +
    `بازار: ${esc(v.urls.bazaar)}\nمایکت: ${esc(v.urls.myket)}`;
}

/** تنظیم نسخه: [آخرین] یا [آخرین، حداقل] یا ["clear"]. ok=false یعنی ورودی نامعتبر بوده و چیزی ذخیره نشده */
export async function applyAppVer(env: Env, a: string[]): Promise<{ ok: boolean; msg: string }> {
  if (a[0] === "clear") {
    await env.KV.delete(KEY);
    return { ok: true, msg: "✅ تنظیم دستی پاک شد؛ از متغیرهای محیطی خوانده می‌شود." };
  }
  if (!a.length) return { ok: false, msg: `عددی وارد نشد.\n\n${APPVER_HELP}` };
  const cur = await getAppVersions(env);
  const latest = Number(a[0]);
  const min = a.length > 1 ? Number(a[1]) : cur.min;
  if (!Number.isInteger(latest) || !Number.isInteger(min) || latest < 0 || min < 0) return { ok: false, msg: `عدد نامعتبر است.\n\n${APPVER_HELP}` };
  // حداقل مجاز بالاتر از آخرین نسخه‌ی منتشرشده یعنی قفل شدن همه‌ی کاربران؛ اجازه نمی‌دهیم
  if (min > latest) return { ok: false, msg: `⛔️ حداقل مجاز (${toFa(String(min))}) نباید از آخرین نسخه (${toFa(String(latest))}) بیشتر باشد؛ همه‌ی کاربران قفل می‌شدند.\n\n${APPVER_HELP}` };
  await env.KV.put(KEY, JSON.stringify({ latest, min }));
  return { ok: true, msg: "✅ ذخیره شد." };
}

const PANEL_KB = { reply_markup: { inline_keyboard: [[{ text: "📱 باز کردن در پنل (دکمه‌ای)", callback_data: "ad:ap" }]] } };

/** /appver  |  /appver <آخرین> [<حداقل>]  |  /appver clear — نسخه‌ی دکمه‌ای در پنل مدیر: /admin ← 📱 اپ اندروید */
export async function appVerCommand(env: Env, chatId: number, text: string): Promise<void> {
  const a = text.trim().split(/\s+/).slice(1).map((x) => x.toLowerCase());
  const r = a.length ? await applyAppVer(env, a) : null;
  if (r && !r.ok) return void (await sendMessage(env, chatId, r.msg, PANEL_KB));
  await sendMessage(env, chatId, `${r ? r.msg + "\n\n" : ""}${await appVerText(env)}`, PANEL_KB);
}
