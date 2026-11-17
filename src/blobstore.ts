/**
 * جایگزین KV واقعی برای «بایت‌های فایل» بر پایه‌ی D1.
 * چرا: KV رایگان فقط ۱٬۰۰۰ نوشتن/حذف در روز و ۱ گیگابایت فضا دارد؛ D1 رایگان ۱۰۰ هزار نوشتن در روز و ۵ گیگابایت.
 * فایل‌ها به تکه‌های ۵۱۲ کیلوبایتی شکسته می‌شوند (سقف هر ردیف D1 دو مگابایت است).
 * API عمداً مثل KV است (put/get/getWithMetadata/delete با TTL) تا بقیه‌ی کد بدون تغییر کار کند.
 * اول متادیتا خوانده می‌شود و فقط وقتی همه‌ی تکه‌ها نوشته شد متادیتا درج می‌شود؛ پس خواننده هرگز فایل نیمه‌کاره نمی‌بیند.
 */
const CHUNK = 512 * 1024;
// D1 ستون BLOB را به‌صورت آرایه‌ی عدد (JSON) برمی‌گرداند و پارس آن CPU زیادی می‌خورد (۲۰ مگابایت صدا ≈ ۷۰ مگابایت JSON). متن base64 رشته‌ی ساده است و با Buffer بومی در چند میلی‌ثانیه رمزگشایی می‌شود.
const toB64 = (u: Uint8Array) => Buffer.from(u.buffer, u.byteOffset, u.byteLength).toString("base64");
const fromB64 = (s: string) => new Uint8Array(Buffer.from(s, "base64"));
const PER_BATCH = 4; // حداکثر ~۲ مگابایت در هر batch
const nowSec = () => Math.floor(Date.now() / 1000);

interface PutOpts { expirationTtl?: number; expiration?: number; metadata?: unknown }

export class BlobStore {
  private initP: Promise<unknown> | null = null;
  /** KV واقعی: فقط برای خواندن فایل‌هایی که پیش از مهاجرت در آن ساخته شده‌اند (تا ۲۴ ساعت بعد از دیپلوی) */
  constructor(private db: D1Database, private legacy?: KVNamespace) {}

  private init(): Promise<unknown> {
    return (this.initP ??= this.db
      .batch([
        this.db.prepare("CREATE TABLE IF NOT EXISTS blob_meta (k TEXT PRIMARY KEY, n INTEGER NOT NULL, size INTEGER NOT NULL, meta TEXT, exp INTEGER) WITHOUT ROWID"),
        this.db.prepare("CREATE TABLE IF NOT EXISTS blob_chunk (k TEXT NOT NULL, i INTEGER NOT NULL, d BLOB NOT NULL, PRIMARY KEY (k, i)) WITHOUT ROWID"),
        this.db.prepare("CREATE TABLE IF NOT EXISTS blob_chunk64 (k TEXT NOT NULL, i INTEGER NOT NULL, d TEXT NOT NULL, PRIMARY KEY (k, i)) WITHOUT ROWID"),
        this.db.prepare("CREATE INDEX IF NOT EXISTS blob_meta_exp ON blob_meta (exp)"),
      ])
      .catch((e) => { this.initP = null; throw e; }));
  }

  async put(key: string, value: ArrayBuffer | Uint8Array | string, o: PutOpts = {}): Promise<void> {
    await this.init();
    const bytes = typeof value === "string" ? new TextEncoder().encode(value)
      : value instanceof Uint8Array ? value : new Uint8Array(value);
    const exp = o.expiration ?? (o.expirationTtl ? nowSec() + Math.floor(o.expirationTtl) : null);
    // نسخه‌ی قبلی (اگر هست) اول پاک می‌شود تا تکه‌ی اضافه نماند
    await this.db.batch([
      this.db.prepare("DELETE FROM blob_meta WHERE k = ?1").bind(key),
      this.db.prepare("DELETE FROM blob_chunk WHERE k = ?1").bind(key),
      this.db.prepare("DELETE FROM blob_chunk64 WHERE k = ?1").bind(key),
    ]);
    const n = Math.max(1, Math.ceil(bytes.byteLength / CHUNK));
    let stmts: D1PreparedStatement[] = [];
    for (let i = 0; i < n; i++) {
      const part = bytes.subarray(i * CHUNK, (i + 1) * CHUNK);
      stmts.push(this.db.prepare("INSERT INTO blob_chunk64 (k, i, d) VALUES (?1, ?2, ?3)").bind(key, i, toB64(part)));
      if (stmts.length === PER_BATCH) { await this.db.batch(stmts); stmts = []; }
    }
    if (stmts.length) await this.db.batch(stmts);
    await this.db
      .prepare("INSERT INTO blob_meta (k, n, size, meta, exp) VALUES (?1, ?2, ?3, ?4, ?5)")
      .bind(key, n, bytes.byteLength, o.metadata === undefined ? null : JSON.stringify(o.metadata), exp)
      .run();
  }

  private async read(key: string): Promise<{ data: ArrayBuffer; meta: unknown } | null> {
    await this.init();
    const m = await this.db.prepare("SELECT n, size, meta, exp FROM blob_meta WHERE k = ?1").bind(key)
      .first<{ n: number; size: number; meta: string | null; exp: number | null }>();
    if (!m || (m.exp !== null && m.exp <= nowSec())) return null;
    const out = new Uint8Array(m.size);
    let off = 0;
    const r64 = (await this.db.prepare("SELECT d FROM blob_chunk64 WHERE k = ?1 ORDER BY i").bind(key).all<{ d: string }>()).results;
    if (r64.length) {
      if (r64.length !== m.n) return null; // وسط نوشتن/حذف همزمان؛ مثل فایل ناموجود
      for (const r of r64) { const c = fromB64(r.d); out.set(c, off); off += c.byteLength; }
    } else {
      // فایل‌های قدیمی (پیش از این تغییر) در جدول BLOB هستند؛ تا انقضای ۲۴ ساعته خوانده می‌شوند
      const { results } = await this.db.prepare("SELECT d FROM blob_chunk WHERE k = ?1 ORDER BY i").bind(key).all<{ d: ArrayBuffer | number[] }>();
      if (results.length !== m.n) return null;
      for (const r of results) {
        const c = r.d instanceof ArrayBuffer ? new Uint8Array(r.d) : Uint8Array.from(r.d as number[]);
        out.set(c, off); off += c.byteLength;
      }
    }
    return { data: out.buffer, meta: m.meta ? JSON.parse(m.meta) : null };
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

  async delete(key: string): Promise<void> {
    await this.init();
    await this.db.batch([
      this.db.prepare("DELETE FROM blob_chunk WHERE k = ?1").bind(key),
      this.db.prepare("DELETE FROM blob_chunk64 WHERE k = ?1").bind(key),
      this.db.prepare("DELETE FROM blob_meta WHERE k = ?1").bind(key),
    ]);
  }

  /** حذف فایل‌های منقضی‌شده (روزی یک بار از cron) */
  async purge(): Promise<number> {
    await this.init();
    const now = nowSec();
    await this.db.prepare("DELETE FROM blob_chunk WHERE k IN (SELECT k FROM blob_meta WHERE exp IS NOT NULL AND exp <= ?1)").bind(now).run();
    await this.db.prepare("DELETE FROM blob_chunk64 WHERE k IN (SELECT k FROM blob_meta WHERE exp IS NOT NULL AND exp <= ?1)").bind(now).run();
    const r = await this.db.prepare("DELETE FROM blob_meta WHERE exp IS NOT NULL AND exp <= ?1").bind(now).run();
    return r.meta?.changes ?? 0;
  }
}
