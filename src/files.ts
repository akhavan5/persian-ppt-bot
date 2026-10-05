/** نگه‌داری فایل‌های ساخته‌شده برای ۲۴ ساعت (بایت‌ها در KV واقعی با انقضای خودکار، فهرست در D1؛ بدون نیاز به R2). */
import JSZip from "jszip";
import type { Env } from "./env";
import type { Uid } from "./settings";
import type { Deck } from "./types";

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

// ---------- پیش‌نمایش در مرورگر (و خروجی PDF از روی همان صفحه) ----------
// متن اسلایدها در D1 (از طریق env.KV) نگه داشته می‌شود: نوشتن D1 سهمیه‌ی ۱۰۰ هزار در روز دارد و به سهمیه‌ی ۱۰۰۰ نوشتنِ KV واقعی دست نمی‌زند.
// تصویرها جدا ذخیره نمی‌شوند؛ از خود فایل PPTX (که در KV است) بیرون کشیده می‌شوند.
export interface PreviewData { deck: Deck; theme: string; font: string; digits: boolean; /** شماره‌ی اسلایدهایی که تصویر دارند */ images: number[] }
const previewKey = (userId: Uid, id: string) => `dk:${userId}:${id}`;

export async function savePreview(env: Env, userId: Uid, id: string, p: PreviewData): Promise<void> {
  const raw = JSON.stringify(p);
  if (raw.length > 1_500_000) return; // سقف ردیف D1 دو مگابایت است
  await env.KV.put(previewKey(userId, id), raw, { expirationTtl: TTL });
}

export async function loadPreview(env: Env, userId: Uid, id: string): Promise<PreviewData | null> {
  const p = (await env.KV.get(previewKey(userId, id), "json")) as PreviewData | null;
  return p && p.deck && Array.isArray(p.deck.slides) ? p : null;
}

/** تصویر اسلاید شماره‌ی slide (از صفر) را از داخل فایل PPTX برمی‌گرداند؛ PptxGenJS تصویر هر اسلاید را ppt/media/image-<شماره‌ی اسلاید از ۱>-<n>.<پسوند> ذخیره می‌کند. */
export async function loadPreviewImage(env: Env, userId: Uid, id: string, slide: number): Promise<{ data: Uint8Array; type: string } | null> {
  const f = await loadFileDirect(env, userId, id);
  if (!f) return null;
  const zip = await JSZip.loadAsync(f.data);
  const name = Object.keys(zip.files).find((n) => n.startsWith(`ppt/media/image-${slide + 1}-`));
  if (!name) return null;
  return { data: await zip.files[name].async("uint8array"), type: /\.png$/i.test(name) ? "image/png" : "image/jpeg" };
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
