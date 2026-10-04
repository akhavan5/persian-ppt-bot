/**
 * سیستم کاربری نسخه‌ی وب؛ کاملاً جدا از تلگرام.
 * - ثبت‌نام/ورود با ایمیل و رمز (PBKDF2-SHA256 با Web Crypto؛ سقف تکرار در Workers ‏۱۰۰٬۰۰۰ است)
 * - ورود با گوگل (OAuth 2.0 Authorization Code، سمت سرور)
 * - ورود/ثبت‌نام یکپارچه با پیامک یک‌بارمصرف (OTP): اگر حسابی با آن شماره بود وارد می‌شود، وگرنه ساخته می‌شود
 * - نشست‌ها: توکن تصادفی در کوکی HttpOnly؛ در KV فقط هشِ توکن نگه داشته می‌شود
 * همه‌چیز روی همان KV فعلی است؛ هیچ منبع جدیدی لازم نیست.
 */
import type { Env } from "./env";
import { bumpStat } from "./settings";

export interface WebUser {
  id: string; // w_ + ۱۶ نویسه‌ی هگز
  email: string; // ممکن است خالی باشد (حساب ساخته‌شده با موبایل)
  mobile?: string; // 09XXXXXXXXX
  name: string;
  picture?: string;
  hash?: string; // خالی = حساب فقط-گوگل
  google?: string; // شناسه‌ی sub گوگل
  verified: boolean; // ایمیل تایید شده؟ (فقط با گوگل true می‌شود)
  created: number;
}

const enc = new TextEncoder();
const ITER = 100_000;
const SESSION_TTL = 60 * 60 * 24 * 30; // ۳۰ روز
export const SESSION_COOKIE = "sid";

// ---------- ابزارها ----------
const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
export const b64u = (b: Uint8Array) => btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64u = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
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

// ---------- رمز عبور ----------
async function derive(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, 256));
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return `pbkdf2$${ITER}$${b64u(salt)}$${b64u(await derive(password, salt, ITER))}`;
}

// برای یکسان بودن زمان پاسخ وقتی کاربر وجود ندارد (جلوگیری از شناسایی ایمیل‌ها با زمان‌سنجی)
const DUMMY = "pbkdf2$100000$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

export async function verifyPassword(password: string, stored?: string): Promise<boolean> {
  const [alg, it, salt, hash] = (stored || DUMMY).split("$");
  const iterations = Number(it);
  if (alg !== "pbkdf2" || !Number.isInteger(iterations) || iterations < 1000 || iterations > ITER) return false;
  const got = await derive(password, unb64u(salt), iterations);
  return safeEqual(got, unb64u(hash)) && !!stored;
}

// ---------- کاربران ----------
export const getUserById = (env: Env, id: string) => env.KV.get(`wu:${id}`, "json") as Promise<WebUser | null>;
export async function getUserByEmail(env: Env, email: string): Promise<WebUser | null> {
  const id = await env.KV.get(`we:${email}`);
  return id ? getUserById(env, id) : null;
}
const saveUser = (env: Env, u: WebUser) => env.KV.put(`wu:${u.id}`, JSON.stringify(u));

export async function createUser(env: Env, p: { email?: string; mobile?: string; name: string; hash?: string; google?: string; picture?: string }): Promise<WebUser> {
  const u: WebUser = {
    id: "w_" + hex(crypto.getRandomValues(new Uint8Array(8))),
    email: p.email ?? "", mobile: p.mobile, name: p.name.slice(0, 64), picture: p.picture, hash: p.hash, google: p.google,
    verified: !!p.google || !!p.mobile, created: Date.now(),
  };
  await saveUser(env, u);
  if (u.email) await env.KV.put(`we:${u.email}`, u.id);
  if (u.mobile) await env.KV.put(`wm:${u.mobile}`, u.id);
  if (u.google) await env.KV.put(`wg:${u.google}`, u.id);
  await bumpStat(env, "newusers").catch(() => {});
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
  const token = getCookie(req, SESSION_COOKIE);
  if (!token || token.length > 100) return null;
  const id = await env.KV.get(`ws:${await sha256hex(token)}`);
  return id ? getUserById(env, id) : null;
}

// ---------- محدودیت تلاش (KV؛ بهترین‌تلاش، نه سد ریاضی دقیق) ----------
export async function hitLimit(env: Env, key: string, max: number, ttl: number): Promise<boolean> {
  const n = Number(await env.KV.get(key)) || 0;
  if (n >= max) return true;
  await env.KV.put(key, String(n + 1), { expirationTtl: ttl });
  return false;
}

// ---------- ورود با پیامک یک‌بارمصرف (OTP) ----------
export const otpEnabled = (env: Env) => !!(env.SMS_API_TOKEN ?? "").trim();
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

const otpHash = (code: string, mobile: string) => sha256hex(`otp:${mobile}:${code}`);

