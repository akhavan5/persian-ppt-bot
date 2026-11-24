/**
 * Tavily با چند کلید و چرخش خودکار (جستجو در research.ts و خواندن لینک در link-source.ts).
 *
 * متغیر TAVILY_API_KEY در داشبورد کلودفلر می‌تواند یک یا چند کلید باشد (جداشده با خط جدید / «;» / «,» / فاصله؛ خط‌های شروع‌شده با # نادیده گرفته می‌شوند).
 * ترتیب: کلیدها به‌ترتیب فهرست استفاده می‌شوند (تا وقتی کلید اول سالم است همان)؛ وقتی سهمیه‌ی یک کلید پر شد (۴۳۲/۴۳۳)، محدودیت نرخ خورد (۴۲۹)
 * یا کلید نامعتبر بود (۴۰۱/۴۰۳)، همان درخواست با کلید بعدی تکرار می‌شود و کلیدِ ناموفق برای مدتی «کولدان» می‌شود تا درخواست‌های بعدی وقت را روی آن هدر ندهند.
 * کلیدهای کولدان آخرین فرصت‌اند (اگر همه کولدان باشند باز امتحان می‌شوند، چون ممکن است سهمیه‌شان تمدید شده باشد).
 * خطای شبکه/زمان‌بر شدن بالا می‌رود (کلید بعدی هم همان‌قدر طول می‌کشد).
 */
import type { Env } from "./env";

const CD_PREFIX = "tavcd:";
const MAX_KEYS = 20;
/** وضعیت‌هایی که یعنی «این کلید کار نمی‌کند»؛ با کلید بعدی تکرار می‌شود */
const FAILOVER = new Set([401, 403, 429, 432, 433]);

/** کولدان به ثانیه: ۴۲۹ فقط یک دقیقه؛ پر شدن سهمیه (۴۳۲/۴۳۳) ۶ ساعت؛ کلید نامعتبر یک ساعت (حداقل TTL در KV ۶۰ ثانیه است) */
const cooldownFor = (status: number) => (status === 429 ? 60 : status === 432 || status === 433 ? 6 * 3600 : 3600);

export function tavilyKeys(env: Env): string[] {
  const raw = String(env.TAVILY_API_KEY ?? "").replace(/#[^\n]*/g, " ");
  const out: string[] = [];
  for (const k of raw.split(/[\s;,]+/)) if (k && !out.includes(k)) out.push(k);
  return out.slice(0, MAX_KEYS);
}
export const tavilyEnabled = (env: Env): boolean => tavilyKeys(env).length > 0;

async function fingerprint(key: string): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key)));
  return [...d.subarray(0, 6)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * درخواست POST به https://api.tavily.com/<path> با کلید چرخشی. Response آخرین تلاش را برمی‌گرداند
 * (اگر همه‌ی کلیدها خراب بودند همان خطای آخر: ۴۲۹/۴۳۲/۴۳۳/۴۰۱/۴۰۳ تا فراخوان مثل قبل مدیریتش کند).
 */
export async function tavilyFetch(env: Env, path: "search" | "extract", payload: unknown, timeoutMs: number): Promise<Response> {
  const keys = tavilyKeys(env);
  if (!keys.length) throw new Error("tavily: کلیدی تنظیم نشده است");
  const prints = await Promise.all(keys.map(fingerprint));
  const cooled = await Promise.all(prints.map(async (p) => (await env.KV.get(CD_PREFIX + p).catch(() => null)) !== null));
  const idx = keys.map((_, i) => i);
  const order = [...idx.filter((i) => !cooled[i]), ...idx.filter((i) => cooled[i])]; // کولدان‌ها آخرین فرصت
  const body = JSON.stringify(payload);

  let last: Response | null = null;
  for (const i of order) {
    const r = await fetch(`https://api.tavily.com/${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${keys[i]}` },
      body,
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!FAILOVER.has(r.status)) {
      if (cooled[i] && r.ok) await env.KV.delete(CD_PREFIX + prints[i]).catch(() => {}); // دوباره سالم شد
      return r;
    }
    console.error("tavily key skipped", path, `#${i + 1}/${keys.length}`, r.status);
    await env.KV.put(CD_PREFIX + prints[i], String(r.status), { expirationTtl: cooldownFor(r.status) }).catch(() => {});
    if (last) await last.body?.cancel().catch(() => {});
    last = r;
  }
  return last as Response;
}
