/**
 * سیستم کاربری نسخه‌ی وب؛ کاملاً جدا از تلگرام.
 * - ورود با گوگل (OAuth 2.0 Authorization Code، سمت سرور)
 * - ورود/ثبت‌نام یکپارچه با پیامک یک‌بارمصرف (OTP): اگر حسابی با آن شماره بود وارد می‌شود، وگرنه ساخته می‌شود
 * - نشست‌ها: توکن تصادفی در کوکی HttpOnly؛ در KV فقط هشِ توکن نگه داشته می‌شود
 * همه‌چیز روی همان KV فعلی است؛ هیچ منبع جدیدی لازم نیست.
 */
import { appFields, appPlatform, pwaPlatform, type AppOs, type AppStore, type AppUA } from "./app-ua";
import type { Env } from "./env";
import { bumpStat, grantSignupCredit } from "./settings";
import { sendWelcomeEmail } from "./email-welcome";
import { sendOtpEmail } from "./email-otp";
import { emailEnabled } from "./email";

export interface WebUser {
  id: string; // w_ + ۱۶ نویسه‌ی هگز
  email: string; // ممکن است خالی باشد (حساب ساخته‌شده با موبایل)
  mobile?: string; // 09XXXXXXXXX
  name: string;
  picture?: string;
  google?: string; // شناسه‌ی sub گوگل
  verified: boolean; // ایمیل تایید شده؟ (با گوگل یا کد ایمیلی true می‌شود)
  created: number;
  via?: "app"; // ثبت‌نام‌شده از اپ اندروید/iOS (بقیه: وب)
  app?: boolean; // حداقل یک بار از اپ بومی (اندروید یا iOS) وارد شده/استفاده کرده
  os?: AppOs; // سیستم‌عامل آخرین اپ بومی که این کاربر استفاده کرده؛ حساب‌های قدیمی (فقط اندروید بود) ندارند ⇒ اندروید
  store?: AppStore; // فروشگاهِ آخرین نسخه‌ی اپ که این کاربر استفاده کرده (فقط از نسخه‌ای که فروشگاه را در User-Agent می‌فرستد)
  appv?: string; // نسخه‌ی اپ (آخرین مقدار دیده‌شده)
  andv?: string; // نسخه‌ی سیستم‌عامل دستگاه (اندروید یا iOS؛ os مشخص می‌کند) — آخرین مقدار دیده‌شده
  pwa?: "ios" | "other"; // وب‌اپ نصب‌شده (PWA) استفاده کرده: iPhone/iPad = ios، بقیه = other
}

const enc = new TextEncoder();
const SESSION_TTL = 60 * 60 * 24 * 30; // ۳۰ روز
export const SESSION_COOKIE = "sid";

// ---------- ابزارها ----------
const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
export const b64u = (b: Uint8Array) => btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
export const randomToken = (bytes = 32) => b64u(crypto.getRandomValues(new Uint8Array(bytes)));
const sha256hex = async (s: string) => hex(new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(s))));

function safeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i];
  return d === 0;
}

export function getCookie(req: Request, name: string): string | null {
  const m = (req.headers.get("cookie") ?? "").match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return m ? decodeURIComponent(m[1]) : null;
}
export const setCookie = (name: string, value: string, maxAge: number, path = "/") =>
  `${name}=${encodeURIComponent(value)}; Path=${path}; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`;

export const normEmail = (e: unknown) => String(e ?? "").trim().toLowerCase();
export const validEmail = (e: string) => e.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e);

// ---------- کاربران ----------
export const getUserById = (env: Env, id: string) => env.KV.get(`wu:${id}`, "json") as Promise<WebUser | null>;
export async function getUserByEmail(env: Env, email: string): Promise<WebUser | null> {
  const id = await env.KV.get(`we:${email}`);
  return id ? getUserById(env, id) : null;
}
const saveUser = (env: Env, u: WebUser) => env.KV.put(`wu:${u.id}`, JSON.stringify(u));

