/** آمار عمومی صفحه‌ی اصلی (GET /api/public-stats): کل کاربران، ارائه‌ها و پلن‌های فروخته‌شده.
 *
 *  - فقط عدد برمی‌گرداند؛ هیچ اطلاعات شخصی‌ای در آن نیست.
 *  - کل‌ها چند شمارش روی جدول kv است، پس نتیجه ۲۴ ساعت در KV (pub:stats) و در لبه‌ی کلودفلر کش می‌شود (روزی یک بار محاسبه).
 *  - کاربران: seen:* (ربات‌ها) + wu:* با ایمیل/موبایل/گوگل (وب، اپ، PWA) بدون حساب‌های وصل‌به‌تلگرام. ارائه‌ها: مجموع act:<حساب>.n. پلن‌ها: مجموع rv:<روز>.n.
 */
import type { Env } from "./env";

const MAXC = "\u{10FFFF}";
const CACHE_KEY = "pub:stats";
export const PUBLIC_STATS_TTL = 24 * 3600;

export interface PublicStats {
  users: number; decks: number; plans: number;
  /** زمان محاسبه (ms) */
  t: number;
}

async function num(env: Env, sql: string, ...binds: unknown[]): Promise<number> {
  await env.KV.ready();
  const r = await env.DB.prepare(sql).bind(...binds).first<{ c: number | null }>();
  return Math.max(0, Math.floor(Number(r?.c ?? 0)));
}

async function compute(env: Env): Promise<PublicStats> {
  const now = Math.floor(Date.now() / 1000);
  const sumN = (from: string, to: string) => num(env, "SELECT SUM(COALESCE(json_extract(v,'$.n'),0)) c FROM kv WHERE k >= ?1 AND k < ?2", from, to);
  const [seen, web, decks, plans] = await Promise.all([
    num(env, "SELECT COUNT(*) c FROM kv WHERE k >= ?1 AND k < ?2", "seen:", "seen:" + MAXC),
    num(env,
      "SELECT COUNT(*) c FROM kv WHERE k >= ?1 AND k < ?2 AND (exp IS NULL OR exp > ?3) " +
      "AND (COALESCE(json_extract(v,'$.email'),'') != '' OR COALESCE(json_extract(v,'$.mobile'),'') != '' OR json_extract(v,'$.google') IS NOT NULL) " +
      "AND NOT EXISTS (SELECT 1 FROM kv t WHERE t.k = 'w2tg:' || substr(kv.k, 4))",
      "wu:", "wu:" + MAXC, now),
    sumN("act:", "act:" + MAXC),
    sumN("rv:", "rv:" + MAXC),
  ]);
  return { users: seen + web, decks, plans, t: Date.now() };
}

let mem: { at: number; v: PublicStats } | null = null;

export async function getPublicStats(env: Env): Promise<PublicStats> {
  if (mem && Date.now() - mem.at < 3_600_000) return mem.v; // یک ساعت در حافظه‌ی Worker: بیشتر درخواست‌ها هیچ خواندنی ندارند
  const v = await getPublicStatsKv(env);
  mem = { at: Date.now(), v };
  return v;
}

async function getPublicStatsKv(env: Env): Promise<PublicStats> {
  const cached = (await env.KV.get(CACHE_KEY, "json").catch(() => null)) as PublicStats | null;
  if (cached && Number.isFinite(cached.t)) return cached;
  const s = await compute(env);
  await env.KV.put(CACHE_KEY, JSON.stringify(s), { expirationTtl: PUBLIC_STATS_TTL }).catch(() => {});
  return s;
}
