/**
 * جایگزین KV واقعی برای «بایت‌های فایل» بر پایه‌ی D1.
 * چرا: KV رایگان فقط ۱٬۰۰۰ نوشتن/حذف در روز و ۱ گیگابایت فضا دارد؛ D1 رایگان ۱۰۰ هزار نوشتن در روز و ۵ گیگابایت.
 * فایل‌ها به تکه‌های ۵۱۲ کیلوبایتی شکسته می‌شوند (سقف هر ردیف D1 دو مگابایت است).
 * API عمداً مثل KV است (put/get/getWithMetadata/delete با TTL) تا بقیه‌ی کد بدون تغییر کار کند.
 * چنددیتابیسی: فایل‌ها روی چند D1 پخش می‌شوند (DB2…DB10 و در آخر DB اصلی). وقتی یکی پر شد (خطای SQLITE_FULL / سقف ۵۰۰ مگابایت)، همان نوشتن روی بعدی انجام می‌شود و دیتابیس پر برای ۱۰ دقیقه کنار گذاشته می‌شود. خواندن به ترتیب همه‌ی دیتابیس‌ها را می‌گردد.
 * نوشتن: اول ردیف متادیتای «موقت» (انقضای ۱۵ دقیقه) درج می‌شود، بعد تکه‌ها، و در پایان انقضای واقعی جایگزین می‌شود؛ خواننده فایل نیمه‌کاره نمی‌بیند (شمارش تکه‌ها با n نمی‌خواند) و اگر Worker وسط نوشتن بمیرد purge تکه‌ها را هم با ردیف موقت پاک می‌کند (تکه‌ی یتیم نمی‌ماند).
 * خواندن: متادیتا هم‌زمان از همه‌ی دیتابیس‌ها پرسیده می‌شود. فایل‌های موقت پس از پایان کار با deletePrefix پاک می‌شوند و purge هر ساعت اجرا می‌شود.
 */
const CHUNK = 512 * 1024;
// D1 ستون BLOB را به‌صورت آرایه‌ی عدد (JSON) برمی‌گرداند و پارس آن CPU زیادی می‌خورد (۲۰ مگابایت صدا ≈ ۷۰ مگابایت JSON). متن base64 رشته‌ی ساده است و با Buffer بومی در چند میلی‌ثانیه رمزگشایی می‌شود.
const toB64 = (u: Uint8Array) => Buffer.from(u.buffer, u.byteOffset, u.byteLength).toString("base64");
const fromB64 = (s: string) => new Uint8Array(Buffer.from(s, "base64"));
const PER_BATCH = 4; // حداکثر ~۲ مگابایت در هر batch
const nowSec = () => Math.floor(Date.now() / 1000);

interface PutOpts { expirationTtl?: number; expiration?: number; metadata?: unknown }

// تشخیص «دیتابیس پر شده» از پیام خطای D1
const isFullErr = (e: unknown) => /SQLITE_FULL|database or disk is full|disk is full|exceeded.*(size|storage)|maximum.*(size|storage)|storage limit/i.test(String((e as any)?.message ?? e));
// دیتابیس‌هایی که اخیراً پر بوده‌اند (مشترک بین درخواست‌های همین isolate)
const blockedUntil = new WeakMap<D1Database, number>();
const isBlocked = (d: D1Database) => (blockedUntil.get(d) ?? 0) > Date.now();
const BLOCK_MS = 10 * 60 * 1000;
// انقضای موقتِ فایلی که هنوز در حال نوشتن است (ثانیه)
const PENDING_TTL = 15 * 60;
// ساخت جدول‌ها برای هر دیتابیس فقط یک بار
const initCache = new WeakMap<D1Database, Promise<unknown>>();

