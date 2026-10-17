/**
 * ساخت ارائه از روی لینک: کاربر آدرس یک صفحه‌ی وب را می‌دهد، متن صفحه با Tavily Extract خوانده می‌شود
 * و مثل متن فایل آپلودی «منبع اصلی» ارائه می‌شود (همان مسیر source در deck-service / workflow).
 *
 * - فعال بودن: فقط وقتی TAVILY_API_KEY تنظیم باشد (و LINK_SOURCE=off نباشد).
 * - هزینه‌ی Tavily: Extract عادی (basic) هر ۵ لینک موفق = ۱ اعتبار؛ اگر صفحه خالی/کم‌متن برگشت (مثلاً صفحه‌ی پر از جاوااسکریپت)
 *   یک بار با extract_depth=advanced (هر ۵ لینک موفق = ۲ اعتبار) دوباره امتحان می‌شود. لینک ناموفق هزینه ندارد.
 * - سقف: LINK_DAILY_LIMIT (پیش‌فرض ۱۰ لینک در روز برای هر کاربر)، اختیاری: LINK_GLOBAL_DAILY (سقف کل سایت در روز).
 * - کاربر اعتبار ساخت ارائه‌اش را برای «خواندن لینک» خرج نمی‌کند؛ اعتبار فقط با ساخت ارائه کم می‌شود.
 */
import type { Env } from "./env";
import { hitLimit } from "./auth";
import { today, type Uid } from "./settings";

export const MAX_LINK_CHARS = 120000; // مثل MAX_SOURCE_CHARS در deck-service
const MIN_USABLE = 300; // کمتر از این برای basic ⇒ یک بار advanced
const MIN_TEXT = 30; // کمتر از این یعنی صفحه متنی ندارد (beginDeck هم همین را می‌خواهد)

export const linkEnabled = (env: Env) => !!(env.TAVILY_API_KEY ?? "").trim() && !/^(off|0|false|no)$/i.test((env.LINK_SOURCE ?? "").trim());

const dailyCap = (env: Env) => Math.max(1, Math.floor(Number(env.LINK_DAILY_LIMIT) || 10));
export const linkCapNote = (env: Env) => `هر کاربر روزی حداکثر ${dailyCap(env).toLocaleString("fa-IR")} لینک می‌تواند بخواند.`;

/** true = سقف امروز تمام است؛ وگرنه یک شمارش مصرف می‌شود (لینک ناموفق هم حساب می‌شود تا جلوی سوءاستفاده گرفته شود) */
export async function linkLimitHit(env: Env, userId: Uid): Promise<boolean> {
  const g = Math.floor(Number(env.LINK_GLOBAL_DAILY) || 0);
  if (g > 0 && (await hitLimit(env, `lnkg:${today()}`, g, 172_800))) return true;
  return hitLimit(env, `lnk:${userId}:${today()}`, dailyCap(env), 172_800);
}

// ---------- اعتبارسنجی آدرس ----------
const PRIVATE_HOST = /^(localhost|.*\.(local|localhost|internal|lan|home|corp|test|invalid|example))$/i;
const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;

/** آدرس را نرمال می‌کند؛ نامعتبر/محلی/IP/دارای رمز ⇒ null. «example.com/a» بدون http هم پذیرفته می‌شود. */
export function parseLinkUrl(raw: string): URL | null {
  let s = String(raw ?? "").replace(/[\u200b\u200c\u200e\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g, "").trim();
  if (!s || s.length > 2000 || /\s/.test(s)) return null;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) {
    if (!/^(www\.)?[^\s/:?#]+\.[^\s/:?#.]{2,}([/?#:].*)?$/i.test(s)) return null;
    s = "https://" + s;
  }
  let u: URL;
  try { u = new URL(s); } catch { return null; }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  if (u.username || u.password) return null;
  if (u.port && u.port !== "80" && u.port !== "443") return null;
  const h = u.hostname.toLowerCase();
  if (!h.includes(".") || h.startsWith("[") || IPV4.test(h) || PRIVATE_HOST.test(h)) return null;
  u.hash = "";
  return u;
}

/** اولین لینک داخل یک پیام متنی (برای ربات) + باقی متن بدون لینک (موضوع/تعداد اسلاید) */
export function findLinkInText(text: string): { url: string; rest: string } | null {
  const m = /(?:https?:\/\/|www\.)[^\s<>"'«»]+/i.exec(text);
  if (!m) return null;
  const url = m[0].replace(/[.,;:!?)\]}»،؛؟]+$/u, "");
  if (!parseLinkUrl(url)) return null;
  const rest = (text.slice(0, m.index) + " " + text.slice(m.index + m[0].length)).replace(/\s+/g, " ").trim();
  return { url, rest };
}

// ---------- خواندن صفحه با Tavily Extract ----------
export type LinkResult = { ok: true; text: string; title: string; host: string; truncated: boolean } | { ok: false; error: string };