export async function createUser(env: Env, p: { email?: string; mobile?: string; name: string; google?: string; picture?: string; via?: "app"; appUA?: AppUA | null; pwa?: "ios" | "other" | null; emailVerified?: boolean }): Promise<WebUser> {
  const u: WebUser = {
    id: "w_" + hex(crypto.getRandomValues(new Uint8Array(8))),
    email: p.email ?? "", mobile: p.mobile, name: p.name.slice(0, 64), picture: p.picture, google: p.google,
    verified: !!p.google || !!p.mobile || !!p.emailVerified, created: Date.now(),
    ...(p.via === "app" ? { via: "app" as const, app: true, ...(p.appUA ? appFields(p.appUA) : {}) } : p.pwa ? { pwa: p.pwa } : {}),
  };
  await saveUser(env, u);
  if (u.email) await env.KV.put(`we:${u.email}`, u.id);
  if (u.mobile) await env.KV.put(`wm:${u.mobile}`, u.id);
  if (u.google) await env.KV.put(`wg:${u.google}`, u.id);
  await bumpStat(env, "newusers", p.via === "app" ? (p.appUA ? appPlatform(p.appUA) : "app") : p.pwa ? pwaPlatform(p.pwa) : "web").catch(() => {});
  if (p.via === "app") await bumpStat(env, "newapp").catch(() => {});
  await grantSignupCredit(env, u.id).catch((e) => console.error("signupCredit", e)); // ۳ اعتبار هدیه‌ی ثبت‌نام (فقط یک‌بار)
  if (u.email) await sendWelcomeEmail(env, u).catch((e) => console.error("welcomeEmail", e)); // ایمیل خوش‌آمد (فقط حساب‌های دارای ایمیل؛ بدون RESEND_API_KEY بی‌اثر است)
  return u;
}

export const publicUser = (u: WebUser) => ({ id: u.id, email: u.email, mobile: u.mobile ?? null, name: u.name, picture: u.picture ?? null });
export const saveWebUser = saveUser;
export async function getUserByMobile(env: Env, mobile: string): Promise<WebUser | null> {
  const id = await env.KV.get(`wm:${mobile}`);
  return id ? getUserById(env, id) : null;
}

// ---------- نشست ----------
export async function createSession(env: Env, userId: string): Promise<string> {
  const token = randomToken();
  await env.KV.put(`ws:${await sha256hex(token)}`, userId, { expirationTtl: SESSION_TTL });
  return token;
}
/** نشست Bearer فعلی را اگر معتبر و مال همین کاربر باشد ۳۰ روز دیگر تمدید می‌کند و همان توکن را برمی‌گرداند (وگرنه null).
 *  Mini App با آن به‌جای ساخت نشست تازه در هر ورود، یک نشست را نگه می‌دارد. */
export async function reuseSession(env: Env, req: Request, userId: string): Promise<string | null> {
  const token = /^Bearer ([\w-]{20,100})$/.exec(req.headers.get("authorization") ?? "")?.[1];
  if (!token) return null;
  const h = await sha256hex(token);
  if ((await env.KV.get(`ws:${h}`)) !== userId) return null;
  await env.KV.put(`ws:${h}`, userId, { expirationTtl: SESSION_TTL });
  return token;
}
export const sessionCookie = (token: string) => setCookie(SESSION_COOKIE, token, SESSION_TTL);
export const clearSessionCookie = () => setCookie(SESSION_COOKIE, "", 0);

export async function destroySession(env: Env, req: Request) {
  const token = getCookie(req, SESSION_COOKIE);
  if (token) await env.KV.delete(`ws:${await sha256hex(token)}`);
}

/** نشست لغزان: هر کاربر فعال حداکثر روزی یک بار ۳۰ روز تمدید می‌شود تا مجبور به ورود و خروج مکرر نباشد. کوکی جدید برمی‌گرداند (یا null). */
export async function renewSession(env: Env, req: Request): Promise<string | null> {
  const token = getCookie(req, SESSION_COOKIE);
  if (!token || token.length > 100) return null;
  const h = await sha256hex(token);
  if (await env.KV.get(`wsr:${h}`)) return null;
  const id = await env.KV.get(`ws:${h}`);
  if (!id) return null;
  await env.KV.put(`ws:${h}`, id, { expirationTtl: SESSION_TTL });
  await env.KV.put(`wsr:${h}`, "1", { expirationTtl: 86_400 });
  return sessionCookie(token);
}

