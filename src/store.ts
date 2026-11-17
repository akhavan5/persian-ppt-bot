/**
 * جایگزین KV بر پایه‌ی D1 (پلن رایگان: ۱۰۰ هزار نوشتن و ۵ میلیون خواندن در روز، در برابر ۱٬۰۰۰ نوشتن در KV).
 * API عمداً مثل KV است (get/put/delete/list با TTL) تا بقیه‌ی کد بدون تغییر کار کند.
 * تفاوت‌ها: همگام‌سازی فوری (سازگاری قوی)، و فقط مقدار متنی/JSON (فایل‌های باینری در KV واقعی می‌مانند، نگاه کنید به files.ts).
 */
import type { Env } from "./env";
import { BlobStore } from "./blobstore";

export interface PutOptions { expirationTtl?: number; expiration?: number }
export interface ListResult { keys: { name: string }[]; list_complete: boolean; cursor?: string }

const nowSec = () => Math.floor(Date.now() / 1000);

export class Store {
  private initP: Promise<unknown> | null = null;
  /** onFull: وقتی نوشتن به‌خاطر پر بودن دیتابیس شکست خورد، یک‌بار فایل‌های منقضی‌شده پاک می‌شوند تا جا باز شود */
  constructor(private db: D1Database, private onFull?: () => Promise<unknown>) {}

  // جدول در اولین استفاده ساخته می‌شود (بدون نیاز به migration دستی). WITHOUT ROWID = هر نوشتن فقط یک ردیف حساب می‌شود.
  private init(): Promise<unknown> {
    return (this.initP ??= this.db
      .exec("CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT NOT NULL, exp INTEGER) WITHOUT ROWID")
      .catch((e) => { this.initP = null; throw e; }));
  }

  /** برای دستورهای SQL اتمی مستقیم روی env.DB (مثل کسر اعتبار): مطمئن می‌شود جدول ساخته شده است. */
  ready(): Promise<unknown> { return this.init(); }

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
    const run = () => this.db
      .prepare("INSERT INTO kv (k, v, exp) VALUES (?1, ?2, ?3) ON CONFLICT(k) DO UPDATE SET v = excluded.v, exp = excluded.exp")
      .bind(key, String(value), exp)
      .run();
    try {
      await run();
    } catch (e) {
      // دیتابیس پر است: ردیف‌های منقضی‌شده‌ی kv و فایل‌ها را پاک کن و یک‌بار دوباره تلاش کن
      if (!/SQLITE_FULL|disk is full|exceeded.*(size|storage)|maximum.*(size|storage)|storage limit/i.test(String((e as any)?.message ?? e))) throw e;
      console.error("D1 full; purging expired rows then retrying", String(e).slice(0, 200));
      await this.purge().catch(() => {});
      await this.onFull?.().catch(() => {});
      await run();
    }
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
const blobCache = new WeakMap<object, BlobStore>();

/** دیتابیس‌های فایل به ترتیب نوشتن: اول DB2…DB10 (اگر تعریف شده باشند) و در آخر DB اصلی.
 *  دلیل: DB اصلی داده‌های حیاتی و کوچک (کاربران، اعتبار، نشست) را نگه می‌دارد و نباید با فایل‌های حجیم پر شود. */
function blobShards(env: Env): D1Database[] {
  const extra = [env.DB2, env.DB3, env.DB4, env.DB5, env.DB6, env.DB7, env.DB8, env.DB9, env.DB10].filter((d): d is D1Database => !!d);
  return [...extra, env.DB];
}

/**
 * env.KV را با نسخه‌ی D1 جایگزین می‌کند. env.FILES (بایت‌های فایل) هم به D1 می‌رود تا سهمیه‌ی ۱۰۰۰ نوشتن/حذف در روز و ۱ گیگابایتِ KV رایگان پر نشود.
 * فایل‌ها روی چند D1 پخش می‌شوند (blobShards)؛ وقتی یکی پر شد، به بعدی می‌روند.
 * KV واقعی با نام env.FILES_KV می‌ماند (فقط برای فایل‌های نمونه‌ی دائمی در samples.ts). چندبار صدا زدن بی‌خطر است.
 */
export function withStore(env: Env): Env {
  let b = blobCache.get(env.DB);
  if (!b) blobCache.set(env.DB, (b = new BlobStore(blobShards(env), env.FILES_KV ?? env.FILES)));
  let s = cache.get(env.DB);
  if (!s) { const blobs = b; cache.set(env.DB, (s = new Store(env.DB, () => blobs.purge()))); }
  if (env.FILES_KV) return { ...env, KV: s }; // قبلاً ساخته شده
  return { ...env, KV: s, FILES_KV: env.FILES, FILES: b as unknown as KVNamespace };
}

/** پاکسازی روزانه‌ی ردیف‌های منقضی‌شده‌ی KV و فایل‌ها در D1 */
export async function purgeExpired(env: Env): Promise<void> {
  const e = withStore(env);
  await e.KV.purge();
  await (e.FILES as unknown as BlobStore).purge();
}

/** پاکسازی فقط فایل‌های منقضی‌شده در همه‌ی دیتابیس‌های فایل (هر ساعت)؛ جدول kv دست‌نخورده می‌ماند */
export async function purgeBlobs(env: Env): Promise<void> {
  await (withStore(env).FILES as unknown as BlobStore).purge();
}
