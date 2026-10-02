/**
 * سیستم کاربری نسخه‌ی وب؛ کاملاً جدا از تلگرام.
 * - ثبت‌نام/ورود با ایمیل و رمز (PBKDF2-SHA256 با Web Crypto؛ سقف تکرار در Workers ‏۱۰۰٬۰۰۰ است)
 * - ورود با گوگل (OAuth 2.0 Authorization Code، سمت سرور)
 * - نشست‌ها: توکن تصادفی در کوکی HttpOnly؛ در KV فقط هشِ توکن نگه داشته می‌شود
 * همه‌چیز روی همان KV فعلی است؛ هیچ منبع جدیدی لازم نیست.
 */
import type { Env } from "./env";
import { bumpStat } from "./settings";

export interface WebUser {
  id: string; // w_ + ۱۶ نویسه‌ی هگز
  email: string;
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

export async function createUser(env: Env, p: { email: string; name: string; hash?: string; google?: string; picture?: string }): Promise<WebUser> {
  const u: WebUser = {
    id: "w_" + hex(crypto.getRandomValues(new Uint8Array(8))),
    email: p.email, name: p.name.slice(0, 64), picture: p.picture, hash: p.hash, google: p.google,
    verified: !!p.google, created: Date.now(),
  };
  await saveUser(env, u);
  await env.KV.put(`we:${u.email}`, u.id);
  if (u.google) await env.KV.put(`wg:${u.google}`, u.id);
  await bumpStat(env, "newusers").catch(() => {});
  return u;
}

export const publicUser = (u: WebUser) => ({ id: u.id, email: u.email, name: u.name, picture: u.picture ?? null });

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