function initDb(db: D1Database): Promise<unknown> {
  let p = initCache.get(db);
  if (!p) {
    p = db
      .batch([
        db.prepare("CREATE TABLE IF NOT EXISTS blob_meta (k TEXT PRIMARY KEY, n INTEGER NOT NULL, size INTEGER NOT NULL, meta TEXT, exp INTEGER) WITHOUT ROWID"),
        db.prepare("CREATE TABLE IF NOT EXISTS blob_chunk (k TEXT NOT NULL, i INTEGER NOT NULL, d BLOB NOT NULL, PRIMARY KEY (k, i)) WITHOUT ROWID"),
        db.prepare("CREATE TABLE IF NOT EXISTS blob_chunk64 (k TEXT NOT NULL, i INTEGER NOT NULL, d TEXT NOT NULL, PRIMARY KEY (k, i)) WITHOUT ROWID"),
        db.prepare("CREATE INDEX IF NOT EXISTS blob_meta_exp ON blob_meta (exp)"),
      ])
      .catch((e) => { initCache.delete(db); throw e; });
    initCache.set(db, p);
  }
  return p;
}

export class BlobStore {
  /** dbs: به ترتیب اولویت نوشتن (اولی اول پر می‌شود)؛ legacy: KV واقعی فقط برای فایل‌های پیش از مهاجرت */
  constructor(private dbs: D1Database[], private legacy?: KVNamespace) {}

  async put(key: string, value: ArrayBuffer | Uint8Array | string, o: PutOpts = {}): Promise<void> {
    const bytes = typeof value === "string" ? new TextEncoder().encode(value)
      : value instanceof Uint8Array ? value : new Uint8Array(value);
    const exp = o.expiration ?? (o.expirationTtl ? nowSec() + Math.floor(o.expirationTtl) : null);
    // اول دیتابیس‌های غیرپر؛ دیتابیس‌های «اخیراً پر» آخرین چاره‌اند (شاید cron جا باز کرده باشد)
    const order = [...this.dbs.filter((d) => !isBlocked(d)), ...this.dbs.filter(isBlocked)];
    let lastErr: unknown = new Error("no D1 database for blobs");
    for (const db of order) {
      try {
        await this.putOne(db, key, bytes, exp, o.metadata);
        return;
      } catch (e) {
        lastErr = e;
        if (isFullErr(e)) blockedUntil.set(db, Date.now() + BLOCK_MS);
        console.error("blob put failed on a shard", String(e).slice(0, 200));
        await this.cleanupOne(db, key).catch(() => {}); // تکه‌های نیمه‌کاره نماند
      }
    }
    throw lastErr;
  }

  private async putOne(db: D1Database, key: string, bytes: Uint8Array, exp: number | null, metadata: unknown): Promise<void> {
    await initDb(db);
    const n = Math.max(1, Math.ceil(bytes.byteLength / CHUNK));
    const metaJson = metadata === undefined ? null : JSON.stringify(metadata);
    // نسخه‌ی قبلی (اگر هست) اول پاک می‌شود و بلافاصله «ردیف موقت» درج می‌شود؛ ردیف موقت انقضای کوتاه (۱۵ دقیقه) دارد.
    // اگر Worker وسط نوشتن بمیرد (سقف CPU/زمان)، purge ردیف موقت و تکه‌های نیمه‌کاره‌اش را با هم پاک می‌کند؛ پس تکه‌ی یتیم (بی‌متادیتا) هرگز در دیتابیس نمی‌ماند.
    // خواننده هم فایل نیمه‌کاره نمی‌بیند: تا همه‌ی n تکه ننوشته شده، شمارش تکه‌ها با n نمی‌خواند و خواندن «ناموجود» برمی‌گردد.
    await db.batch([
      db.prepare("DELETE FROM blob_meta WHERE k = ?1").bind(key),
      db.prepare("DELETE FROM blob_chunk WHERE k = ?1").bind(key),
      db.prepare("DELETE FROM blob_chunk64 WHERE k = ?1").bind(key),
      db.prepare("INSERT INTO blob_meta (k, n, size, meta, exp) VALUES (?1, ?2, ?3, ?4, ?5)").bind(key, n, bytes.byteLength, metaJson, nowSec() + PENDING_TTL),
    ]);
    let stmts: D1PreparedStatement[] = [];
    for (let i = 0; i < n; i++) {
      const part = bytes.subarray(i * CHUNK, (i + 1) * CHUNK);
      stmts.push(db.prepare("INSERT INTO blob_chunk64 (k, i, d) VALUES (?1, ?2, ?3)").bind(key, i, toB64(part)));
      if (stmts.length === PER_BATCH) { await db.batch(stmts); stmts = []; }
    }
    if (stmts.length) await db.batch(stmts);
    // همه‌ی تکه‌ها نوشته شد: انقضای واقعی (یا بی‌انقضا) جایگزین انقضای موقت می‌شود
    await db.prepare("UPDATE blob_meta SET exp = ?2 WHERE k = ?1").bind(key, exp).run();
  }