/** ارسال کد ۶ رقمی. خروجی: null = موفق، وگرنه {error, status}. */
export async function sendOtp(env: Env, ip: string, mobile: string): Promise<{ error: string; status: number } | null> {
  if (!otpEnabled(env)) return { error: "ورود با پیامک فعال نیست.", status: 503 };
  // محدودیت: ۶۰ ثانیه فاصله بین دو ارسال به یک شماره، ۵ پیامک در ساعت برای هر شماره، ۱۵ در ساعت برای هر شبکه
  if (await env.KV.get(`oc:${mobile}`)) return { error: "کد قبلاً ارسال شده است؛ تا یک دقیقه صبر کن و دوباره بخواه.", status: 429 };
  if (await hitLimit(env, `os:m:${mobile}`, 5, 3600)) return { error: "تعداد درخواست کد برای این شماره زیاد بود؛ یک ساعت بعد دوباره امتحان کن.", status: 429 };
  if (await hitLimit(env, `os:ip:${ip}`, 15, 3600)) return { error: "تعداد درخواست کد از این شبکه زیاد بود؛ کمی بعد دوباره امتحان کن.", status: 429 };

  const n = crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000;
  const code = String(n).padStart(6, "0");
  const exp = Math.floor(Date.now() / 1000) + OTP_TTL;
  await env.KV.put(`ot:${mobile}`, JSON.stringify({ h: await otpHash(code, mobile), tries: 0, exp }), { expiration: exp });
  await env.KV.put(`oc:${mobile}`, "1", { expirationTtl: 60 });

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
  await env.KV.delete(`ot:${mobile}`);
  await env.KV.delete(`oc:${mobile}`);
  return { error: "ارسال پیامک ناموفق بود؛ چند دقیقه بعد دوباره امتحان کن.", status: 502 };
}

/** بررسی کد. موفق ⇒ کد مصرف می‌شود (یک‌بار مصرف). خروجی: null = درست، وگرنه پیام خطا. */
export async function checkOtp(env: Env, mobile: string, code: string): Promise<string | null> {
  if (!/^\d{6}$/.test(code)) return "کد باید ۶ رقم باشد.";
  const rec = (await env.KV.get(`ot:${mobile}`, "json")) as { h: string; tries: number; exp: number } | null;
  if (!rec) return "کد منقضی شده است؛ دوباره کد بگیر.";
  if (rec.tries >= OTP_MAX_TRIES) { await env.KV.delete(`ot:${mobile}`); return "تعداد تلاش‌های ناموفق زیاد بود؛ دوباره کد بگیر."; }
  const ok = safeEqual(enc.encode(await otpHash(code, mobile)), enc.encode(rec.h));
  if (!ok) {
    await env.KV.put(`ot:${mobile}`, JSON.stringify({ ...rec, tries: rec.tries + 1 }), { expiration: Math.max(rec.exp, Math.floor(Date.now() / 1000) + 60) });
    return "کد درست نیست.";
  }
  await env.KV.delete(`ot:${mobile}`);
  return null;
}

// ---------- ورود با گوگل ----------
export const googleEnabled = (env: Env) => !!env.GOOGLE_CLIENT_ID && !!env.GOOGLE_CLIENT_SECRET;
const redirectUri = (url: URL) => `${url.origin}/api/auth/google/callback`;
const STATE_COOKIE = "gstate";

export async function googleStart(env: Env, url: URL): Promise<Response> {
  if (!googleEnabled(env)) return Response.redirect(`${url.origin}/?login_error=google_off`, 302);
  const state = randomToken(24);
  await env.KV.put(`wo:${state}`, "1", { expirationTtl: 600 });
  const q = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID!, redirect_uri: redirectUri(url), response_type: "code",
    scope: "openid email profile", state, prompt: "select_account",
  });
  const h = new Headers({ location: `https://accounts.google.com/o/oauth2/v2/auth?${q}` });
  h.append("set-cookie", setCookie(STATE_COOKIE, state, 600, "/api/auth"));
  return new Response(null, { status: 302, headers: h });
}

export async function googleCallback(env: Env, req: Request, url: URL): Promise<Response> {
  const fail = (code: string) => {
    const h = new Headers({ location: `${url.origin}/?login_error=${code}` });
    h.append("set-cookie", setCookie(STATE_COOKIE, "", 0, "/api/auth"));
    return new Response(null, { status: 302, headers: h });
  };
  if (!googleEnabled(env)) return fail("google_off");
  const state = url.searchParams.get("state") ?? "";
  const code = url.searchParams.get("code") ?? "";
  if (url.searchParams.get("error") || !code || !state) return fail("google_cancel");
  // state هم باید با کوکی مرورگر بخواند و هم در KV ساخته شده باشد (یک‌بار مصرف)
  if (state !== getCookie(req, STATE_COOKIE) || (await env.KV.get(`wo:${state}`)) === null) return fail("google_state");
  await env.KV.delete(`wo:${state}`);

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

    let user: WebUser | null = null;
    const gid = await env.KV.get(`wg:${info.sub}`);
    if (gid) user = await getUserById(env, gid);
    if (!user) {
      user = await getUserByEmail(env, email);
      if (user) {
        // ایمیل را گوگل تایید کرده است ⇒ حساب موجود به گوگل وصل می‌شود.
        // اگر آن حساب با رمز ساخته شده و ایمیلش تایید نشده بود، رمزش حذف می‌شود
        // (جلوگیری از ثبت‌نام قبلیِ شخص دیگر با ایمیلِ شما)
        if (user.hash && !user.verified) delete user.hash;
        user.google = info.sub;
        user.verified = true;
        user.picture ||= info.picture;
        await saveUser(env, user);
        await env.KV.put(`wg:${info.sub}`, user.id);
      } else {
        user = await createUser(env, { email, name: info.name || email.split("@")[0], google: info.sub, picture: info.picture });
      }
    }

    const token = await createSession(env, user.id);
    const h = new Headers({ location: `${url.origin}/` });
    h.append("set-cookie", sessionCookie(token));
    h.append("set-cookie", setCookie(STATE_COOKIE, "", 0, "/api/auth"));
    return new Response(null, { status: 302, headers: h });
  } catch (e) {
    console.error("google callback", e);
    return fail("google_token");
  }
}
