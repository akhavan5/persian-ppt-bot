/**
 * نسخه‌ی اپ اندروید (versionCode) که /api/config به اپ می‌دهد؛ برای هر فروشگاه جدا (بازار و مایکت تاییدشان همزمان نیست).
 *  - latest: آخرین نسخه‌ی منتشرشده در همان فروشگاه ⇒ کاربرانِ پایین‌تر «نسخه‌ی جدید موجود است» می‌بینند (قابل رد کردن)
 *  - min: حداقل نسخه‌ی مجاز در همان فروشگاه ⇒ کاربرانِ پایین‌تر فقط صفحه‌ی «به‌روزرسانی لازم است» را می‌بینند (۰ = بدون بررسی)
 * مدیر از پنل ربات (/admin ← 📱 اپ اندروید؛ یا دستور /appver) برای هر فروشگاه مقدار را (بدون دیپلوی) عوض می‌کند؛
 * فروشگاهی که مقدار دستی ندارد از ANDROID_LATEST_VERSION و ANDROID_MIN_VERSION خوانده می‌شود.
 * ذخیره در KV: app:ver = { bazaar?: {latest, min}, myket?: {latest, min} } (قالب قدیمی {latest, min} برای هر دو فروشگاه خوانده می‌شود).
 */
import type { Env } from "./env";
import { esc, sendMessage } from "./telegram";
import { toFa } from "./util";

const KEY = "app:ver";

export const STORES = ["bazaar", "myket"] as const;
export type StoreId = (typeof STORES)[number];
export const STORE_NAMES: Record<StoreId, string> = { bazaar: "کافه‌بازار", myket: "مایکت" };
export const isStoreId = (x: unknown): x is StoreId => typeof x === "string" && (STORES as readonly string[]).includes(x);

export interface StoreVer { latest: number; min: number; manual: boolean }
export interface AppVersions {
  stores: Record<StoreId, StoreVer>;
  /** برای نسخه‌های قدیمی اپ که فقط app.latest/app.min را می‌شناسند: کمترین مقدار بین فروشگاه‌ها (هیچ‌کس به‌اشتباه قفل نمی‌شود) */
  latest: number;
  min: number;
  url: string;
  urls: { bazaar: string; myket: string };
}

type Entry = { latest: number; min: number };
const num = (x: unknown) => (Number.isInteger(x) && (x as number) >= 0 ? (x as number) : null);
const entryOf = (o: any): Entry | null => (o && num(o.latest) !== null && num(o.min) !== null ? { latest: o.latest, min: o.min } : null);

/** مقدارهای دستیِ ذخیره‌شده برای هر فروشگاه (قالب قدیمی به هر دو فروشگاه نسبت داده می‌شود) */
async function readManual(env: Env): Promise<Partial<Record<StoreId, Entry>>> {
  let o: any = null;
  try { o = await env.KV.get(KEY, "json"); } catch { /* بدون مقدار دستی */ }
  const legacy = entryOf(o);
  const out: Partial<Record<StoreId, Entry>> = {};
  for (const s of STORES) { const e = entryOf(o?.[s]) ?? legacy; if (e) out[s] = e; }
  return out;
}

export async function getAppVersions(env: Env): Promise<AppVersions> {
  const man = await readManual(env);
  const envLatest = Number(env.ANDROID_LATEST_VERSION) || 0, envMin = Number(env.ANDROID_MIN_VERSION) || 0;
  const stores = {} as Record<StoreId, StoreVer>;
  for (const s of STORES) { const e = man[s]; stores[s] = e ? { ...e, manual: true } : { latest: envLatest, min: envMin, manual: false }; }
  const pkg = (env.ANDROID_PACKAGE || "ir.pptsaz.app").trim();
  const custom = (env.ANDROID_UPDATE_URL ?? "").trim();
  const bazaar = (env.ANDROID_UPDATE_URL_BAZAAR ?? "").trim() || custom || `https://cafebazaar.ir/app/${pkg}`;
  const myket = (env.ANDROID_UPDATE_URL_MYKET ?? "").trim() || `https://myket.ir/app/${pkg}`;
  return {
    stores,
    latest: Math.min(...STORES.map((s) => stores[s].latest)),
    min: Math.min(...STORES.map((s) => stores[s].min)),
    url: custom || `https://cafebazaar.ir/app/${pkg}`, // برای نسخه‌های قدیمی اپ که فقط url را می‌شناسند
    urls: { bazaar, myket },
  };
}

export const APPVER_HELP =
  "<code>1</code> — آخرین نسخه ۱ (حداقل مجاز همان قبلی)\n<code>5 3</code> — آخرین ۵، و نسخه‌های زیر ۳ اجباری به‌روزرسانی شوند\n<code>5 0</code> — بدون به‌روزرسانی اجباری";
const CMD_HELP =
  "<code>/appver bazaar 5 3</code> — فقط بازار: آخرین ۵ و حداقل ۳\n<code>/appver myket 4</code> — فقط مایکت: آخرین ۴ (حداقل همان قبلی)\n<code>/appver all 5 0</code> — هر دو فروشگاه\n<code>/appver clear myket</code> — برگشت مایکت به متغیرهای محیطی (<code>clear</code> تنها: هر دو)";