  private cleanupOne(db: D1Database, key: string): Promise<unknown> {
    return db.batch([
      db.prepare("DELETE FROM blob_chunk WHERE k = ?1").bind(key),
      db.prepare("DELETE FROM blob_chunk64 WHERE k = ?1").bind(key),
      db.prepare("DELETE FROM blob_meta WHERE k = ?1").bind(key),
    ]);
  }

  /** متادیتای فایل در یک دیتابیس (null = نیست یا منقضی شده) */
  private async metaOne(db: D1Database, key: string): Promise<{ n: number; size: number; meta: string | null } | null> {
    await initDb(db);
    const m = await db.prepare("SELECT n, size, meta, exp FROM blob_meta WHERE k = ?1").bind(key)
      .first<{ n: number; size: number; meta: string | null; exp: number | null }>();
    if (!m || (m.exp !== null && m.exp <= nowSec())) return null;
    return m;
  }

  private async readOne(db: D1Database, key: string, m: { n: number; size: number; meta: string | null }): Promise<{ data: ArrayBuffer; meta: unknown } | null> {
    const out = new Uint8Array(m.size);
    let off = 0;
    const r64 = (await db.prepare("SELECT d FROM blob_chunk64 WHERE k = ?1 ORDER BY i").bind(key).all<{ d: string }>()).results;
    if (r64.length) {
      if (r64.length !== m.n) return null; // وسط نوشتن/حذف همزمان؛ مثل فایل ناموجود
      for (const r of r64) { const c = fromB64(r.d); out.set(c, off); off += c.byteLength; }
    } else {
      // فایل‌های قدیمی (پیش از این تغییر) در جدول BLOB هستند؛ تا انقضای ۲۴ ساعته خوانده می‌شوند
      const { results } = await db.prepare("SELECT d FROM blob_chunk WHERE k = ?1 ORDER BY i").bind(key).all<{ d: ArrayBuffer | number[] }>();
      if (results.length !== m.n) return null;
      for (const r of results) {
        const c = r.d instanceof ArrayBuffer ? new Uint8Array(r.d) : Uint8Array.from(r.d as number[]);
        out.set(c, off); off += c.byteLength;
      }
    }
    return { data: out.buffer, meta: m.meta ? JSON.parse(m.meta) : null };
  }

  /** متادیتا را هم‌زمان از همه‌ی دیتابیس‌ها می‌پرسد (یک رفت‌وبرگشت، نه یکی‌یکی)؛ بعد فقط تکه‌ها را از دیتابیسی که فایل دارد می‌خواند.
   *  با ۶ دیتابیس، فایلی که در آخری است دیگر ۵ پرس‌وجوی پشت‌سرهم‌ی بی‌نتیجه نمی‌خورد. */
  private async read(key: string): Promise<{ data: ArrayBuffer; meta: unknown } | null> {
    const found = await Promise.all(this.dbs.map(async (db) => {
      try { return { db, m: await this.metaOne(db, key) }; }
      catch (e) { console.error("blob meta failed on a shard", String(e).slice(0, 200)); return { db, m: null }; } // یک دیتابیس خراب بقیه را از کار نیندازد
    }));
    for (const { db, m } of found) {
      if (!m) continue;
      try {
        const r = await this.readOne(db, key, m);
        if (r) return r;
      } catch (e) {
        console.error("blob read failed on a shard", String(e).slice(0, 200));
      }
    }
    return null;
  }

