/** نگه‌داری فایل‌های ساخته‌شده برای ۲۴ ساعت (بایت‌ها در KV واقعی با انقضای خودکار، فهرست در D1؛ بدون نیاز به R2). */
import JSZip from "jszip";
import type { Env } from "./env";
import { getSub, type Uid } from "./settings";
import type { Deck } from "./types";
import { isSampleId, loadSample } from "./samples";

export interface FileEntry { id: string; name: string; title: string; slides: number; t: number }

const TTL = 24 * 60 * 60; // ثانیه
// سقف تعداد فایل‌های نگه‌داشته‌شده برای هر کاربر (ارائه، پوستر و جزوه هر کدام یک فایل‌اند) بر اساس پلن.
// سقف به پلن وابسته است نه به اعتبار باقی‌مانده: با تمام‌شدن اعتبار نباید فایل‌های تازه پاک شوند.
const KEEP_FREE = 9;
const KEEP_BY_PLAN: Record<string, number> = { plus: 18, pro: 30 };

async function keepFor(env: Env, userId: Uid): Promise<number> {
  try {
    const sub = await getSub(env, userId); // فقط پایان زمان پلن را در نظر می‌گیرد، نه اعتبار باقی‌مانده
    return sub ? (KEEP_BY_PLAN[sub.plan] ?? KEEP_FREE) : KEEP_FREE;
  } catch { return KEEP_FREE; }
}
const MAX_BYTES = 24 * 1024 * 1024; // سقف مقدار در KV ۲۵ مگابایت است

const fileKey = (userId: Uid, id: string) => `file:${userId}:${id}`;
const listKey = (userId: Uid) => `fl:${userId}`;

export async function listFiles(env: Env, userId: Uid): Promise<FileEntry[]> {
  const raw = (await env.KV.get(listKey(userId), "json")) as FileEntry[] | null;
  const min = Date.now() - TTL * 1000;
  return (Array.isArray(raw) ? raw : []).filter((f) => f && f.t > min);
}

/** id ثابت است (شناسه‌ی نمونه‌ی Workflow)؛ اگر گام تکرار شد، دوباره ذخیره نمی‌شود. */
export async function saveFile(env: Env, userId: Uid, id: string, bytes: Uint8Array, name: string, title: string, slides: number, at?: number): Promise<boolean> {
  if (bytes.byteLength > MAX_BYTES) return false;
  // at: زمان ساخت اصلی (فقط برای انتقال فایل بین حساب‌ها)؛ عمر باقی‌مانده‌ی همان فایل حفظ می‌شود و تمدید نمی‌شود
  const t = at ?? Date.now();
  const ttl = Math.floor(TTL - (Date.now() - t) / 1000);
  if (ttl < 60) return false; // تقریباً منقضی‌شده
  // متادیتا کنار خودِ فایل ذخیره می‌شود تا دانلود وب بدون خواندن فهرست (که ممکن است تا ۶۰ ثانیه قدیمی دیده شود) کار کند
  await env.FILES.put(fileKey(userId, id), bytes, { expirationTtl: ttl, metadata: { name, title: title.slice(0, 120), slides, t } });
  const rest = (await listFiles(env, userId)).filter((f) => f.id !== id);
  const all = [{ id, name, title, slides, t }, ...rest].sort((a, b) => b.t - a.t);
  const KEEP = await keepFor(env, userId);
  for (const old of all.slice(KEEP)) await env.FILES.delete(fileKey(userId, old.id)).catch(() => {});
  await env.KV.put(listKey(userId), JSON.stringify(all.slice(0, KEEP)), { expirationTtl: TTL });
  return true;
}

/** دریافت مستقیم با شناسه‌ی فایل (بدون فهرست). مالکیت از خودِ کلید (شناسه‌ی کاربر) می‌آید. */
export async function loadFileDirect(env: Env, userId: Uid, id: string): Promise<{ entry: FileEntry; data: ArrayBuffer } | null> {
  if (isSampleId(id)) return loadSample(env, id); // فایل نمونه: دائمی و برای همه
  const r = await env.FILES.getWithMetadata<Omit<FileEntry, "id">>(fileKey(userId, id), "arrayBuffer");
  if (!r.value || !r.metadata) return null;
  return { entry: { id, ...r.metadata }, data: r.value };
}

/** فقط فایل‌های خودِ کاربر (از روی فهرست او) برگردانده می‌شود. */
export async function loadFile(env: Env, userId: Uid, id: string): Promise<{ entry: FileEntry; data: ArrayBuffer } | null> {
  if (isSampleId(id)) return loadSample(env, id);
  const entry = (await listFiles(env, userId)).find((f) => f.id === id);
  if (!entry) return null;
  const data = await env.FILES.get(fileKey(userId, id), "arrayBuffer");
  return data ? { entry, data } : null;
}