type Pull = { text: string } | { error: string; fatal?: boolean };

async function extractOnce(env: Env, url: string, depth: "basic" | "advanced", timeoutMs: number): Promise<Pull> {
  let r: Response;
  try {
    r = await fetch("https://api.tavily.com/extract", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${env.TAVILY_API_KEY}` },
      body: JSON.stringify({ urls: [url], extract_depth: depth, format: "markdown", include_images: false }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    console.error("tavily extract", depth, e instanceof Error ? e.message : e);
    return { error: "خواندن لینک بیش از حد طول کشید؛ کمی بعد دوباره امتحان کن." };
  }
  if (!r.ok) {
    console.error("tavily extract status", depth, r.status);
    if (r.status === 429 || r.status === 432 || r.status === 433) return { error: "سرویس خواندن لینک الان شلوغ است؛ کمی بعد دوباره امتحان کن.", fatal: true };
    if (r.status === 401 || r.status === 403) return { error: "سرویس خواندن لینک موقتاً در دسترس نیست.", fatal: true };
    return { error: "خواندن این لینک ممکن نشد؛ آدرس را بررسی کن یا متن صفحه را کپی کن." };
  }
  const j = (await r.json().catch(() => null)) as any;
  const raw = j?.results?.[0]?.raw_content;
  if (typeof raw === "string" && raw.trim()) return { text: raw };
  return { error: "این صفحه قابل‌خواندن نبود (ممکن است نیاز به ورود داشته باشد یا بسته باشد)." };
}

/** پاک‌سازی مارک‌داون صفحه: حذف تصویر، تبدیل لینک به متن، حذف خط‌های فقط-آدرس و فشرده‌سازی فاصله‌ها */
function tidyPage(raw: string): string {
  return raw
    .replace(/\r\n?/g, "\n")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\((?:[^()]|\([^)]*\))*\)/g, "$1")
    .replace(/<\/?[a-z][^>]*>/gi, " ")
    .replace(/^\s*(?:https?:\/\/\S+\s*)+$/gim, "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, " ")
    .replace(/<<<DOCUMENT|DOCUMENT>>>/g, " ")
    .replace(/[ \t\u00A0]+/g, " ").replace(/ ?\n ?/g, "\n").replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** عنوان: اولین تیتر مارک‌داون، وگرنه اولین خط نسبتاً بلند، وگرنه نام سایت */
function titleOf(text: string, host: string): string {
  const strip = (s: string) => s.replace(/[#*_`>|]+/g, " ").replace(/\s+/g, " ").trim();
  const h = /^#{1,2}\s+(.+)$/m.exec(text);
  if (h && strip(h[1]).length >= 3) return strip(h[1]).slice(0, 120);
  for (const line of text.split("\n")) {
    const t = strip(line);
    if (t.length >= 8) return t.slice(0, 120);
  }
  return host;
}

/**
 * متن یک صفحه را می‌خواند. patient=true (وب): زمان بیشتر؛ ربات تلگرام زیر سقف ~۳۰ ثانیه‌ی waitUntil می‌ماند.
 * ابتدا basic (۱ اعتبار Tavily برای هر ۵ لینک)، فقط اگر خالی/خیلی کوتاه بود یک بار advanced.
 */
export async function fetchLinkSource(env: Env, href: string, patient = false): Promise<LinkResult> {
  if (!linkEnabled(env)) return { ok: false, error: "خواندن از روی لینک فعال نیست." };
  const u = parseLinkUrl(href);
  if (!u) return { ok: false, error: "آدرس لینک معتبر نیست؛ آدرس کامل صفحه را با http یا https بده." };
  const host = u.hostname.replace(/^www\./, "");

  let best = "";
  let lastErr = "";
  const first = await extractOnce(env, u.href, "basic", patient ? 20_000 : 12_000);
  if ("text" in first) best = tidyPage(first.text);
  else { lastErr = first.error; if (first.fatal) return { ok: false, error: first.error }; }

  if (best.length < MIN_USABLE) {
    const second = await extractOnce(env, u.href, "advanced", patient ? 30_000 : 14_000);
    if ("text" in second) {
      const t = tidyPage(second.text);
      if (t.length > best.length) best = t;
    } else if (!best) lastErr = lastErr || second.error;
  }

  if (best.length < MIN_TEXT) {
    return { ok: false, error: best ? "متن قابل‌استفاده‌ای در این صفحه پیدا نشد؛ متن را کپی کنید یا فایلش را بدهید." : lastErr || "متن قابل‌استفاده‌ای در این صفحه پیدا نشد." };
  }
  const truncated = best.length > MAX_LINK_CHARS;
  return { ok: true, text: best.slice(0, MAX_LINK_CHARS), title: titleOf(best, host), host, truncated };
}