export async function authUser(env: Env, req: Request): Promise<WebUser | null> {
  // کوکی (سایت و اپ اندروید)، وگرنه توکن Bearer (Telegram Mini App؛ در iframe تلگرام وب کوکی SameSite فرستاده نمی‌شود)
  const token = getCookie(req, SESSION_COOKIE) ?? /^Bearer ([\w-]{20,100})$/.exec(req.headers.get("authorization") ?? "")?.[1] ?? null;
  if (!token || token.length > 100) return null;
  const id = await env.KV.get(`ws:${await sha256hex(token)}`);
  return id ? getUserById(env, id) : null;
}

// ---------- محدودیت تلاش (شمارنده‌ی اتمی روی D1) ----------
/** true = سقف پر شده (درخواست رد شود). شمارش در «یک» دستور SQL اتمی انجام می‌شود (مثل کسر اعتبار در settings.ts):
 *  شمارنده فقط وقتی بالا می‌رود که کمتر از سقف باشد و ردیف منقضی‌شده مثل صفر حساب می‌شود؛
 *  پس درخواست‌های هم‌زمان نمی‌توانند با «خواندن، بعد نوشتن» از سقف رد شوند. موفقیت از meta.changes فهمیده می‌شود. */
export async function hitLimit(env: Env, key: string, max: number, ttl: number): Promise<boolean> {
  await env.KV.ready();
  const now = Math.floor(Date.now() / 1000);
  const r = await env.DB.prepare(
    "INSERT INTO kv (k, v, exp) VALUES (?1, '1', ?2) ON CONFLICT(k) DO UPDATE SET " +
    "v = CASE WHEN exp IS NOT NULL AND exp <= ?3 THEN '1' ELSE CAST(CAST(v AS INTEGER) + 1 AS TEXT) END, exp = ?2 " +
    "WHERE (exp IS NOT NULL AND exp <= ?3) OR CAST(v AS INTEGER) < ?4")
    .bind(key, now + Math.max(1, Math.floor(ttl)), now, max).run();
  return r.meta?.changes !== 1;
}

// ---------- ورود با پیامک یک‌بارمصرف (OTP) ----------
export const otpEnabled = (env: Env) => !!(env.SMS_API_TOKEN ?? "").trim();
/** ورود با کد ایمیلی: همان RESEND_API_KEY ایمیل‌های دیگر؛ بدون آن غیرفعال است */
export const emailOtpEnabled = (env: Env) => emailEnabled(env);
const OTP_TTL = 300; // ثانیه
const OTP_MAX_TRIES = 5;

/** شماره‌ی موبایل ایران → 09XXXXXXXXX (ارقام فارسی/عربی، +98 و 0098 هم پذیرفته می‌شود)؛ نامعتبر → null */
export function normMobile(v: unknown): string | null {
  let m = String(v ?? "")
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[\s\-()]/g, "");
  m = m.replace(/^(\+98|0098|98)/, "0");
  if (/^9\d{9}$/.test(m)) m = "0" + m;
  return /^09\d{9}$/.test(m) ? m : null;
}

/** id: شماره‌ی موبایل (09…) یا ایمیل (حروف کوچک)؛ هیچ‌کدام با دیگری هم‌پوشانی ندارد چون ایمیل «@» دارد */
const otpHash = (code: string, id: string) => sha256hex(`otp:${id}:${code}`);

