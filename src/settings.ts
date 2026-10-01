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

// ---------- مجوز و سقف روزانه ----------
export function isAllowed(env: Env, userId: number): boolean {
  const list = (env.ALLOWED_USER_IDS ?? "").split(",").map((x) => x.trim()).filter(Boolean);
  return list.length === 0 || list.includes(String(userId));
}

export const dailyLimit = (env: Env) => {
  const n = Number(env.DAILY_LIMIT ?? "5");
  return Number.isFinite(n) && n >= 0 ? n : 5;
};

/** شمارنده‌ی روزانه (UTC). KV همگام‌سازی لحظه‌ای ندارد؛ برای کنترل هزینه کافی است، نه یک سد ریاضی دقیق. */
export async function bumpDaily(env: Env, userId: number): Promise<{ ok: boolean; used: number; limit: number }> {
  const limit = dailyLimit(env);
  if (limit === 0) return { ok: true, used: 0, limit };
  const key = `rl:${userId}:${new Date().toISOString().slice(0, 10)}`;
  const used = Number((await env.KV.get(key)) ?? 0);
  if (used >= limit) return { ok: false, used, limit };
  await env.KV.put(key, String(used + 1), { expirationTtl: 172_800 });
  return { ok: true, used: used + 1, limit };
}