/** فایل‌های ۲۴ ساعته (و متن پیش‌نمایششان) را از یک حساب به حساب دیگر منتقل می‌کند؛ برای وقتی پروفایل خودکارِ یک پیام‌رسان به حساب اصلی وصل می‌شود
 *  تا همه‌ی فایل‌ها در همه‌ی پلتفرم‌ها یکی باشد. قدیمی‌ترین اول منتقل می‌شود تا ترتیب فهرست حفظ شود و سقف نگه‌داری حساب مقصد رعایت شود.
 *  بهترین‌تلاش است: خطای یک فایل بقیه را متوقف نمی‌کند. تعداد منتقل‌شده برگردانده می‌شود. */
export async function moveFiles(env: Env, from: Uid, to: Uid, max = 12): Promise<number> {
  if (from === to) return 0;
  const list = (await listFiles(env, from)).slice(0, max).reverse();
  let n = 0;
  for (const e of list) {
    try {
      const f = await loadFileDirect(env, from, e.id);
      if (!f) continue;
      if (!(await saveFile(env, to, e.id, new Uint8Array(f.data), f.entry.name, f.entry.title, f.entry.slides, e.t))) continue;
      const pv = await env.KV.get(previewKey(from, e.id));
      if (pv) await env.KV.put(previewKey(to, e.id), pv, { expirationTtl: Math.max(60, Math.floor(TTL - (Date.now() - e.t) / 1000)) });
      await env.FILES.delete(fileKey(from, e.id)).catch(() => {});
      await env.KV.delete(previewKey(from, e.id)).catch(() => {});
      n++;
    } catch (err) { console.error("moveFiles", e.id, String(err).slice(0, 120)); }
  }
  await env.KV.delete(listKey(from)).catch(() => {});
  return n;
}

// ---------- پیش‌نمایش در مرورگر (و خروجی PDF از روی همان صفحه) ----------
// متن اسلایدها در D1 (از طریق env.KV) نگه داشته می‌شود: نوشتن D1 سهمیه‌ی ۱۰۰ هزار در روز دارد و به سهمیه‌ی ۱۰۰۰ نوشتنِ KV واقعی دست نمی‌زند.
// تصویرها جدا ذخیره نمی‌شوند؛ از خود فایل PPTX (که در KV است) بیرون کشیده می‌شوند.
export interface PreviewData { deck: Deck; theme: string; /** قالب اسلاید؛ ارائه‌های قدیمی خالی‌اند = classic */ template?: string; font: string; digits: boolean; /** شماره‌ی اسلایدهایی که تصویر دارند */ images: number[] }
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
export const pptxImageName = (zip: JSZip, template: string | undefined, slide: number): string | undefined => {
  // در قالب آکادمیک اسلاید «بسم‌الله» پیش از همه در PPTX هست و شماره‌ی اسلایدها را یکی جلو می‌برد؛ در پیش‌نمایش/PDF جدا رسم می‌شود
  const no = slide + 1 + (template === "academic" ? 1 : 0);
  return Object.keys(zip.files).find((n) => n.startsWith(`ppt/media/image-${no}-`));
};

export async function loadPreviewImage(env: Env, userId: Uid, id: string, slide: number, template?: string): Promise<{ data: Uint8Array; type: string } | null> {
  const f = await loadFileDirect(env, userId, id);
  if (!f) return null;
  const zip = await JSZip.loadAsync(f.data);
  const name = pptxImageName(zip, template, slide);
  if (!name) return null;
  return { data: await zip.files[name].async("uint8array"), type: /\.png$/i.test(name) ? "image/png" : "image/jpeg" };
}

// ---------- گزارش ۱۰ ارائه‌ی اخیر (برای مدیر) ----------
export interface DeckLog { id: string; userId: Uid; n: string; u: string | null; title: string; slides: number; t: number; /** ورودی اصلی کاربر (کوتاه) */ o?: string;
  /** پلتفرم ساخت ارائه (tg | bale | rubika | eitaa | web | bazaar | myket | app | ios | pwa_ios | pwa)؛ رکوردهای قدیمی ندارند */ p?: string;
  /** نسخه‌ی اپ و نسخه‌ی سیستم‌عامل دستگاه — اندروید یا iOS، از روی p معلوم است (فقط ارائه‌های ساخته‌شده از اپ جدید) */ av?: string; an?: string }
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
