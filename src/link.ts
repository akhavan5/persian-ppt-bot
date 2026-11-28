/**
 * پروفایل وب خودکار برای کاربران ربات تلگرام (تلگرام‌محور).
 *
 * هر کاربر ربات از اولین پیام یک پروفایل وب می‌گیرد (ensureUid)؛ شناسه‌ی پروفایل از شناسه‌ی تلگرام ساخته می‌شود
 * (ثابت و بی‌تکرار). ربات برای همه‌ی کارها (اعتبار، پلن، تنظیمات، قفل، فایل) از شناسه‌ی همین پروفایل استفاده می‌کند.
 * دکمه‌های خرید در ربات لینک ورود یک‌بارمصرف دارند (createLoginToken ← /api/auth/tg)؛ مالکیت تلگرام را خود تلگرام ثابت می‌کند
 * چون لینک فقط به چت خود کاربر فرستاده می‌شود. مدیرها (ADMIN_IDS) پروفایل خودکار ندارند و شناسه‌ی عددی می‌مانند.
 *
 * چند پیام‌رسان همزمان: یک حساب می‌تواند به «هر پلتفرم یک هویت» وصل باشد (تلگرام + بله + ایتا + روبیکا + سروش‌پلاس).
 *  - w2ids:<حساب> = آرایه‌ی JSON همه‌ی هویت‌های وصل‌شده؛ w2tg:<حساب> = «هویت اصلی» (اولین وصل‌شده) و برای کدهای قدیمی می‌ماند
 *  - nto:<حساب> = آرایه‌ی کانال‌هایی که کاربر اعلان‌شان را خاموش کرده (پیش‌فرض: اعلان به همه‌ی پیام‌رسان‌های وصل‌شده می‌رسد)
 *  - اتصال فقط با «شماره‌ی موبایل» است (profile.ts ← attachContact): کاربر در هر پیام‌رسان/اپ همان شماره را تأیید می‌کند و هویت آن به حسابِ دارنده‌ی شماره وصل می‌شود
 */
import type { Env } from "./env";
import { getUserById, hitLimit, randomToken, saveWebUser } from "./auth";
import { botPlatform, getBonus, getSub, grantSignupCredit, isAdmin, isBanned, putSub, setBonus, type Uid } from "./settings";
import { sendMessage } from "./telegram";
import { moveFiles } from "./files";
import { fcmTokensOf } from "./push";
import { WP_PREFIX, parseDevices, webPushEnabled } from "./webpush";
import { fromBaleId } from "./bale-format";
import { fromEitaaId } from "./eitaa-format";
import { fromSplusId } from "./splus-format";

const LOGIN_TTL = 3600; // ثانیه؛ لینک ورود از دکمه‌های ربات (یک‌بارمصرف)
const WEB_ID = /^w_[0-9a-f]{16}$/;

/** شناسه‌ی اصلی کاربر: اگر پروفایل وبش ساخته شده شناسه‌ی آن؛ وگرنه (مدیر/پیش از اولین پیام) خود شناسه‌ی تلگرام */
export async function resolveUid(env: Env, tgId: number): Promise<Uid> {
  if (isAdmin(env, tgId)) return tgId;
  const w = await env.KV.get(`tg2w:${tgId}`).catch(() => null);
  return w && WEB_ID.test(w) ? w : tgId;
}

const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
/** شناسه‌ی ثابت پروفایل هر تلگرام؛ ثابت بودنش یعنی ساخت دوباره/هم‌زمان هرگز حساب تکراری نمی‌سازد */
async function profileId(tgId: number): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`tg:${tgId}`)));
  return "w_" + hex(d.slice(0, 8));
}

