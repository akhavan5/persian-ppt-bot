/**
 * پروفایل وب خودکار برای کاربران ربات تلگرام (تلگرام‌محور).
 *
 * هر کاربر ربات از اولین پیام یک پروفایل وب می‌گیرد (ensureUid)؛ شناسه‌ی پروفایل از شناسه‌ی تلگرام ساخته می‌شود
 * (ثابت و بی‌تکرار). ربات برای همه‌ی کارها (اعتبار، پلن، تنظیمات، قفل، فایل) از شناسه‌ی همین پروفایل استفاده می‌کند.
 * دکمه‌های خرید در ربات لینک ورود یک‌بارمصرف دارند (createLoginToken ← /api/auth/tg)؛ مالکیت تلگرام را خود تلگرام ثابت می‌کند
 * چون لینک فقط به چت خود کاربر فرستاده می‌شود. مدیرها (ADMIN_IDS) پروفایل خودکار ندارند و شناسه‌ی عددی می‌مانند.
 */
import type { Env } from "./env";
import { getUserById, hitLimit, randomToken, saveWebUser } from "./auth";
import { getBonus, getSub, grantSignupCredit, isAdmin, isBanned, putSub, setBonus, type Uid } from "./settings";
import { sendMessage } from "./telegram";

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
    await grantSignupCredit(env, id).catch((e) => console.error("signupCredit", e)); // ۳ اعتبار هدیه‌ی ثبت‌نام (فقط یک‌بار)
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

// ---------- اتصال تلگرام از پروفایل وب (آیدی عددی + کد ۶ رقمی که ربات به چت تلگرام می‌فرستد) ----------
// جریان: کاربر در ربات /id را می‌زند و آیدی را در پروفایل وب وارد می‌کند ← ربات یک کد ۶ رقمی به همان چت می‌فرستد ← کاربر کد را در وب وارد می‌کند.
// مالکیت تلگرام را خود تلگرام ثابت می‌کند (کد فقط به چت صاحب آن آیدی می‌رسد). بعد از اتصال، ربات برای این تلگرام از حساب وب استفاده می‌کند.
const TG_CODE_TTL = 300; // ثانیه
const TG_MAX_TRIES = 5;
const enc = new TextEncoder();
const sha256hex = async (v: string) => hex(new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(v))));
const safeEq = (a: string, b: string) => {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
};
/** کد به حساب وب و آیدی تلگرام گره می‌خورد؛ پس کد یک حساب برای حساب دیگر یا آیدی دیگر کار نمی‌کند */
const codeHash = (uid: string, tgId: number, code: string) => sha256hex(`tglink:${uid}:${tgId}:${code}`);
const digitsEn = (v: unknown) => String(v ?? "").replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0)).replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660)).replace(/\s/g, "");