/** ساخت و ذخیره‌ی کد ۶ رقمی برای یک شناسه (شماره‌ی موبایل یا ایمیل) با محدودیت تلاش. خروجی: {code} یا {error, status}. */
async function issueCode(env: Env, ip: string, id: string, what: "sms" | "email"): Promise<{ code: string } | { error: string; status: number }> {
  // محدودیت: ۶۰ ثانیه فاصله بین دو ارسال به یک شناسه، ۵ ارسال در ساعت برای هر شناسه، ۱۲۰ در ساعت برای هر شبکه (OTP_IP_HOURLY)
  // فاصله‌ی ۶۰ ثانیه‌ای: ادعای اتمی (دو درخواست هم‌زمان نمی‌توانند هر دو کد بفرستند)
  if (await hitLimit(env, `oc:${id}`, 1, 60)) return { error: "کد قبلاً ارسال شده است؛ تا یک دقیقه صبر کن و دوباره بخواه.", status: 429 };
  if (await hitLimit(env, `os:m:${id}`, 5, 3600)) return { error: `تعداد درخواست کد برای این ${what === "sms" ? "شماره" : "ایمیل"} زیاد بود؛ یک ساعت بعد دوباره امتحان کن.`, status: 429 };
  if (await hitLimit(env, `os:ip:${ip}`, Math.max(1, Math.floor(Number(env.OTP_IP_HOURLY) || 120)), 3600)) return { error: "تعداد درخواست کد از این شبکه زیاد بود؛ کمی بعد دوباره امتحان کن.", status: 429 };

  const n = crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000;
  const code = String(n).padStart(6, "0");
  const exp = Math.floor(Date.now() / 1000) + OTP_TTL;
  const oh = await otpHash(code, id);
  await Promise.all([
    env.KV.put(`ot:${id}`, JSON.stringify({ h: oh, exp }), { expiration: exp }),
    env.KV.delete(`otf:${id}`), // کد تازه ⇒ شمارنده‌ی تلاش ناموفق از صفر
  ]);
  return { code };
}
/** ارسال ناموفق: کد و قفل ۶۰ ثانیه‌ای پاک می‌شود تا کاربر بتواند فوری دوباره امتحان کند */
async function dropCode(env: Env, id: string) {
  await env.KV.delete(`ot:${id}`);
  await env.KV.delete(`oc:${id}`);
}

/** ارسال کد ۶ رقمی با پیامک. خروجی: null = موفق، وگرنه {error, status}. */
export async function sendOtp(env: Env, ip: string, mobile: string): Promise<{ error: string; status: number } | null> {
  if (!otpEnabled(env)) return { error: "ورود با پیامک فعال نیست.", status: 503 };
  const c = await issueCode(env, ip, mobile, "sms");
  if ("error" in c) return c;
  const code = c.code;

  const token = (env.SMS_API_TOKEN ?? "").trim().replace(/^Bearer\s+/i, "");
  const template = Number.isFinite(Number(env.SMS_TEMPLATE)) && String(env.SMS_TEMPLATE ?? "").trim() !== "" ? Number(env.SMS_TEMPLATE) : 1;
  try {
    const r = await fetch((env.SMS_API_URL || "https://s.api.ir/api/sw1/SmsOTP").trim(), {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ code, mobile, template }),
      signal: AbortSignal.timeout(12_000),
    });
    const j = (await r.json().catch(() => null)) as { success?: boolean; data?: boolean; message?: string | null } | null;
    if (r.ok && (j?.success === true || j?.data === true)) return null;
    console.error("sms otp failed", r.status, JSON.stringify(j).slice(0, 300));
  } catch (e) {
    console.error("sms otp error", String(e).slice(0, 200));
  }
  await dropCode(env, mobile);
  return { error: "ارسال پیامک ناموفق بود؛ چند دقیقه بعد دوباره امتحان کن.", status: 502 };
}

/** ارسال کد ۶ رقمی به ایمیل (Resend). خروجی: null = موفق، وگرنه {error, status}. */
export async function sendEmailOtp(env: Env, ip: string, email: string): Promise<{ error: string; status: number } | null> {
  if (!emailOtpEnabled(env)) return { error: "ورود با ایمیل فعال نیست.", status: 503 };
  const c = await issueCode(env, ip, email, "email");
  if ("error" in c) return c;
  if (await sendOtpEmail(env, email, c.code)) return null;
  await dropCode(env, email);
  return { error: "ارسال ایمیل ناموفق بود؛ نشانی را بررسی کن یا چند دقیقه بعد دوباره امتحان کن.", status: 502 };
}