/** هر کاربر ربات یک پروفایل وب دارد؛ اگر نبود با نام تلگرام ساخته می‌شود. مدیرها شناسه‌ی عددی می‌مانند. */
export async function ensureUid(env: Env, tgId: number, name = ""): Promise<Uid> {
  const cur = await resolveUid(env, tgId);
  if (typeof cur === "string" || isAdmin(env, tgId)) return cur;
  const id = await profileId(tgId);
  if (!(await getUserById(env, id))) {
    await saveWebUser(env, { id, email: "", name: (name || "کاربر تلگرام").slice(0, 64), verified: false, created: Date.now() });
    await grantSignupCredit(env, id).catch((e) => console.error("signupCredit", e)); // ۱ اعتبار هدیه‌ی ثبت‌نام (فقط یک‌بار)
  }
  await env.KV.put(`tg2w:${tgId}`, id);
  await env.KV.put(`w2tg:${id}`, String(tgId)); // نگاشت معکوس: برای نمایش تلگرام وصل‌شده در پروفایل وب
  return id;
}

/** لینک ورود یک‌بارمصرف به سایت برای این تلگرام (اعتبار ۱ ساعت)؛ null = محدودیت تعداد */
export async function createLoginToken(env: Env, tgId: number): Promise<string | null> {
  if (await hitLimit(env, `tglr:${tgId}`, 40, 3600)) return null;
  const t = randomToken(24);
  await env.KV.put(`tgl:${t}`, String(tgId), { expirationTtl: LOGIN_TTL });
  return t;
}
export async function consumeLoginToken(env: Env, token: string): Promise<number | null> {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return null;
  const v = await env.KV.get(`tgl:${token}`);
  if (!v) return null;
  await env.KV.delete(`tgl:${token}`).catch(() => {});
  const n = Number(v);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

/** لینک ورود یک‌بارمصرفِ کاربرِ اپ (اندروید/iOS) به سایت: بر پایه‌ی شناسه‌ی حساب وب (نه تلگرام)، اعتبار ۵ دقیقه.
 *  فقط پس از احرازِ نشستِ خودِ اپ ساخته می‌شود (POST /api/app/site-link) و با GET /api/auth/web مصرف می‌شود. */
export async function createWebLoginToken(env: Env, uid: string): Promise<string> {
  const t = randomToken(24);
  await env.KV.put(`wlt:${t}`, uid, { expirationTtl: 300 });
  return t;
}
export async function consumeWebLoginToken(env: Env, token: string): Promise<string | null> {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return null;
  const v = await env.KV.get(`wlt:${token}`);
  if (!v) return null;
  await env.KV.delete(`wlt:${token}`).catch(() => {});
  return v;
}

/** تلگرام وصل‌شده به این حساب وب (اگر باشد)؛ «هویت اصلی» حساب. فهرست همه‌ی پیام‌رسان‌ها: getLinkedIds */
export async function getLinkedTg(env: Env, uid: string): Promise<number | null> {
  const n = Number(await env.KV.get(`w2tg:${uid}`).catch(() => null));
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

type LinkErr = { error: string; status: number };

/** تلگرام را به حساب وب وصل می‌کند؛ اعتبار هدیه/شارژ و پلنِ پروفایل خودکارِ قبلیِ این تلگرام (اگر بود) به حساب وب منتقل می‌شود تا چیزی از دست نرود */
async function performLink(env: Env, uid: string, tgId: number) {
  const auto = await profileId(tgId);
  if (auto !== uid) {
    const ab = await getBonus(env, auto);
    if (ab > 0) {
      await setBonus(env, auto, 0);
      await setBonus(env, uid, (await getBonus(env, uid)) + ab);
    }
    const asub = await getSub(env, auto);
    if (asub && !(await getSub(env, uid))) {
      await putSub(env, uid, asub);
      await env.KV.delete(`sub:${auto}`);
    }
    // فایل‌های ۲۴ ساعت اخیرِ همین پیام‌رسان هم به حساب اصلی می‌روند تا در همه‌ی پلتفرم‌ها در دسترس باشند
    await moveFiles(env, auto, uid).catch((e) => console.error("link moveFiles", String(e).slice(0, 160)));
  }
  await env.KV.put(`tg2w:${tgId}`, uid);
  await addLinkedId(env, uid, tgId); // هویت اصلی (w2tg) فقط وقتی نبود ست می‌شود؛ پیام‌رسان‌های دیگر کنارش می‌مانند
}

/** پیش‌بررسی اتصال هویت ربات به حساب `uid`: خطا ⇒ {error,status}؛ قبلاً همین‌جا وصل است ⇒ {ok:true} (فقط فهرست اصلاح می‌شود)؛ آزاد برای اتصال ⇒ null (performLink اجرا می‌شود).
 *  (این تابع در کد وجود نداشت و linkBotToAccount با ReferenceError می‌افتاد؛ مثلاً هنگام ثبت شماره‌ای که مال حساب دیگری است.) */
async function linkCheck(env: Env, uid: string, botId: number): Promise<LinkErr | { ok: true } | null> {
  const cur = await env.KV.get(`tg2w:${botId}`).catch(() => null);
  if (cur === uid) { await addLinkedId(env, uid, botId); return { ok: true }; }
  // این هویت قبلاً به یک حساب «واقعی» دیگر وصل شده (نه پروفایل خودکار خودش)
  if (cur && WEB_ID.test(cur) && cur !== (await profileId(botId))) return { error: "این پیام‌رسان قبلاً به حساب دیگری وصل شده است.", status: 409 };
  // همین حساب از همین پیام‌رسان با هویت دیگری وصل دارد
  const ch = chanOf(botId);
  if ((await getLinkedIds(env, uid)).some((i) => chanOf(i) === ch && i !== botId)) return { error: `به این حساب قبلاً یک ${CHAN_LABEL[ch]} دیگر وصل است.`, status: 409 };
  return null;
}

/** وصل کردن هویت یک ربات (تلگرام/بله/روبیکا/ایتا) به یک حساب موجود، بعد از اینکه مالکیت موبایل/ایمیل آن حساب با کد یک‌بارمصرف ثابت شد.
 *  اعتبار و پلنِ پروفایل خودکارِ ربات به حساب مقصد منتقل می‌شود (performLink) تا چیزی از دست نرود. */
export async function linkBotToAccount(env: Env, uid: string, botId: number): Promise<LinkErr | { ok: true }> {
  const chk = await linkCheck(env, uid, botId);
  if (chk && "error" in chk) return chk;
  if (!chk) await performLink(env, uid, botId);
  return { ok: true };
}


// =====================================================================================================================
// چند پیام‌رسان همزمان
// =====================================================================================================================
export type Chan = "tg" | "bale" | "eitaa" | "rubika" | "splus";
export const CHANS: Chan[] = ["tg", "bale", "eitaa", "rubika", "splus"];
export const CHAN_LABEL: Record<Chan, string> = { tg: "تلگرام", bale: "بله", eitaa: "ایتا", rubika: "روبیکا", splus: "سروش‌پلاس" };
export const isChan = (x: unknown): x is Chan => CHANS.includes(x as Chan);
/** پیام‌رسانِ یک شناسه‌ی داخلی (بازه‌ی شناسه‌ها در settings.ts ← botPlatform) */
export const chanOf = (id: unknown): Chan => botPlatform(id) as Chan;
/** آیا ربات/برنامک این پیام‌رسان روی سرور تنظیم شده است؟ (مثل botReady در lifecycle.ts) */
export function chanReady(env: Env, ch: Chan): boolean {
  return ch === "tg" ? !!env.TELEGRAM_BOT_TOKEN : ch === "bale" ? !!env.BALE_BOT_TOKEN : ch === "rubika" ? !!env.RUBIKA_BOT_TOKEN : ch === "eitaa" ? !!env.EITAA_APP_TOKEN : !!env.SPLUS_BOT_TOKEN;
}
/** شناسه‌ی واقعیِ خود پیام‌رسان برای نمایش (روبیکا: شناسه‌اش هش است ⇒ null) */
export function shownId(id: number): number | null {
  const ch = chanOf(id);
  return ch === "splus" ? fromSplusId(id) : ch === "eitaa" ? fromEitaaId(id) : ch === "rubika" ? null : ch === "bale" ? fromBaleId(id) : id;
}
const parseIds = (raw: string | null | undefined): number[] => {
  try {
    const a = JSON.parse(raw ?? "[]");
    return Array.isArray(a) ? a.map(Number).filter((n) => Number.isSafeInteger(n) && n > 0) : [];
  } catch { return []; }
};

/** همه‌ی هویت‌های پیام‌رسانِ وصل‌شده به حساب (هویت اصلی اول)؛ حساب‌های قدیمی که فقط w2tg دارند هم کامل برمی‌گردند */
export async function getLinkedIds(env: Env, uid: string): Promise<number[]> {
  const [raw, prim] = await Promise.all([env.KV.get(`w2ids:${uid}`).catch(() => null), getLinkedTg(env, uid)]);
  const out = parseIds(raw);
  if (prim) { const i = out.indexOf(prim); if (i > 0) out.splice(i, 1); if (i !== 0) out.unshift(prim); }
  return out;
}

/** یک هویت را به فهرست حساب اضافه می‌کند (idempotent)؛ اگر هویت اصلی نبود همین می‌شود هویت اصلی */
export async function addLinkedId(env: Env, uid: string, id: number): Promise<void> {
  const ids = await getLinkedIds(env, uid);
  if (!ids.includes(id)) {
    ids.push(id);
    await env.KV.put(`w2ids:${uid}`, JSON.stringify(ids));
  } else if (!parseIds(await env.KV.get(`w2ids:${uid}`).catch(() => null)).includes(id)) {
    await env.KV.put(`w2ids:${uid}`, JSON.stringify(ids)); // حساب قدیمی: فهرست برای اولین بار نوشته می‌شود
  }
  if (!(await getLinkedTg(env, uid))) await env.KV.put(`w2tg:${uid}`, String(id));
}

/** شناسه‌ی پیام‌رسان برای یک کار: اگر hint (کلید پلتفرم، مثلاً از هدر X-Plat که Mini App می‌فرستد) بین هویت‌های وصل‌شده بود همان؛ وگرنه هویت اصلی.
 *  hint فقط بین هویت‌های «خود کاربر» انتخاب می‌کند، پس جعل آن چیزی را باز نمی‌کند. */
export async function linkedFor(env: Env, uid: string, hint?: unknown): Promise<number | null> {
  const ids = await getLinkedIds(env, uid);
  if (isChan(hint)) { const m = ids.find((i) => chanOf(i) === hint); if (m) return m; }
  return ids[0] ?? null;
}

// ---------- اعلان: کدام پیام‌رسان‌ها ----------
export async function getMuted(env: Env, uid: string): Promise<Chan[]> {
  try { const a = JSON.parse((await env.KV.get(`nto:${uid}`)) ?? "[]"); return Array.isArray(a) ? a.filter(isChan) : []; } catch { return []; }
}
export async function setChannelNotify(env: Env, uid: string, ch: Chan, on: boolean): Promise<void> {
  const cur = new Set(await getMuted(env, uid));
  on ? cur.delete(ch) : cur.add(ch);
  if (cur.size) await env.KV.put(`nto:${uid}`, JSON.stringify([...cur])); else await env.KV.delete(`nto:${uid}`);
}
/** هویت‌هایی که اعلان به آن‌ها می‌رسد: وصل‌شده، روشن و دارای ربات فعال. ترتیب: هویت اصلی اول. */
export async function notifyIds(env: Env, uid: string): Promise<number[]> {
  const ids = await getLinkedIds(env, uid);
  return ids.filter((i) => chanReady(env, chanOf(i))); // اعلان همیشه روشن است؛ خاموش‌کردن وجود ندارد (muted نادیده گرفته می‌شود)
}
/** یک پیام را به همه‌ی پیام‌رسان‌های روشنِ حساب می‌فرستد (هر کدام جدا؛ خطای یکی بقیه را نمی‌گیرد). ok = تعداد رسیده. */
export async function sendToChannels(env: Env, uid: string, send: (id: number) => Promise<unknown>, only?: number[]): Promise<{ ok: number; tried: number }> {
  const ids = only ?? (await notifyIds(env, uid));
  const r = await Promise.all(ids.map((id) => send(id).then(() => true, (e) => { console.error("channel send", chanOf(id), String(e).slice(0, 160)); return false; })));
  return { ok: r.filter(Boolean).length, tried: ids.length };
}

// ---------- وضعیت اتصال (برای همه‌ی کلاینت‌ها: GET /api/me ← channels) ----------
export interface ChannelInfo {
  key: Chan; label: string;
  connected: boolean;
  /** شناسه‌ی واقعی پیام‌رسان (روبیکا: null) */ shown: number | string | null;
  /** اعلان به این پیام‌رسان می‌رسد؟ */ notify: boolean;
  /** ربات/برنامک روی سرور فعال است؟ (غیرفعال و وصل‌نشده در رابط نشان داده نمی‌شود) */ available: boolean;
  /** هویت اصلی حساب */ primary: boolean;
  /** قابل جدا کردن؟ (پیام‌رسانِ محل ساخت حساب جدا نمی‌شود) */ canUnlink: boolean;
}
export async function channelStatus(env: Env, uid: string): Promise<ChannelInfo[]> {
  const ids = await getLinkedIds(env, uid);
  return Promise.all(CHANS.map(async (key): Promise<ChannelInfo> => {
    const id = ids.find((i) => chanOf(i) === key);
    return {
      key, label: CHAN_LABEL[key], connected: !!id, shown: id ? shownId(id) : null,
      notify: !!id, available: chanReady(env, key),
      primary: !!id && id === ids[0], canUnlink: false, // جدا کردن پلتفرم از رابط‌ها حذف شده است
    };
  }));
}

/** پیام‌رسان را از حساب جدا می‌کند. پیام‌رسانِ محل ساخت حساب (پروفایل خودکارش) جدا نمی‌شود، چون با اولین پیام دوباره وصل می‌شد. */
export async function unlinkChannel(env: Env, uid: string, ch: Chan): Promise<LinkErr | { ok: true }> {
  const ids = await getLinkedIds(env, uid);
  const id = ids.find((i) => chanOf(i) === ch);
  if (!id) return { error: `${CHAN_LABEL[ch]} به حساب وصل نیست.`, status: 404 };
  if ((await profileId(id)) === uid) return { error: `حساب تو با ${CHAN_LABEL[ch]} ساخته شده و این پیام‌رسان جدا نمی‌شود؛ می‌توانی فقط اعلانش را خاموش کنی.`, status: 409 };
  const rest = ids.filter((i) => i !== id);
  await env.KV.put(`w2ids:${uid}`, JSON.stringify(rest));
  if (rest.length) await env.KV.put(`w2tg:${uid}`, String(rest[0])); else await env.KV.delete(`w2tg:${uid}`);
  if ((await env.KV.get(`tg2w:${id}`)) === uid) await env.KV.delete(`tg2w:${id}`);
  await setChannelNotify(env, uid, ch, true); // ترجیح اعلان این پیام‌رسان پاک می‌شود
  return { ok: true };
}

/** اگر حساب `uid` همان «پروفایل خودکارِ» پیام‌رسان `plat` باشد (یعنی فقط با همین پیام‌رسان ساخته شده و هنوز به حساب دیگری وصل نیست) شناسه‌ی آن پیام‌رسان؛ وگرنه null.
 *  اتصال با شماره (profile.ts ← attachContact) فقط برای چنین نشستی هویت را به حسابِ دارنده‌ی شماره منتقل می‌کند. */
export async function autoBotId(env: Env, uid: string, plat: unknown): Promise<number | null> {
  if (!isChan(plat)) return null;
  const id = (await getLinkedIds(env, uid)).find((i) => chanOf(i) === plat);
  return id && (await profileId(id)) === uid ? id : null;
}

/** مسیرهای اعلانِ غیرپیام‌رسان برای نمایش وضعیت «متصل است یا نه»: اپ اندروید (FCM)، اعلان مرورگر (PWA) و ایمیل */
export async function deviceStatus(env: Env, uid: string, hasEmail: boolean): Promise<{ app: boolean; web: boolean; email: boolean; site: boolean }> {
  const [fcm, wp, site] = await Promise.all([fcmTokensOf(env, uid), webPushEnabled(env) ? env.KV.get(`${WP_PREFIX}${uid}`).catch(() => null) : null, env.KV.get(`site:${uid}`).catch(() => null)]);
  return { app: fcm.length > 0, web: parseDevices(wp).length > 0, email: hasEmail, site: !!site };
}