/** آیدی عددی تلگرام (ارقام فارسی هم پذیرفته می‌شود)؛ نامعتبر → null */
export function normTgId(v: unknown): number | null {
  const s = digitsEn(v);
  if (!/^\d{5,15}$/.test(s)) return null;
  const n = Number(s);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

/** تلگرام وصل‌شده به این حساب وب (اگر باشد) */
export async function getLinkedTg(env: Env, uid: string): Promise<number | null> {
  const n = Number(await env.KV.get(`w2tg:${uid}`).catch(() => null));
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

type LinkErr = { error: string; status: number };

/** null = قابل اتصال؛ {already} = همین حالا وصل است؛ وگرنه خطا */
async function linkCheck(env: Env, uid: string, tgId: number): Promise<LinkErr | { already: true } | null> {
  if (isAdmin(env, tgId)) return { error: "این آیدی مربوط به مدیر ربات است و به حساب وب وصل نمی‌شود.", status: 409 };
  if (await isBanned(env, tgId)) return { error: "دسترسی این تلگرام مسدود شده است.", status: 403 };
  const auto = await profileId(tgId);
  const cur = await getLinkedTg(env, uid);
  if (cur === tgId) return { already: true };
  if (uid === auto) { // پروفایل خودکارِ همین تلگرام (ورود از دکمه‌ی ربات)؛ نگاشت معکوس برای حساب‌های قدیمی بازسازی می‌شود
    await env.KV.put(`w2tg:${uid}`, String(tgId));
    return { already: true };
  }
  if (cur) return { error: "یک تلگرام دیگر به حساب شما وصل است.", status: 409 };
  const w = await env.KV.get(`tg2w:${tgId}`);
  if (w && WEB_ID.test(w) && w !== auto && w !== uid) return { error: "این تلگرام به حساب وب دیگری وصل شده است.", status: 409 };
  return null;
}

/** مرحله‌ی ۱: ارسال کد ۶ رقمی از طریق ربات به چت تلگرام صاحب آیدی */
export async function startTgLink(env: Env, uid: string, ip: string, raw: unknown): Promise<LinkErr | { ok: true } | { already: true }> {
  const tgId = normTgId(raw);
  if (!tgId) return { error: "آیدی تلگرام معتبر نیست؛ فقط عدد است. در ربات دستور /id را بزن و عدد را کپی کن.", status: 400 };
  const chk = await linkCheck(env, uid, tgId);
  if (chk) return chk;

  // محدودیت: ۶۰ ثانیه فاصله برای هر حساب و هر آیدی (جلوگیری از اسپم‌شدن چت دیگران)، ۵ کد در ساعت برای هر آیدی، ۱۰ برای هر حساب، ۱۵ برای هر شبکه
  if (await hitLimit(env, `tgc:u:${uid}`, 1, 60) || await hitLimit(env, `tgc:t:${tgId}`, 1, 60)) return { error: "کد قبلاً ارسال شده است؛ تا یک دقیقه صبر کن و دوباره بخواه.", status: 429 };
  if (await hitLimit(env, `tgs:t:${tgId}`, 5, 3600)) return { error: "تعداد درخواست کد برای این آیدی زیاد بود؛ یک ساعت بعد دوباره امتحان کن.", status: 429 };
  if (await hitLimit(env, `tgs:u:${uid}`, 10, 3600) || await hitLimit(env, `tgs:ip:${ip}`, 15, 3600)) return { error: "تعداد درخواست کد زیاد بود؛ کمی بعد دوباره امتحان کن.", status: 429 };

  const code = String(crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000).padStart(6, "0");
  const exp = Math.floor(Date.now() / 1000) + TG_CODE_TTL;
  const h = await codeHash(uid, tgId, code);
  await Promise.all([
    env.KV.put(`tgk:${uid}`, JSON.stringify({ h, tg: tgId, exp }), { expiration: exp }),
    env.KV.delete(`tgkf:${uid}`), // کد تازه ⇒ شمارنده‌ی تلاش ناموفق از صفر
  ]);

  try {
    await sendMessage(env, tgId,
      `🔐 <b>کد تایید اتصال تلگرام به حساب سایت</b>\n\n<code>${code}</code>\n\n` +
      `این کد را در پروفایل سایت (pptsaz.ir) وارد کن. اعتبار کد ۵ دقیقه است.\n` +
      `⚠️ اگر خودت درخواست نکرده‌ای، این پیام را نادیده بگیر و کد را به هیچ‌کس نده.`);
  } catch (e) {
    await env.KV.delete(`tgk:${uid}`).catch(() => {});
    await env.KV.delete(`tgc:u:${uid}`).catch(() => {});
    await env.KV.delete(`tgc:t:${tgId}`).catch(() => {});
    console.error("tg link send", String(e).slice(0, 200));
    const blocked = /chat not found|can't initiate|blocked|deactivated|Forbidden/i.test(String(e));
    return blocked
      ? { error: "ربات نتوانست به این آیدی پیام بدهد؛ اول ربات را در تلگرام Start کن (دستور /start) و آیدی را از /id دوباره بررسی کن.", status: 422 }
      : { error: "ارسال کد در تلگرام ناموفق بود؛ چند دقیقه بعد دوباره امتحان کن.", status: 502 };
  }
  return { ok: true };
}

/** مرحله‌ی ۲: بررسی کد و اتصال. موفق ⇒ { tg } */
export async function verifyTgLink(env: Env, uid: string, rawCode: unknown): Promise<LinkErr | { tg: number }> {
  const code = digitsEn(rawCode);
  if (!/^\d{6}$/.test(code)) return { error: "کد باید ۶ رقم باشد.", status: 400 };
  const rec = (await env.KV.get(`tgk:${uid}`, "json")) as { h: string; tg: number; exp: number } | null;
  if (!rec) return { error: "کد منقضی شده است؛ دوباره کد بگیر.", status: 401 };
  // هر تلاش «قبل از» مقایسه، اتمی شمرده می‌شود (سقف ۵ تلاش برای هر کد)
  if (await hitLimit(env, `tgkf:${uid}`, TG_MAX_TRIES, TG_CODE_TTL)) {
    await env.KV.delete(`tgk:${uid}`);
    return { error: "تعداد تلاش‌های ناموفق زیاد بود؛ دوباره کد بگیر.", status: 429 };
  }
  if (!safeEq(await codeHash(uid, rec.tg, code), rec.h)) return { error: "کد درست نیست.", status: 401 };
  await env.KV.delete(`tgk:${uid}`);
  await env.KV.delete(`tgkf:${uid}`);

  const chk = await linkCheck(env, uid, rec.tg); // بین ارسال و تایید ممکن است وضعیت عوض شده باشد
  if (chk && "error" in chk) return chk;
  if (!chk) await performLink(env, uid, rec.tg);
  return { tg: rec.tg };
}

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
  }
  await env.KV.put(`tg2w:${tgId}`, uid);
  await env.KV.put(`w2tg:${uid}`, String(tgId));
}