/** بررسی کد (برای موبایل یا ایمیل). موفق ⇒ کد مصرف می‌شود (یک‌بار مصرف). خروجی: null = درست، وگرنه پیام خطا. */
export async function checkOtp(env: Env, mobile: string, code: string): Promise<string | null> {
  if (!/^\d{6}$/.test(code)) return "کد باید ۶ رقم باشد.";
  const rec = (await env.KV.get(`ot:${mobile}`, "json")) as { h: string; exp: number } | null;
  if (!rec) return "کد منقضی شده است؛ دوباره کد بگیر.";
  // هر تلاش «قبل از» مقایسه، اتمی شمرده می‌شود؛ پس حدس‌های هم‌زمان نمی‌توانند از سقف ۵ تلاش رد شوند
  if (await hitLimit(env, `otf:${mobile}`, OTP_MAX_TRIES, OTP_TTL)) { await env.KV.delete(`ot:${mobile}`); return "تعداد تلاش‌های ناموفق زیاد بود؛ دوباره کد بگیر."; }
  const ok = safeEqual(enc.encode(await otpHash(code, mobile)), enc.encode(rec.h));
  if (!ok) return "کد درست نیست.";
  await env.KV.delete(`ot:${mobile}`);
  await env.KV.delete(`otf:${mobile}`);
  return null;
}

// ---------- ورود با گوگل ----------
export const googleEnabled = (env: Env) => !!env.GOOGLE_CLIENT_ID && !!env.GOOGLE_CLIENT_SECRET;
const redirectUri = (url: URL) => `${url.origin}/api/auth/google/callback`;
const STATE_COOKIE = "gstate";

export async function googleStart(env: Env, url: URL): Promise<Response> {
  if (!googleEnabled(env)) return Response.redirect(`${url.origin}/?login_error=google_off`, 302);
  const state = randomToken(24);
  await env.KV.put(`wo:${state}`, url.searchParams.get("app") === "1" ? "app" : "1", { expirationTtl: 600 }); // app: بعد از ورود به اپ اندروید برمی‌گردد
  const q = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID!, redirect_uri: redirectUri(url), response_type: "code",
    scope: "openid email profile", state, prompt: "select_account",
  });
  const h = new Headers({ location: `https://accounts.google.com/o/oauth2/v2/auth?${q}`, "cache-control": "no-store" });
  h.append("set-cookie", setCookie(STATE_COOKIE, state, 600, "/api/auth"));
  return new Response(null, { status: 302, headers: h });
}

type GoogleInfo = { sub: string; email: string; name?: string; picture?: string };

/** حساب مربوط به یک هویت گوگل را پیدا یا می‌سازد (مشترک بین ورود مرورگر و ورود داخل اپ اندروید) */
async function googleUser(env: Env, info: GoogleInfo): Promise<WebUser> {
  const email = info.email;
  let user: WebUser | null = null;
  const gid = await env.KV.get(`wg:${info.sub}`);
  if (gid) user = await getUserById(env, gid);
  if (!user) {
    user = await getUserByEmail(env, email);
    if (user) {
      // ایمیل را گوگل تایید کرده است ⇒ حساب موجود با همان ایمیل به گوگل وصل می‌شود
      user.google = info.sub;
      user.verified = true;
      user.picture ||= info.picture;
      await saveUser(env, user);
      await env.KV.put(`wg:${info.sub}`, user.id);
    } else {
      user = await createUser(env, { email, name: info.name || email.split("@")[0], google: info.sub, picture: info.picture });
    }
  }
  return user;
}

/**
 * ورود داخل اپ اندروید (بدون مرورگر): اپ با Credential Manager یک ID token می‌گیرد و اینجا فرستاده می‌شود.
 * توکن را خود گوگل (tokeninfo) اعتبارسنجی می‌کند و audience باید همان GOOGLE_CLIENT_ID (Web client) باشد.
 * خروجی: { user } + کوکی نشست؛ یا { error } با کد وضعیت.
 */
