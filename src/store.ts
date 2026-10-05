/**
 * جایگزین KV بر پایه‌ی D1 (پلن رایگان: ۱۰۰ هزار نوشتن و ۵ میلیون خواندن در روز، در برابر ۱٬۰۰۰ نوشتن در KV).
 * API عمداً مثل KV است (get/put/delete/list با TTL) تا بقیه‌ی کد بدون تغییر کار کند.
 * تفاوت‌ها: همگام‌سازی فوری (سازگاری قوی)، و فقط مقدار متنی/JSON (فایل‌های باینری در KV واقعی می‌مانند، نگاه کنید به files.ts).
 */
import type { Env } from "./env";

export interface PutOptions { expirationTtl?: number; expiration?: number }
export interface ListResult { keys: { name: string }[]; list_complete: boolean; cursor?: string }

const nowSec = () => Math.floor(Date.now() / 1000);

export class Store {
  private ready: Promise<unknown> | null = null;
  constructor(private db: D1Database) {}

  // جدول در اولین استفاده ساخته می‌شود (بدون نیاز به migration دستی). WITHOUT ROWID = هر نوشتن فقط یک ردیف حساب می‌شود.
  private init(): Promise<unknown> {
    return (this.ready ??= this.db
      .exec("CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT NOT NULL, exp INTEGER) WITHOUT ROWID")
      .catch((e) => { this.ready = null; throw e; }));
  }

  async get(key: string, type: "text" | "json" = "text"): Promise<any> {
    await this.init();
    const r = await this.db.prepare("SELECT v, exp FROM kv WHERE k = ?1").bind(key).first<{ v: string; exp: number | null }>();
    if (!r || (r.exp !== null && r.exp <= nowSec())) return null; // منقضی‌شده؛ پاکسازی واقعی با cron انجام می‌شود
    if (type === "json") {
      try { return JSON.parse(r.v); } catch { return null; }
    }
    return r.v;
  }

  async put(key: string, value: string, o: PutOptions = {}): Promise<void> {
    await this.init();
    const exp = o.expiration ?? (o.expirationTtl ? nowSec() + Math.floor(o.expirationTtl) : null);
    await this.db
      .prepare("INSERT INTO kv (k, v, exp) VALUES (?1, ?2, ?3) ON CONFLICT(k) DO UPDATE SET v = excluded.v, exp = excluded.exp")
      .bind(key, String(value), exp)
      .run();
  }

  async delete(key: string): Promise<void> {
    await this.init();
    await this.db.prepare("DELETE FROM kv WHERE k = ?1").bind(key).run();
  }

  async list(o: { prefix?: string; cursor?: string; limit?: number } = {}): Promise<ListResult> {
    await this.init();
    const limit = Math.min(Math.max(o.limit ?? 1000, 1), 1000);
    const prefix = o.prefix ?? "";
    const { results } = await this.db
      .prepare("SELECT k FROM kv WHERE k >= ?1 AND k < ?2 AND k > ?3 AND (exp IS NULL OR exp > ?4) ORDER BY k LIMIT ?5")
      .bind(prefix, prefix + "\u{10FFFF}", o.cursor ?? "", nowSec(), limit + 1)
      .all<{ k: string }>();
    const keys = results.slice(0, limit).map((r) => ({ name: r.k }));
    const complete = results.length <= limit;
    return { keys, list_complete: complete, cursor: complete ? undefined : keys[keys.length - 1]?.name };
  }

  /** حذف ردیف‌های منقضی‌شده (روزی یک بار از cron). */
  async purge(): Promise<number> {
    await this.init();
    const r = await this.db.prepare("DELETE FROM kv WHERE exp IS NOT NULL AND exp <= ?1").bind(nowSec()).run();
    return r.meta?.changes ?? 0;
  }
}

const cache = new WeakMap<object, Store>();

/** env.KV را با نسخه‌ی D1 جایگزین می‌کند؛ KV واقعی با نام env.FILES در دسترس می‌ماند. چندبار صدا زدن بی‌خطر است. */
export function withStore(env: Env): Env {
  let s = cache.get(env.DB);
  if (!s) cache.set(env.DB, (s = new Store(env.DB)));
  return { ...env, KV: s };
}
