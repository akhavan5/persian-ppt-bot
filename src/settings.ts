import type { Env } from "./env";
import type { Settings } from "./types";
import { FONTS, THEMES, TONES } from "./themes";

/** شناسه‌ی کاربر: عددی برای تلگرام، رشته‌ی «w_…» برای کاربران وب */
export type Uid = number | string;
export const isWebId = (id: Uid) => typeof id === "string" && id.startsWith("w_");

export const DEFAULTS: Settings = { theme: "ocean", font: "Vazirmatn", slides: 8, tone: "formal", digits: true, images: true, mode: "normal", sources: false, questions: false };
export const SLIDE_CHOICES = [5, 6, 8, 10, 12, 15];

export const clampSlides = (n: number) => Math.min(20, Math.max(3, Math.round(n)));

export async function getSettings(env: Env, userId: Uid): Promise<Settings> {
  const raw = (await env.KV.get(`u:${userId}`, "json")) as Partial<Settings> | null;
  const s = { ...DEFAULTS, ...(raw ?? {}) };
  if (!(s.theme in THEMES)) s.theme = DEFAULTS.theme;
  if (!(s.tone in TONES)) s.tone = DEFAULTS.tone;
  if (!(FONTS as readonly string[]).includes(s.font)) s.font = DEFAULTS.font;
  s.slides = clampSlides(Number(s.slides) || DEFAULTS.slides);
  s.digits = !!s.digits;
  s.images = !!s.images;
  s.mode = s.mode === "student" ? "student" : "normal";
  s.sources = !!s.sources;
  s.questions = !!s.questions;
  return s;
}

export async function saveSettings(env: Env, userId: Uid, s: Settings) {
  await env.KV.put(`u:${userId}`, JSON.stringify(s));
}

// ---------- تماس برای شارژ ----------
export const SUPPORT_CONTACT = "@akhavan8";
/** لینک پیام به پشتیبان با متن آماده‌ای که شناسه‌ی کاربر داخلش هست (کاربر فقط «ارسال» را می‌زند) */
export const supportLink = (userId: Uid) =>
  `https://t.me/${SUPPORT_CONTACT.slice(1)}?text=` +
  encodeURIComponent(`سلام، می‌خواهم اعتبار ربات ساخت پاورپوینت را شارژ کنم.\nشناسه‌ی من: ${userId}`);

export const BUY_NOTE = "💰 برای خرید شارژ، یکی از بسته‌های زیر را انتخاب کن:";
export const buyLink = (userId: Uid, count: number, price: number) =>
  `https://t.me/${SUPPORT_CONTACT.slice(1)}?text=` +
  encodeURIComponent(`سلام، می‌خواهم بسته‌ی ${count} پاورپوینتی (${price} هزار تومان) ربات ساخت پاورپوینت را بخرم.\nشناسه‌ی من: ${userId}`);
/** دو دکمه‌ی شیشه‌ای خرید؛ پیام آماده شامل بسته‌ی انتخابی و شناسه‌ی کاربر است */
export const buyKb = (userId: Uid) => ({
  reply_markup: {
    inline_keyboard: [
      [{ text: "🛒 ۱۰ پاورپوینت — ۵۰ هزار تومان", url: buyLink(userId, 10, 50) }],
      [{ text: "🛒 ۲۰ پاورپوینت — ۸۰ هزار تومان", url: buyLink(userId, 20, 80) }],
    ],
  },
});

// ---------- مجوز، مدیر و مسدودسازی ----------
const idList = (v?: string) => (v ?? "").split(",").map((x) => x.trim()).filter(Boolean);
export const adminIds = (env: Env) => idList(env.ADMIN_IDS);
export const isAdmin = (env: Env, userId: Uid) => adminIds(env).includes(String(userId));

export function isAllowed(env: Env, userId: Uid): boolean {
  if (isAdmin(env, userId)) return true;
  const list = idList(env.ALLOWED_USER_IDS);
  return list.length === 0 || list.includes(String(userId));
}

export const isBanned = async (env: Env, userId: Uid) => (await env.KV.get(`ban:${userId}`)) !== null;
export const setBanned = (env: Env, userId: Uid, on: boolean) =>
  on ? env.KV.put(`ban:${userId}`, "1") : env.KV.delete(`ban:${userId}`);

// ---------- اعتبار: سهمیه‌ی روزانه + اعتبار اضافه (شارژ دستی) ----------
export const dailyLimit = (env: Env, userId?: Uid) => {
  // کاربران وب می‌توانند سقف جدا داشته باشند (WEB_DAILY_LIMIT)؛ اگر تنظیم نشده باشد همان DAILY_LIMIT اعمال می‌شود
  const web = userId !== undefined && isWebId(userId) && (env.WEB_DAILY_LIMIT ?? "") !== "";
  const n = Number((web ? env.WEB_DAILY_LIMIT : env.DAILY_LIMIT) ?? "5");
  return Number.isFinite(n) && n >= 0 ? n : 5;
};