/** متن وضعیت نسخه‌ی اپ (برای پنل و دستور /appver) */
export async function appVerText(env: Env): Promise<string> {
  const v = await getAppVersions(env);
  const n = (x: number) => toFa(String(x));
  const line = (s: StoreId) => {
    const x = v.stores[s];
    return `<b>${STORE_NAMES[s]}</b> (${x.manual ? "دستی" : "متغیر محیطی"}): آخرین ${x.latest ? n(x.latest) : "اعلام نشده"} · حداقل مجاز ${x.min ? n(x.min) : "بدون بررسی"}`;
  };
  return "📱 <b>نسخه‌ی اپ اندروید</b> (جدا برای هر فروشگاه)\n" + STORES.map(line).join("\n") +
    "\n<i>پایین‌تر از «آخرین» پیشنهاد به‌روزرسانی، و پایین‌تر از «حداقل» به‌روزرسانی اجباری می‌بیند.</i>\n" +
    `بازار: ${esc(v.urls.bazaar)}\nمایکت: ${esc(v.urls.myket)}`;
}

/**
 * تنظیم نسخه برای یک فروشگاه یا هر دو: a = [آخرین] یا [آخرین، حداقل] یا ["clear"].
 * ok=false یعنی ورودی نامعتبر بوده و چیزی ذخیره نشده (اگر برای یکی از فروشگاه‌ها نامعتبر باشد برای هیچ‌کدام ذخیره نمی‌شود).
 */
export async function applyAppVer(env: Env, target: StoreId | "all", a: string[]): Promise<{ ok: boolean; msg: string }> {
  const targets: readonly StoreId[] = target === "all" ? STORES : [target];
  const man = await readManual(env);
  if (a[0] === "clear") {
    for (const s of targets) delete man[s];
    if (STORES.some((s) => man[s])) await env.KV.put(KEY, JSON.stringify(man)); else await env.KV.delete(KEY);
    return { ok: true, msg: `✅ تنظیم دستی ${target === "all" ? "هر دو فروشگاه" : STORE_NAMES[target]} پاک شد؛ از متغیرهای محیطی خوانده می‌شود.` };
  }
  if (!a.length) return { ok: false, msg: `عددی وارد نشد.\n\n${APPVER_HELP}` };
  const cur = await getAppVersions(env);
  const latest = Number(a[0]);
  if (!Number.isInteger(latest) || latest < 0 || (a.length > 1 && (!Number.isInteger(Number(a[1])) || Number(a[1]) < 0))) return { ok: false, msg: `عدد نامعتبر است.\n\n${APPVER_HELP}` };
  for (const s of targets) {
    const min = a.length > 1 ? Number(a[1]) : cur.stores[s].min;
    // حداقل مجاز بالاتر از آخرین نسخه‌ی منتشرشده یعنی قفل شدن همه‌ی کاربران؛ اجازه نمی‌دهیم
    if (min > latest) return { ok: false, msg: `⛔️ ${STORE_NAMES[s]}: حداقل مجاز (${toFa(String(min))}) نباید از آخرین نسخه (${toFa(String(latest))}) بیشتر باشد؛ همه‌ی کاربران قفل می‌شدند.\n\n${APPVER_HELP}` };
    man[s] = { latest, min };
  }
  await env.KV.put(KEY, JSON.stringify(man));
  return { ok: true, msg: `✅ ذخیره شد (${target === "all" ? "هر دو فروشگاه" : STORE_NAMES[target]}).` };
}

const PANEL_KB = { reply_markup: { inline_keyboard: [[{ text: "📱 باز کردن در پنل (دکمه‌ای)", callback_data: "ad:ap" }]] } };

/** /appver  |  /appver <bazaar|myket|all> <آخرین> [<حداقل>]  |  /appver clear [bazaar|myket|all] — نسخه‌ی دکمه‌ای در پنل مدیر: /admin ← 📱 اپ اندروید */
export async function appVerCommand(env: Env, chatId: number, text: string): Promise<void> {
  const a = text.trim().split(/\s+/).slice(1).map((x) => x.toLowerCase());
  if (!a.length) return void (await sendMessage(env, chatId, `${await appVerText(env)}\n\n${CMD_HELP}`, PANEL_KB));
  let target: StoreId | "all" | null = null;
  if (a[0] === "clear") { const t = a[1] ?? "all"; target = t === "all" || isStoreId(t) ? t : null; if (target) a.splice(1); }
  else if (a[0] === "all" || isStoreId(a[0])) { target = a[0] as StoreId | "all"; a.shift(); }
  if (!target) return void (await sendMessage(env, chatId, `فروشگاه را مشخص کن: bazaar، myket یا all.\n\n${CMD_HELP}`, PANEL_KB));
  const r = await applyAppVer(env, target, a);
  await sendMessage(env, chatId, r.ok ? `${r.msg}\n\n${await appVerText(env)}` : `${r.msg}\n\n${CMD_HELP}`, PANEL_KB);
}
