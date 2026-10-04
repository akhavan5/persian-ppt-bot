/** چرخش بین چند حساب/کلید (وب و تلگرام) با همان متغیرهای قبلی.
 *  متغیر OPENAI_API_KEY در داشبورد کلودفلر می‌تواند یک «فهرست» باشد؛ هر خط یا هر بخشِ جداشده با «;» یک حساب:
 *      ACCOUNT_ID|API_TOKEN      ← حساب کلودفلر (آدرس از روی ID ساخته می‌شود؛ OPENAI_BASE_URL لازم نیست)
 *      API_KEY                   ← کلید ساده؛ با OPENAI_BASE_URL (مثل قبل)
 *      https://…/v1|API_KEY      ← کلید با آدرس اختصاصی
 *  (به‌جای «|» برای ACCOUNT_ID علامت «:» هم پذیرفته می‌شود؛ خط‌های شروع‌شده با # نادیده گرفته می‌شوند.)
 *  هر درخواست از آخرین حساب سالم شروع می‌کند و اگر ۴۲۹ (سقف نورون)/۴۰۱/۴۰۳ گرفت، یک دور کامل بین بقیه می‌چرخد؛
 *  هر حسابی که جواب سالم داد به‌عنوان «آخرین حساب سالم» در KV (کلید llm:cur) ثبت می‌شود. حساب‌ها هیچ‌وقت کنار گذاشته (بلاک) نمی‌شوند. */
import type { Env } from "./env";

export interface Account {
  id: string;
  label: string;
  token: string;
  /** آدرس سازگار با OpenAI: …/ai/v1 */
  base: string;
  /** آدرس اجرای مدل: …/ai/run */
  runBase: string;
  /** آیا آدرس از نوع کلودفلر است (برای تصویر: مسیر /run) */
  cf: boolean;
}

export class PoolExhausted extends Error {}

const CUR_KEY = "llm:cur";
const HEX32 = /^[0-9a-f]{32}$/i;

export function parseAccounts(env: Env): Account[] {
  const raw = (env.OPENAI_API_KEY ?? "").trim();
  if (!raw) return [];
  const defBase = (env.OPENAI_BASE_URL || "https://api.gapgpt.app/v1").replace(/\/+$/, "");
  const override = (env.OPENAI_IMAGE_BASE_URL || "").trim().replace(/\/+$/, "");
  const make = (base: string, token: string, id: string): Account => {
    base = base.replace(/\/+$/, "");
    const cf = !!override || /api\.cloudflare\.com\/client\/v4\/accounts\/[^/]+\/ai\/v1$/.test(base);
    return { id, label: id.slice(0, 6) + "…", token, base, runBase: override || base.replace(/\/v1$/, "/run"), cf };
  };
  const out: Account[] = [];
  const add = (a: Account) => { if (a.token && !out.some((x) => x.id === a.id)) out.push(a); };
  const cfAcc = (id: string, token: string) => make(`https://api.cloudflare.com/client/v4/accounts/${id}/ai/v1`, token, id);

  for (const part of raw.split(/[\n;]+/)) {
    const t = part.trim();
    if (!t || t.startsWith("#")) continue;
    const bar = t.indexOf("|");
    if (bar > 0) {
      const a = t.slice(0, bar).trim(), b = t.slice(bar + 1).trim();
      if (/^https?:\/\//i.test(a)) add(make(a, b, `${a}#${b.slice(-6)}`));
      else if (HEX32.test(a)) add(cfAcc(a, b));
      else if (HEX32.test(b)) add(cfAcc(b, a)); // اگر ترتیب برعکس نوشته شده بود
      else add(make(defBase, t, t.slice(-8)));
      continue;
    }
    const m = t.match(/^([0-9a-f]{32})\s*:\s*(.+)$/i);
    if (m) add(cfAcc(m[1], m[2].trim()));
    else add(make(defBase, t, t.slice(-8)));
  }
  return out.slice(0, 20);
}

/** fn را با آخرین حساب سالم اجرا می‌کند؛ اگر پاسخ ۴۲۹ (سقف نورون)/۴۰۱/۴۰۳ بود به حساب بعدی می‌رود.
 *  اولین پاسخ غیرقابل‌چرخش (موفق یا خطای دیگر) برگردانده می‌شود. اگر یک دور کامل هیچ حسابی سالم نبود PoolExhausted پرتاب می‌شود.
 *  با یک حساب/کلید، دقیقاً مثل قبل فقط همان یک درخواست انجام می‌شود. */
export async function fetchWithAccounts(env: Env, fn: (a: Account) => Promise<Response>): Promise<Response> {
  const pool = parseAccounts(env);
  if (!pool.length) throw new PoolExhausted("هیچ حساب API تنظیم نشده است");
  if (pool.length === 1) return fn(pool[0]);

  const cur = await env.KV.get(CUR_KEY).catch(() => null);
  const start = Math.max(0, pool.findIndex((a) => a.id === cur));
  const order = pool.map((_, i) => pool[(start + i) % pool.length]);

  const errs: string[] = [];
  let lastBody = "";
  for (const a of order) {
    const r = await fn(a); // خطای شبکه/تایم‌اوت چرخش نمی‌دهد (مشکل از حساب نیست)
    if (r.status !== 429 && r.status !== 401 && r.status !== 403) {
      if (r.ok && a.id !== cur) await env.KV.put(CUR_KEY, a.id).catch(() => {});
      return r;
    }
    lastBody = (await r.text()).slice(0, 300);
    console.error("ai account skipped", a.label, r.status, lastBody.slice(0, 120));
    errs.push(`${a.label}:${r.status}`);
  }
  throw new PoolExhausted(`هیچ حسابی پاسخ سالم نداد (${errs.join(", ")}) ${lastBody}`);
}
