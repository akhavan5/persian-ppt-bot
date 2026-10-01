import type { Env } from "./env";
import type { Settings } from "./types";
import { FONTS, THEMES, TONES } from "./themes";

export const DEFAULTS: Settings = { theme: "ocean", font: "Vazirmatn", slides: 8, tone: "formal", digits: true, images: true };
export const SLIDE_CHOICES = [5, 6, 8, 10, 12, 15];

export const clampSlides = (n: number) => Math.min(20, Math.max(3, Math.round(n)));

export async function getSettings(env: Env, userId: number): Promise<Settings> {
  const raw = (await env.KV.get(`u:${userId}`, "json")) as Partial<Settings> | null;
  const s = { ...DEFAULTS, ...(raw ?? {}) };
  if (!(s.theme in THEMES)) s.theme = DEFAULTS.theme;
  if (!(s.tone in TONES)) s.tone = DEFAULTS.tone;
  if (!(FONTS as readonly string[]).includes(s.font)) s.font = DEFAULTS.font;
  s.slides = clampSlides(Number(s.slides) || DEFAULTS.slides);
  s.digits = !!s.digits;
  s.images = !!s.images;
  return s;
}

export async function saveSettings(env: Env, userId: number, s: Settings) {
  await env.KV.put(`u:${userId}`, JSON.stringify(s));
}

// ---------- تماس برای شارژ ----------
export const SUPPORT_CONTACT = "@akhavan8";

// ---------- مجوز، مدیر و مسدودسازی ----------
const idList = (v?: string) => (v ?? "").split(",").map((x) => x.trim()).filter(Boolean);
export const adminIds = (env: Env) => idList(env.ADMIN_IDS);
export const isAdmin = (env: Env, userId: number) => adminIds(env).includes(String(userId));

export function isAllowed(env: Env, userId: number): boolean {
  if (isAdmin(env, userId)) return true;
  const list = idList(env.ALLOWED_USER_IDS);
  return list.length === 0 || list.includes(String(userId));
}

export const isBanned = async (env: Env, userId: number) => (await env.KV.get(`ban:${userId}`)) !== null;
export const setBanned = (env: Env, userId: number, on: boolean) =>
  on ? env.KV.put(`ban:${userId}`, "1") : env.KV.delete(`ban:${userId}`);

// ---------- اعتبار: سهمیه‌ی روزانه + اعتبار اضافه (شارژ دستی) ----------
export const dailyLimit = (env: Env) => {
  const n = Number(env.DAILY_LIMIT ?? "5");
  return Number.isFinite(n) && n >= 0 ? n : 5;
};

export const today = () => new Date().toISOString().slice(0, 10);
const dailyKey = (userId: number, day = today()) => `rl:${userId}:${day}`;
const bonusKey = (userId: number) => `bonus:${userId}`;

export async function getBonus(env: Env, userId: number): Promise<number> {
  return Math.max(0, Math.floor(Number(await env.KV.get(bonusKey(userId))) || 0));
}
export async function setBonus(env: Env, userId: number, n: number) {
  n = Math.max(0, Math.floor(n));
  if (n === 0) await env.KV.delete(bonusKey(userId));
  else await env.KV.put(bonusKey(userId), String(n));
}

export type CreditSource = "daily" | "bonus" | "none";
export interface CreditInfo { unlimited: boolean; limit: number; used: number; dailyLeft: number; bonus: number; total: number }

/** وضعیت اعتبار بدون مصرف کردن آن. مدیرها یا DAILY_LIMIT=0 ⇒ نامحدود. */
export async function getCredit(env: Env, userId: number): Promise<CreditInfo> {
  const limit = dailyLimit(env);
  if (isAdmin(env, userId) || limit === 0) {
    return { unlimited: true, limit, used: 0, dailyLeft: Infinity, bonus: 0, total: Infinity };
  }
  const [usedRaw, bonus] = await Promise.all([env.KV.get(dailyKey(userId)), getBonus(env, userId)]);
  const used = Number(usedRaw ?? 0) || 0;
  const dailyLeft = Math.max(0, limit - used);
  return { unlimited: false, limit, used, dailyLeft, bonus, total: dailyLeft + bonus };
}

/** یک ارائه اعتبار برمی‌دارد: اول از سهمیه‌ی روزانه، بعد از اعتبار اضافه. KV همگام‌سازی لحظه‌ای ندارد؛ برای کنترل هزینه کافی است، نه یک سد ریاضی دقیق. */
export async function spendCredit(env: Env, userId: number): Promise<{ ok: boolean; source: CreditSource; day: string; left: number; unlimited: boolean }> {
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
export async function refundCredit(env: Env, userId: number, source: CreditSource, day: string) {
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
const lockKey = (userId: number) => `lock:${userId}`;
export const isLocked = async (env: Env, userId: number) => (await env.KV.get(lockKey(userId))) !== null;
export const acquireLock = (env: Env, userId: number) => env.KV.put(lockKey(userId), String(Date.now()), { expirationTtl: 900 });
export const releaseLock = (env: Env, userId: number) => env.KV.delete(lockKey(userId));

// ---------- آمار ----------
export type StatName = "started" | "ok" | "fail";
export async function bumpStat(env: Env, name: StatName) {
  const k = `stat:${name}:${today()}`;
  const n = Number(await env.KV.get(k)) || 0;
  await env.KV.put(k, String(n + 1), { expirationTtl: 60 * 60 * 24 * 60 });
}

/** اولین دفعه‌ای که کاربر مجاز پیام می‌دهد ثبت می‌شود (برای آمار و /user). فقط زمان و نام کاربری. */
export async function touchUser(env: Env, userId: number, username?: string) {
  const k = `seen:${userId}`;
  if ((await env.KV.get(k)) === null) {
    await env.KV.put(k, JSON.stringify({ t: new Date().toISOString(), u: username ?? null }));
  }
}
export async function getUserSeen(env: Env, userId: number): Promise<{ t: string; u: string | null } | null> {
  return (await env.KV.get(`seen:${userId}`, "json")) as any;
}

export async function getStats(env: Env) {
  const day = today();
  let users = 0, cursor: string | undefined;
  for (let i = 0; i < 20; i++) {
    const r = await env.KV.list({ prefix: "seen:", cursor });
    users += r.keys.length;
    if (r.list_complete) break;
    cursor = (r as any).cursor;
  }
  const g = async (n: StatName) => Number(await env.KV.get(`stat:${n}:${day}`)) || 0;
  const [started, ok, fail] = await Promise.all([g("started"), g("ok"), g("fail")]);
  return { users, started, ok, fail };
}
