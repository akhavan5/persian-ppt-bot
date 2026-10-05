/** نگه‌داری فایل‌های ساخته‌شده برای ۲۴ ساعت (بایت‌ها در KV واقعی با انقضای خودکار، فهرست در D1؛ بدون نیاز به R2). */
import type { Env } from "./env";
import type { Uid } from "./settings";

export interface FileEntry { id: string; name: string; title: string; slides: number; t: number }

const TTL = 24 * 60 * 60; // ثانیه
const KEEP = 3; // آخرین چند فایل هر کاربر
const MAX_BYTES = 24 * 1024 * 1024; // سقف مقدار در KV ۲۵ مگابایت است

const fileKey = (userId: Uid, id: string) => `file:${userId}:${id}`;
const listKey = (userId: Uid) => `fl:${userId}`;

export async function listFiles(env: Env, userId: Uid): Promise<FileEntry[]> {
  const raw = (await env.KV.get(listKey(userId), "json")) as FileEntry[] | null;
  const min = Date.now() - TTL * 1000;
  return (Array.isArray(raw) ? raw : []).filter((f) => f && f.t > min);
}

/** id ثابت است (شناسه‌ی نمونه‌ی Workflow)؛ اگر گام تکرار شد، دوباره ذخیره نمی‌شود. */
export async function saveFile(env: Env, userId: Uid, id: string, bytes: Uint8Array, name: string, title: string, slides: number): Promise<boolean> {
  if (bytes.byteLength > MAX_BYTES) return false;
  // متادیتا کنار خودِ فایل ذخیره می‌شود تا دانلود وب بدون خواندن فهرست (که ممکن است تا ۶۰ ثانیه قدیمی دیده شود) کار کند
  await env.FILES.put(fileKey(userId, id), bytes, { expirationTtl: TTL, metadata: { name, title: title.slice(0, 120), slides, t: Date.now() } });
  const rest = (await listFiles(env, userId)).filter((f) => f.id !== id);
  const all = [{ id, name, title, slides, t: Date.now() }, ...rest];
  for (const old of all.slice(KEEP)) await env.FILES.delete(fileKey(userId, old.id)).catch(() => {});
  await env.KV.put(listKey(userId), JSON.stringify(all.slice(0, KEEP)), { expirationTtl: TTL });
  return true;
}

/** دریافت مستقیم با شناسه‌ی فایل (بدون فهرست). مالکیت از خودِ کلید (شناسه‌ی کاربر) می‌آید. */
export async function loadFileDirect(env: Env, userId: Uid, id: string): Promise<{ entry: FileEntry; data: ArrayBuffer } | null> {
  const r = await env.FILES.getWithMetadata<Omit<FileEntry, "id">>(fileKey(userId, id), "arrayBuffer");
  if (!r.value || !r.metadata) return null;
  return { entry: { id, ...r.metadata }, data: r.value };
}

/** فقط فایل‌های خودِ کاربر (از روی فهرست او) برگردانده می‌شود. */
export async function loadFile(env: Env, userId: Uid, id: string): Promise<{ entry: FileEntry; data: ArrayBuffer } | null> {
  const entry = (await listFiles(env, userId)).find((f) => f.id === id);
  if (!entry) return null;
  const data = await env.FILES.get(fileKey(userId, id), "arrayBuffer");
  return data ? { entry, data } : null;
}

// ---------- گزارش ۱۰ ارائه‌ی اخیر (برای مدیر) ----------
export interface DeckLog { id: string; userId: Uid; n: string; u: string | null; title: string; slides: number; t: number }
const LOG_KEY = "recent:decks";
const LOG_MAX = 10;

export async function getDeckLog(env: Env): Promise<DeckLog[]> {
  const raw = (await env.KV.get(LOG_KEY, "json")) as DeckLog[] | null;
  return Array.isArray(raw) ? raw.filter((x) => x && (Number.isSafeInteger(x.userId) || typeof x.userId === "string")) : [];
}

/** id همان شناسه‌ی نمونه‌ی Workflow است؛ اگر گام تکرار شد، رکورد دوباره اضافه نمی‌شود. */
export async function logDeck(env: Env, e: DeckLog) {
  const rest = (await getDeckLog(env)).filter((x) => x.id !== e.id);
  await env.KV.put(LOG_KEY, JSON.stringify([e, ...rest].slice(0, LOG_MAX)));
}
