/**
 * نسخه‌ی وب: ورود با تلگرام (بدون رمز)، شروع ساخت ارائه، پیگیری وضعیت و دانلود فایل.
 *
 * - صفحه‌ها از «Static Assets» (پوشه‌ی public) سرو می‌شوند و Worker را صدا نمی‌زنند؛ فقط /api/* به این فایل می‌رسد.
 * - نشست: کوکی امضاشده (HMAC) بدون ذخیره‌سازی؛ اعتبار و تنظیمات همان‌هایی‌اند که ربات تلگرام استفاده می‌کند.
 * - KV در نقاط مختلف جهان با تأخیر همگام می‌شود (تا ۶۰ ثانیه)؛ برای هماهنگی لحظه‌ای (تأیید ورود، وضعیت ساخت)
 *   از یک Durable Object کوچک (WebState) استفاده می‌شود که همیشه هم‌خوان است.
 */
import { DurableObject } from "cloudflare:workers";
import type { Env } from "./env";
import type { DeckParams, Settings } from "./types";
import { FONTS, THEMES, TONES } from "./themes";
import {
  acquireLock, bumpStat, buyKb, clampSlides, displayName, getCredit, getSettings, getUserSeen, isAdmin, isAllowed,
  isBanned, isLocked, noteActive, refundCredit, releaseLock, saveSettings, spendCredit, supportLink, touchUser,
} from "./settings";
import { fileKey, listFiles } from "./files";
import { editMessage, esc, sendMessage, tg } from "./telegram";

// ---------- Durable Object: صندوق کوچک و هم‌خوان با انقضای خودکار ----------
export class WebState extends DurableObject<Env> {
  async write(json: string, ttlSec: number): Promise<void> {
    await this.ctx.storage.put("v", json);
    await this.ctx.storage.setAlarm(Date.now() + ttlSec * 1000);
  }
  async read(): Promise<string | null> {
    return (await this.ctx.storage.get<string>("v")) ?? null;
  }
  /** فقط اگر وضعیت فعلی (فیلد s) برابر from باشد مقدار را عوض می‌کند؛ اتمی است. */
  async swap(from: string, json: string): Promise<boolean> {
    const cur = await this.ctx.storage.get<string>("v");
    if (!cur) return false;
    let s: unknown;
    try { s = (JSON.parse(cur) as { s?: unknown }).s; } catch { return false; }
    if (s !== from) return false;
    await this.ctx.storage.put("v", json);
    return true;
  }
  async alarm(): Promise<void> {
    await this.ctx.storage.deleteAll();
  }
}

const box = (env: Env, name: string) => env.WEB_STATE.get(env.WEB_STATE.idFromName(name));
async function boxGet<T>(env: Env, name: string): Promise<T | null> {
  const r = await box(env, name).read();
  if (!r) return null;
  try { return JSON.parse(r) as T; } catch { return null; }
}
const boxSet = (env: Env, name: string, v: unknown, ttlSec: number) => box(env, name).write(JSON.stringify(v), ttlSec);

// ---------- وضعیت کار ساخت (Workflow اینجا می‌نویسد، مرورگر می‌خواند) ----------
export type JobPhase = "queued" | "outline" | "content" | "build" | "done" | "error";
export interface JobState { s: JobPhase; t: number; msg?: string; name?: string; title?: string; slides?: number }
const jobName = (userId: number, id: string) => `job:${userId}:${id}`;

export async function setJob(env: Env, userId: number, id: string, s: JobPhase, extra: Partial<JobState> = {}) {
  await boxSet(env, jobName(userId, id), { s, t: Date.now(), ...extra } satisfies JobState, 3600);
}

// ---------- ابزارهای کوچک ----------
const json = (data: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers },
  });
const fail = (status: number, code: string) => json({ error: code }, status);