export async function googleLoginWithIdToken(env: Env, idToken: string): Promise<{ user: WebUser; token: string } | { error: string; status: number }> {
  if (!env.GOOGLE_CLIENT_ID) return { error: "ورود با گوگل فعال نیست.", status: 503 };
  if (!/^[\w-]+\.[\w-]+\.[\w-]+$/.test(idToken) || idToken.length > 4096) return { error: "توکن گوگل نامعتبر است.", status: 400 };
  try {
    const r = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`, { signal: AbortSignal.timeout(15_000) });
    if (!r.ok) return { error: "توکن گوگل نامعتبر یا منقضی است.", status: 401 };
    const t = (await r.json()) as { aud?: string; iss?: string; exp?: string; sub?: string; email?: string; email_verified?: string | boolean; name?: string; picture?: string };
    const issOk = t.iss === "accounts.google.com" || t.iss === "https://accounts.google.com";
    if (t.aud !== env.GOOGLE_CLIENT_ID || !issOk || !t.sub || Number(t.exp) * 1000 < Date.now()) return { error: "توکن گوگل نامعتبر است.", status: 401 };
    const email = normEmail(t.email);
    if (!validEmail(email) || String(t.email_verified) !== "true") return { error: "ایمیل حساب گوگل تایید نشده است.", status: 401 };
    const user = await googleUser(env, { sub: t.sub, email, name: t.name, picture: t.picture });
    return { user, token: await createSession(env, user.id) };
  } catch (e) {
    console.error("google id token", e);
    return { error: "ورود با گوگل ناموفق بود؛ دوباره امتحان کن.", status: 502 };
  }
}

/** صفحه‌ی بازگشت به اپ اندروید (پس از ورود با مرورگر): خودکار به pptsaz://login باز می‌شود و دکمه‌ی دستی هم دارد */
function appReturn(url: URL, q: { c?: string; e?: string }): Response {
  const target = "pptsaz://login?" + new URLSearchParams(q as Record<string, string>).toString();
  const ok = !!q.c;
  const html = `<!doctype html><html lang="fa" dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>پاورپوینت‌ساز</title>
<body style="font-family:Tahoma,sans-serif;text-align:center;padding:48px 24px;line-height:2">
<h2>${ok ? "ورود انجام شد ✅" : "ورود با گوگل ناموفق بود"}</h2>
<p>${ok ? "در حال بازگشت به اپ پاورپوینت‌ساز…" : "به اپ برگردید و با پیامک وارد شوید."}</p>
<p><a href="${target}" style="display:inline-block;padding:12px 28px;border-radius:12px;background:#2563eb;color:#fff;text-decoration:none">بازگشت به اپ</a></p>
<script>setTimeout(function(){location.href=${JSON.stringify(target)}},300)</script></body></html>`;
  const h = new Headers({ "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "referrer-policy": "no-referrer" });
  h.append("set-cookie", setCookie(STATE_COOKIE, "", 0, "/api/auth"));
  return new Response(html, { status: 200, headers: h });
}

/** تبدیل کد یک‌بارمصرف (از appReturn) به نشست اپ */
export async function googleAppExchange(env: Env, code: string): Promise<{ user: WebUser; token: string } | null> {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(code)) return null;
  const uid = await env.KV.get(`ga:${code}`);
  if (!uid) return null;
  await env.KV.delete(`ga:${code}`).catch(() => {});
  const user = await getUserById(env, uid);
  return user ? { user, token: await createSession(env, user.id) } : null;
}

export async function googleCallback(env: Env, req: Request, url: URL): Promise<Response> {
  let isApp = false; // ورود از اپ اندروید (مرورگر پشتیبان)؛ بعد از state معتبر مشخص می‌شود
  const fail = (code: string) => {
    if (isApp) return appReturn(url, { e: code });
    const h = new Headers({ location: `${url.origin}/?login_error=${code}`, "cache-control": "no-store", "referrer-policy": "no-referrer" });
    h.append("set-cookie", setCookie(STATE_COOKIE, "", 0, "/api/auth"));
    return new Response(null, { status: 302, headers: h });
  };
  if (!googleEnabled(env)) return fail("google_off");
  const state = url.searchParams.get("state") ?? "";
  const code = url.searchParams.get("code") ?? "";
  if (url.searchParams.get("error") || !code || !state) return fail("google_cancel");
  // state هم باید با کوکی مرورگر بخواند و هم در KV ساخته شده باشد
  const cookieOk = state === getCookie(req, STATE_COOKIE);
  const stateVal = cookieOk ? await env.KV.get(`wo:${state}`) : null;
  const nh = { "cache-control": "no-store", "referrer-policy": "no-referrer" };
  // پایان موفق (مشترک بین درخواست اصلی و تکراری): اپ ← کد یک‌بارمصرف، وب ← نشست
  const finish = async (uid: string, app: boolean): Promise<Response> => {
    if (app) {
      isApp = true;
      const c = randomToken(24);
      await env.KV.put(`ga:${c}`, uid, { expirationTtl: 120 });
      return appReturn(url, { c });
    }
    const h = new Headers({ location: `${url.origin}/`, ...nh });
    h.append("set-cookie", sessionCookie(await createSession(env, uid)));
    h.append("set-cookie", setCookie(STATE_COOKIE, "", 0, "/api/auth"));
    return new Response(null, { status: 302, headers: h });
  };
  const doneOf = async () => (cookieOk ? ((await env.KV.get(`wd:${state}`, "json")) as { u: string; a: boolean } | null) : null);

  if (stateVal === null) {
    // درخواست تکراری (تلاش دوباره‌ی nginx/CDN/مرورگر) بعد از ورودِ موفق: همان نتیجه را دوباره می‌دهیم، نه خطا
    const d = await doneOf();
    if (d) return finish(d.u, d.a);
    if (await authUser(env, req).catch(() => null)) {
      const h = new Headers({ location: `${url.origin}/`, ...nh });
      h.append("set-cookie", setCookie(STATE_COOKIE, "", 0, "/api/auth"));
      return new Response(null, { status: 302, headers: h });
    }
    return fail("google_state");
  }
  isApp = stateVal === "app";
  // فقط اولین درخواست کد گوگل را مصرف می‌کند (شمارنده‌ی اتمی)؛ درخواست هم‌زمان تکراری منتظر نتیجه‌ی اولی می‌ماند
  if (await hitLimit(env, `gcb:${state}`, 1, 120)) {
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 750));
      const d = await doneOf();
      if (d) return finish(d.u, d.a);
    }
    return fail("google_state");
  }

  try {
    const tr = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code, client_id: env.GOOGLE_CLIENT_ID!, client_secret: env.GOOGLE_CLIENT_SECRET!,
        redirect_uri: redirectUri(url), grant_type: "authorization_code",
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!tr.ok) { console.error("google token", tr.status, (await tr.text()).slice(0, 200)); return fail("google_token"); }
    const access = ((await tr.json()) as any).access_token as string | undefined;
    if (!access) return fail("google_token");

    const ur = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
      headers: { authorization: `Bearer ${access}` }, signal: AbortSignal.timeout(15_000),
    });
    if (!ur.ok) return fail("google_token");
    const info = (await ur.json()) as { sub?: string; email?: string; email_verified?: boolean; name?: string; picture?: string };
    const email = normEmail(info.email);
    if (!info.sub || !validEmail(email) || info.email_verified !== true) return fail("google_email");

    const user = await googleUser(env, { sub: info.sub, email, name: info.name, picture: info.picture });
    await env.KV.put(`wd:${state}`, JSON.stringify({ u: user.id, a: isApp }), { expirationTtl: 90 }); // برای درخواست تکراری در ۹۰ ثانیه (فقط با همان کوکی state)
    await env.KV.delete(`wo:${state}`).catch(() => {});
    return finish(user.id, isApp);
  } catch (e) {
    console.error("google callback", e);
    return fail("google_token");
  }
}