  async get(key: string, type: "text" | "arrayBuffer" = "text"): Promise<any> {
    const r = await this.read(key);
    if (!r) return this.legacy ? this.legacy.get(key, type as any) : null;
    return type === "arrayBuffer" ? r.data : new TextDecoder().decode(r.data);
  }

  async getWithMetadata<M = unknown>(key: string, type: "text" | "arrayBuffer" = "text"): Promise<{ value: any; metadata: M | null }> {
    const r = await this.read(key);
    if (!r) return this.legacy ? this.legacy.getWithMetadata<M>(key, type as any) as any : { value: null, metadata: null };
    return { value: type === "arrayBuffer" ? r.data : new TextDecoder().decode(r.data), metadata: r.meta as M };
  }

  /** از همه‌ی دیتابیس‌ها پاک می‌شود (فایل ممکن است در هرکدام باشد) */
  async delete(key: string): Promise<void> {
    const rs = await Promise.allSettled(this.dbs.map(async (db) => { await initDb(db); await this.cleanupOne(db, key); }));
    if (rs.length && rs.every((r) => r.status === "rejected")) throw (rs[0] as PromiseRejectedResult).reason;
  }

  /** همه‌ی کلیدهایی که با prefix شروع می‌شوند را با یک batch در هر دیتابیس (هم‌زمان) پاک می‌کند؛ برای فایل‌های موقت صدا (tmp:aud:<شناسه>:…) که پس از پایان کار دیگر لازم نیستند.
   *  بازه‌ی k >= prefix و k < prefix+U+10FFFF از ایندکس کلید اصلی استفاده می‌کند (LIKE نمی‌کند). */
  async deletePrefix(prefix: string): Promise<void> {
    const hi = prefix + "\u{10FFFF}";
    const rs = await Promise.allSettled(this.dbs.map(async (db) => {
      await initDb(db);
      await db.batch([
        db.prepare("DELETE FROM blob_chunk64 WHERE k >= ?1 AND k < ?2").bind(prefix, hi),
        db.prepare("DELETE FROM blob_chunk WHERE k >= ?1 AND k < ?2").bind(prefix, hi),
        db.prepare("DELETE FROM blob_meta WHERE k >= ?1 AND k < ?2").bind(prefix, hi),
      ]);
    }));
    if (rs.length && rs.every((r) => r.status === "rejected")) throw (rs[0] as PromiseRejectedResult).reason;
  }

  /** حذف فایل‌های منقضی‌شده از همه‌ی دیتابیس‌ها (روزی یک بار از cron؛ و هنگام پر بودن دیتابیس اصلی) */
  async purge(): Promise<number> {
    const now = nowSec();
    let total = 0;
    for (const db of this.dbs) {
      try {
        await initDb(db);
        await db.prepare("DELETE FROM blob_chunk WHERE k IN (SELECT k FROM blob_meta WHERE exp IS NOT NULL AND exp <= ?1)").bind(now).run();
        await db.prepare("DELETE FROM blob_chunk64 WHERE k IN (SELECT k FROM blob_meta WHERE exp IS NOT NULL AND exp <= ?1)").bind(now).run();
        const r = await db.prepare("DELETE FROM blob_meta WHERE exp IS NOT NULL AND exp <= ?1").bind(now).run();
        total += r.meta?.changes ?? 0;
        blockedUntil.delete(db); // جا باز شد؛ دوباره قابل‌استفاده است
      } catch (e) {
        console.error("blob purge failed on a shard", String(e).slice(0, 200));
      }
    }
    return total;
  }
}