function safeEq(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

const enc = new TextEncoder();
function b64u(buf: ArrayBuffer | Uint8Array): string {
  const b = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = "";
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// ---------- نشست: کوکی امضاشده (بدون ذخیره‌سازی) ----------
const COOKIE = "ppt_sid";
const SESSION_DAYS = 30;
const TOKEN_RE = /^[A-Za-z0-9_-]{32}$/;

async function sign(env: Env, msg: string): Promise<string> {
  // کلید از توکن ربات + پیشوند جدا ساخته می‌شود؛ نیاز به Secret تازه نیست (با عوض شدن توکن، نشست‌ها باطل می‌شوند)
  const key = await crypto.subtle.importKey("raw", enc.encode("web-session|" + env.TELEGRAM_BOT_TOKEN),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64u(await crypto.subtle.sign("HMAC", key, enc.encode(msg)));
}

async function sessionCookie(env: Env, userId: number): Promise<string> {
  const exp = Math.floor(Date.now() / 1000) + SESSION_DAYS * 86400;
  const body = `${userId}.${exp}`;
  return `${COOKIE}=${body}.${await sign(env, body)}; Path=/; Max-Age=${SESSION_DAYS * 86400}; HttpOnly; Secure; SameSite=Lax`;
}

function getCookie(req: Request, name: string): string | null {
  const h = req.headers.get("cookie");
  if (!h) return null;
  for (const part of h.split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}

async function sessionUser(env: Env, req: Request): Promise<number | null> {
  const p = getCookie(req, COOKIE)?.split(".");
  if (!p || p.length !== 3) return null;
  const [uid, exp, sig] = p;
  if (!/^\d{1,15}$/.test(uid) || !/^\d{1,12}$/.test(exp)) return null;
  if (Number(exp) < Date.now() / 1000) return null;
  if (!safeEq(sig, await sign(env, `${uid}.${exp}`))) return null;
  return Number(uid);
}

// ---------- ورود با تلگرام (لینک عمیق + تأیید داخل ربات) ----------
let botUser = "";
async function botUsername(env: Env): Promise<string> {
  if (!botUser) botUser = (await tg<{ username?: string }>(env, "getMe")).username ?? "";
  if (!botUser) throw new Error("bot username unknown");
  return botUser;
}

async function authStart(req: Request, env: Env): Promise<Response> {
  const token = b64u(crypto.getRandomValues(new Uint8Array(24))); // ۳۲ نویسه
  const cf = req.cf as IncomingRequestCfProperties | undefined; // موقعیت تقریبی درخواست؛ فقط برای نمایش در پیام تأیید ربات
  await boxSet(env, `login:${token}`, { s: "pending", c: cf?.country ?? "", city: cf?.city ?? "" }, 600);
  return json({ token, url: `https://t.me/${await botUsername(env)}?start=wl_${token}` });
}

async function authPoll(env: Env, url: URL): Promise<Response> {
  const token = url.searchParams.get("token") ?? "";
  if (!TOKEN_RE.test(token)) return fail(400, "bad_token");
  const name = `login:${token}`;
  const st = await boxGet<{ s: string; uid?: number }>(env, name);
  if (!st || st.s === "used") return json({ s: "expired" });
  if (st.s === "approved" && st.uid) {
    // فقط یک بار کوکی صادر می‌شود
    if (!(await box(env, name).swap("approved", JSON.stringify({ s: "used" })))) return json({ s: "expired" });
    return json({ s: "ok" }, 200, { "set-cookie": await sessionCookie(env, st.uid) });
  }
  return json({ s: st.s });
}

// ---- سمت ربات: پیام /start wl_<token> و دکمه‌های تأیید/لغو ----
const START_RE = /^\/start(?:@\w+)?\s+wl_([A-Za-z0-9_-]{32})\s*$/;

export function isWebLoginUpdate(u: any): boolean {
  const t = u?.message?.text;
  if (typeof t === "string" && START_RE.test(t.trim())) return true;
  const d = u?.callback_query?.data;
  return typeof d === "string" && d.startsWith("wl:");
}

export async function handleWebLogin(env: Env, update: any): Promise<void> {
  const msg = update?.message;
  if (msg?.chat?.type === "private" && msg.from && typeof msg.text === "string") {
    const m = msg.text.trim().match(START_RE);
    if (m) return await loginPrompt(env, msg.chat.id, msg.from, m[1]);
  }
  if (update?.callback_query) return await loginCallback(env, update.callback_query);
}

const supportKb = (userId: number) => ({ reply_markup: { inline_keyboard: [[{ text: "💬 پیام به پشتیبانی", url: supportLink(userId) }]] } });

/** همان بررسی‌های ربات: مسدود/غیرمجاز. true یعنی ادامه بدهیم. */
async function gate(env: Env, chatId: number, userId: number): Promise<boolean> {
  if (!isAdmin(env, userId) && (await isBanned(env, userId))) {
    await sendMessage(env, chatId, "⛔️ دسترسی شما به این ربات مسدود شده است.");
    return false;
  }
  if (!isAllowed(env, userId)) {
    await sendMessage(env, chatId, "⛔️ این ربات خصوصی است و شما دسترسی ندارید.\nبرای دریافت دسترسی، دکمه‌ی زیر را بزن.", supportKb(userId));
    return false;
  }
  return true;
}

async function loginPrompt(env: Env, chatId: number, from: any, token: string) {
  const userId: number = from.id;
  if (!(await gate(env, chatId, userId))) return;
  const name = displayName(from);
  await touchUser(env, userId, from.username, name).catch((e) => console.error("touchUser", e));
  if (!isAdmin(env, userId)) await noteActive(env, userId, from.username, name).catch(() => {});

  const st = await boxGet<{ s: string; c?: string; city?: string }>(env, `login:${token}`);
  if (!st || st.s !== "pending") {
    return void (await sendMessage(env, chatId, "⌛️ این لینک ورود منقضی شده یا قبلاً استفاده شده است. از صفحه‌ی وب دوباره «ورود با تلگرام» را بزن."));
  }
  const place = [st.city, st.c].filter(Boolean).join("، ");
  await sendMessage(env, chatId,
    "🔐 <b>درخواست ورود به نسخه‌ی وب</b>\n" +
    (place ? `📍 محل تقریبی درخواست: ${esc(place)}\n` : "") +
    "\nاگر خودت همین الان از روی وب‌سایت این درخواست را داده‌ای «تأیید ورود» را بزن؛ در غیر این صورت «لغو».",
    { reply_markup: { inline_keyboard: [[
      { text: "✅ تأیید ورود", callback_data: `wl:y:${token}` },
      { text: "❌ لغو", callback_data: `wl:n:${token}` },
    ]] } });
}

async function loginCallback(env: Env, cq: any) {
  await tg(env, "answerCallbackQuery", { callback_query_id: cq.id }).catch(() => {});
  const chatId: number | undefined = cq.message?.chat?.id;
  const mid: number | undefined = cq.message?.message_id;
  const userId: number | undefined = cq.from?.id;
  const [, act, token] = String(cq.data ?? "").split(":");
  if (!chatId || !mid || !userId || !TOKEN_RE.test(token ?? "")) return;
  if ((!isAdmin(env, userId) && (await isBanned(env, userId))) || !isAllowed(env, userId)) return;

  const name = `login:${token}`;
  if (act === "y") {
    const ok = await box(env, name).swap("pending", JSON.stringify({ s: "approved", uid: userId }));
    return await editMessage(env, chatId, mid, ok
      ? "✅ ورود تأیید شد. به مرورگر برگرد؛ چند ثانیه‌ی دیگر وارد می‌شوی."
      : "⌛️ این درخواست منقضی شده است. از صفحه‌ی وب دوباره تلاش کن.");
  }
  if (act === "n") {
    await box(env, name).swap("pending", JSON.stringify({ s: "denied" }));
    return await editMessage(env, chatId, mid, "❌ ورود لغو شد.");
  }
}

// ---------- API ----------
function pickSettings(s: Settings, raw: any): Settings {
  if (!raw || typeof raw !== "object") return s;
  if (typeof raw.theme === "string" && Object.hasOwn(THEMES, raw.theme)) s.theme = raw.theme;
  if (typeof raw.tone === "string" && Object.hasOwn(TONES, raw.tone)) s.tone = raw.tone;
  if (typeof raw.font === "string" && (FONTS as readonly string[]).includes(raw.font)) s.font = raw.font;
  if (Number.isFinite(Number(raw.slides))) s.slides = clampSlides(Number(raw.slides));
  if (typeof raw.digits === "boolean") s.digits = raw.digits;
  if (typeof raw.images === "boolean") s.images = raw.images;
  if (typeof raw.sources === "boolean") s.sources = raw.sources;
  if (typeof raw.questions === "boolean") s.questions = raw.questions;
  if (raw.mode === "student" || raw.mode === "normal") s.mode = raw.mode;
  return s;
}

async function me(env: Env, userId: number): Promise<Response> {
  const [settings, c, seen, files, busy] = await Promise.all([
    getSettings(env, userId), getCredit(env, userId), getUserSeen(env, userId).catch(() => null),
    listFiles(env, userId).catch(() => []), isLocked(env, userId),
  ]);
  return json({
    user: { id: userId, name: seen?.n ?? "", username: seen?.u ?? null },
    credit: c.unlimited ? { unlimited: true } : { unlimited: false, total: c.total, dailyLeft: c.dailyLeft, limit: c.limit, bonus: c.bonus },
    settings,
    busy,
    files: files.map((f) => ({ id: f.id, title: f.title, slides: f.slides, t: f.t })),
    // بسته‌های خرید و پشتیبانی از همان تنظیمات ربات خوانده می‌شود تا قیمت‌ها یک جا بماند
    buy: buyKb(userId).reply_markup.inline_keyboard.map((r) => r[0]),
    support: supportLink(userId),
    options: {
      themes: Object.entries(THEMES).map(([id, t]) => ({ id, name: t.name, primary: t.primary, accent: t.accent })),
      tones: Object.entries(TONES).map(([id, name]) => ({ id, name })),
      fonts: FONTS,
      slides: { min: 3, max: 20, studentMin: 8 },
    },
  });
}

async function generate(env: Env, req: Request, userId: number): Promise<Response> {
  let body: any;
  try { body = await req.json(); } catch { return fail(400, "bad_json"); }
  const topic = String(body?.topic ?? "").replace(/\s+/g, " ").trim();
  if (topic.length < 3) return fail(400, "topic_short");
  if (topic.length > 600) return fail(400, "topic_long");

  const settings = pickSettings(await getSettings(env, userId), body?.settings);
  await saveSettings(env, userId, settings); // تنظیمات بین ربات و وب مشترک است

  if (await isLocked(env, userId)) return fail(409, "busy");
  const quota = await spendCredit(env, userId);
  if (!quota.ok) return fail(402, "no_credit");
  await acquireLock(env, userId);

  const run: Settings = { ...settings };
  if (run.mode === "student") run.slides = Math.max(run.slides, 8); // مثل ربات
  const id = `w-${crypto.randomUUID()}`;
  try {
    await setJob(env, userId, id, "queued");
    const params: DeckParams = { chatId: 0, statusMessageId: 0, userId, topic, settings: run, credit: quota.source, day: quota.day, web: true };
    await env.DECK_WORKFLOW.create({ id, params });
  } catch (e) {
    console.error("web workflow create failed", e);
    await refundCredit(env, userId, quota.source, quota.day).catch((err) => console.error("refund", err));
    await releaseLock(env, userId).catch((err) => console.error("unlock", err));
    return fail(500, "start_failed");
  }
  await bumpStat(env, "started").catch(() => {});
  return json({ id });
}

const JOB_ID_RE = /^w-[0-9a-f-]{36}$/;
const JOB_STALE_MS = 16 * 60 * 1000; // هم‌اندازه‌ی انقضای قفل (۹۰۰ ثانیه) + کمی فاصله
const FAIL_MSG = "ساخت ارائه با خطا مواجه شد. چند دقیقه بعد دوباره امتحان کن.";

async function job(env: Env, url: URL, userId: number): Promise<Response> {
  const id = url.searchParams.get("id") ?? "";
  if (!JOB_ID_RE.test(id)) return fail(400, "bad_id");
  const st = await boxGet<JobState>(env, jobName(userId, id));
  if (!st) return fail(404, "not_found");
  if (st.s !== "done" && st.s !== "error") {
    if (Date.now() - st.t > JOB_STALE_MS) return json({ s: "error", msg: FAIL_MSG });
    // پشتیبان: اگر Workflow بدون ثبت خطا از کار افتاده باشد
    try {
      const i = await (await env.DECK_WORKFLOW.get(id)).status();
      if (i.status === "errored" || i.status === "terminated") return json({ s: "error", msg: FAIL_MSG });
    } catch { /* نمونه هنوز دیده نمی‌شود؛ ادامه */ }
  }
  return json({ s: st.s, msg: st.msg, title: st.title, slides: st.slides });
}

async function download(env: Env, url: URL, userId: number): Promise<Response> {
  const id = url.searchParams.get("id") ?? "";
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(id)) return fail(400, "bad_id");
  // کلید فایل شامل شناسه‌ی همین کاربر است؛ پس کسی به فایل دیگران دسترسی ندارد
  const data = await env.KV.get(fileKey(userId, id), "arrayBuffer");
  if (!data) {
    return new Response("این فایل منقضی شده است (فایل‌ها ۲۴ ساعت نگه داشته می‌شوند).", {
      status: 404, headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }
  let name = id.startsWith("w-") ? (await boxGet<JobState>(env, jobName(userId, id)))?.name : undefined;
  if (!name) name = (await listFiles(env, userId).catch(() => [])).find((f) => f.id === id)?.name;
  name ||= "presentation.pptx";
  const ascii = name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  const utf8 = encodeURIComponent(name).replace(/['()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
  return new Response(data, {
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      "content-disposition": `attachment; filename="${ascii}"; filename*=UTF-8''${utf8}`,
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
    },
  });
}

export async function handleWeb(req: Request, env: Env, url: URL): Promise<Response> {
  const path = url.pathname;
  const get = req.method === "GET";
  const post = req.method === "POST";
  // محافظت CSRF: درخواست‌های POST باید هدر سفارشی داشته باشند (مرورگر برای هدر سفارشی از سایت دیگر اجازه نمی‌دهد) و Origin باید همین سایت باشد
  if (post) {
    const o = req.headers.get("origin");
    if ((o && o !== url.origin) || req.headers.get("x-ppt") !== "1") return fail(403, "forbidden");
  }
  try {
    if (path === "/api/auth/start" && post) return await authStart(req, env);
    if (path === "/api/auth/poll" && get) return await authPoll(env, url);
    if (path === "/api/auth/logout" && post) {
      return json({ ok: true }, 200, { "set-cookie": `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax` });
    }

    const userId = await sessionUser(env, req);
    if (userId === null) return fail(401, "unauthorized");
    if (!isAllowed(env, userId)) return fail(403, "forbidden");
    if (!isAdmin(env, userId) && (await isBanned(env, userId))) return fail(403, "banned");

    if (path === "/api/me" && get) return await me(env, userId);
    if (path === "/api/generate" && post) return await generate(env, req, userId);
    if (path === "/api/job" && get) return await job(env, url, userId);
    if (path === "/api/download" && get) return await download(env, url, userId);
    return fail(404, "not_found");
  } catch (e) {
    console.error("web api", path, e);
    return fail(500, "server_error");
  }
}