export const today = () => new Date().toISOString().slice(0, 10);
const dailyKey = (userId: Uid, day = today()) => `rl:${userId}:${day}`;
const bonusKey = (userId: Uid) => `bonus:${userId}`;

export async function getBonus(env: Env, userId: Uid): Promise<number> {
  return Math.max(0, Math.floor(Number(await env.KV.get(bonusKey(userId))) || 0));
}
export async function setBonus(env: Env, userId: Uid, n: number) {
  n = Math.max(0, Math.floor(n));
  if (n === 0) await env.KV.delete(bonusKey(userId));
  else await env.KV.put(bonusKey(userId), String(n));
}

export type CreditSource = "daily" | "bonus" | "none";
export interface CreditInfo { unlimited: boolean; limit: number; used: number; dailyLeft: number; bonus: number; total: number }

/** وضعیت اعتبار بدون مصرف کردن آن. مدیرها یا DAILY_LIMIT=0 ⇒ نامحدود. */
export async function getCredit(env: Env, userId: Uid): Promise<CreditInfo> {
  const limit = dailyLimit(env, userId);
  if (isAdmin(env, userId) || limit === 0) {
    return { unlimited: true, limit, used: 0, dailyLeft: Infinity, bonus: 0, total: Infinity };
  }
  const [usedRaw, bonus] = await Promise.all([env.KV.get(dailyKey(userId)), getBonus(env, userId)]);
  const used = Number(usedRaw ?? 0) || 0;
  const dailyLeft = Math.max(0, limit - used);
  return { unlimited: false, limit, used, dailyLeft, bonus, total: dailyLeft + bonus };
}

/** یک ارائه اعتبار برمی‌دارد: اول از سهمیه‌ی روزانه، بعد از اعتبار اضافه. KV همگام‌سازی لحظه‌ای ندارد؛ برای کنترل هزینه کافی است، نه یک سد ریاضی دقیق. */
export async function spendCredit(env: Env, userId: Uid): Promise<{ ok: boolean; source: CreditSource; day: string; left: number; unlimited: boolean }> {
  const day = today();
  const c = await getCredit(env, userId);
  if (c.unlimited) return { ok: true, source: "none", day, left: Infinity, unlimited: true };
  if (c.dailyLeft > 0) {
    await env.KV.put(dailyKey(userId, day), String(c.used + 1), { expirationTtl: 172_800 });
    return { ok: true, source: "daily", day, left: c.total - 1, unlimited: false };
  }
  if (c.bonus > 0) {
    await setBonus(env, userId, c.bonus - 1);
    return { ok: true, source: "bonus", day, left: c.bonus - 1, unlimited: false };
  }
  return { ok: false, source: "none", day, left: 0, unlimited: false };
}

/** برگرداندن اعتبار وقتی ساخت ارائه شکست خورد. */
export async function refundCredit(env: Env, userId: Uid, source: CreditSource, day: string) {
  if (source === "daily") {
    const k = dailyKey(userId, day);
    const used = Number(await env.KV.get(k)) || 0;
    if (used > 0) await env.KV.put(k, String(used - 1), { expirationTtl: 172_800 });
  } else if (source === "bonus") {
    await setBonus(env, userId, (await getBonus(env, userId)) + 1);
  }
}

// ---------- قفل: هر کاربر در هر لحظه یک ارائه ----------
// TTL فقط شبکه‌ی ایمنی است تا اگر Workflow اصلاً به پایان نرسید، کاربر برای همیشه قفل نماند.
const lockKey = (userId: Uid) => `lock:${userId}`;
export const isLocked = async (env: Env, userId: Uid) => (await env.KV.get(lockKey(userId))) !== null;
export const acquireLock = (env: Env, userId: Uid) => env.KV.put(lockKey(userId), String(Date.now()), { expirationTtl: 900 });
export const releaseLock = (env: Env, userId: Uid) => env.KV.delete(lockKey(userId));

// ---------- آمار ----------
export type StatName = "started" | "ok" | "fail" | "newusers";
export async function bumpStat(env: Env, name: StatName) {
  const k = `stat:${name}:${today()}`;
  const n = Number(await env.KV.get(k)) || 0;
  await env.KV.put(k, String(n + 1), { expirationTtl: 60 * 60 * 24 * 60 });
}

export interface SeenUser { t: string; u: string | null; n?: string }

/** نام نمایشی کاربر تلگرام (نام + نام خانوادگی) */
export const displayName = (from: any): string =>
  [from?.first_name, from?.last_name].filter(Boolean).join(" ").trim().slice(0, 64);

/** اولین دفعه‌ای که کاربر مجاز پیام می‌دهد ثبت می‌شود (برای آمار و /user). زمان، نام کاربری و نام نمایشی.
 *  اگر نام یا نام کاربری بعداً عوض شود (یا برای کاربران قدیمی که نامشان ثبت نشده)، به‌روز می‌شود. */
export async function touchUser(env: Env, userId: Uid, username?: string, name?: string): Promise<boolean> {
  const k = `seen:${userId}`;
  const cur = (await env.KV.get(k, "json")) as SeenUser | null;
  if (cur === null) {
    await env.KV.put(k, JSON.stringify({ t: new Date().toISOString(), u: username ?? null, n: name ?? "" }));
    await bumpStat(env, "newusers").catch(() => {});
    return true; // کاربر جدید
  }
  if ((username ?? null) !== (cur.u ?? null) || (name && name !== cur.n)) {
    await env.KV.put(k, JSON.stringify({ ...cur, u: username ?? null, n: name || cur.n || "" }));
  }
  return false;
}

// ---------- ۱۰ کاربر اخیر (بر اساس آخرین پیام) ----------
export interface RecentUser { id: number; n: string; u: string | null; t: number }
const RECENT_KEY = "recent:users";
const RECENT_MAX = 10;

export async function getRecentUsers(env: Env): Promise<RecentUser[]> {
  const raw = (await env.KV.get(RECENT_KEY, "json")) as RecentUser[] | null;
  return Array.isArray(raw) ? raw.filter((x) => x && Number.isSafeInteger(x.id)) : [];
}

/** کاربر را به ابتدای فهرست «اخیر» می‌آورد. اگر همین کاربر کمتر از ۱ دقیقه پیش بالای فهرست بوده، نوشتن تکراری انجام نمی‌شود. */
export async function noteActive(env: Env, userId: Uid, username?: string, name?: string) {
  const list = await getRecentUsers(env);
  const top = list[0];
  const u = username ?? null, n = name ?? "";
  if (top && top.id === userId && top.u === u && top.n === n && Date.now() - top.t < 60_000) return;
  const next = [{ id: userId, n, u, t: Date.now() }, ...list.filter((x) => x.id !== userId)].slice(0, RECENT_MAX);
  await env.KV.put(RECENT_KEY, JSON.stringify(next));
}

// ---------- دعوت دوستان ----------
/** حداکثر تعداد دعوت‌هایی که پاداش دارند (جلوگیری از سوءاستفاده با حساب‌های ساختگی) */
export const REF_MAX = 20;

/** به دعوت‌کننده ۱ ارائه‌ی رایگان می‌دهد. هر کاربر جدید فقط یک بار حساب می‌شود. */
export async function rewardReferral(env: Env, inviterId: number, newUserId: number): Promise<boolean> {
  if (!Number.isSafeInteger(inviterId) || inviterId <= 0 || inviterId === newUserId) return false;
  if ((await env.KV.get(`ref:${newUserId}`)) !== null) return false;
  if ((await env.KV.get(`seen:${inviterId}`)) === null) return false; // دعوت‌کننده باید کاربر واقعی ربات باشد
  if (await isBanned(env, inviterId)) return false;
  const ck = `refc:${inviterId}`;
  const n = Number(await env.KV.get(ck)) || 0;
  if (n >= REF_MAX) return false;
  await env.KV.put(`ref:${newUserId}`, String(inviterId));
  await env.KV.put(ck, String(n + 1));
  await setBonus(env, inviterId, (await getBonus(env, inviterId)) + 1);
  return true;
}
export async function getUserSeen(env: Env, userId: Uid): Promise<SeenUser | null> {
  return (await env.KV.get(`seen:${userId}`, "json")) as any;
}

export async function getStats(env: Env, days = 7) {
  let users = 0, cursor: string | undefined;
  for (let i = 0; i < 20; i++) {
    const r = await env.KV.list({ prefix: "seen:", cursor });
    users += r.keys.length;
    if (r.list_complete) break;
    cursor = (r as any).cursor;
  }
  const names: StatName[] = ["started", "ok", "fail", "newusers"];
  const dates = Array.from({ length: days }, (_, i) => new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10));
  const rows = await Promise.all(dates.map((d) => Promise.all(names.map(async (n) => Number(await env.KV.get(`stat:${n}:${d}`)) || 0))));
  const pack = (v: number[]) => ({ started: v[0], ok: v[1], fail: v[2], newusers: v[3] });
  const week = pack(names.map((_, j) => rows.reduce((a, r) => a + r[j], 0)));
  return { users, today: pack(rows[0]), week };
}
