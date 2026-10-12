/**
 * دریافت فایل از تلگرام و تبدیل آن به متن (منبع محتوای ارائه)، هم‌ارز آپلود فایل در نسخه‌ی وب.
 * - txt/md/csv/json/html: مستقیم
 * - docx / pptx / xlsx: با JSZip (بدون هزینه‌ی هوش مصنوعی)
 * - PDF: Workers AI toMarkdown (رایگان برای PDF)؛ اگر متنِ قابل‌قبولی داشت، مثل بقیه‌ی فایل‌های متنی همان متن برگردانده می‌شود و اصلاً OCR نمی‌شود
 *   (حتی اگر تصویر هم داخلش باشد). فقط PDFِ بدون لایه‌ی متن (اسکن) ← OCR با مدل vision کلودفلر (vision-ocr.ts)
 * - تصویر (عکس یا فایل png/jpg): OCR با مدل vision کلودفلر
 * سقف دانلود ربات‌های تلگرام ۲۰ مگابایت است؛ سقف این‌جا ۱۵ مگابایت (مثل وب).
 */
import JSZip from "jszip";
import type { Env } from "./env";
import { ocrSmart, VISION_MAX_IMAGE_BYTES } from "./vision-ocr";
import { OCR_CAP_NOTE, ocrLimitHit } from "./ocr-limit";
import { tg } from "./telegram";

export const TG_MAX_FILE = 15 * 1024 * 1024;
const TEXT_EXT = new Set(["txt", "md", "csv", "json", "html", "htm"]);
const IMG_EXT = new Set(["png", "jpg", "jpeg"]);
export const SUPPORTED_NOTE = "Word (docx)، PDF، PowerPoint (pptx)، Excel (xlsx)، متن (txt/md/csv/html) یا تصویر (png/jpg)";

export type Extracted = { ok: true; text: string } | { ok: false; error: string };
const fail = (error: string): Extracted => ({ ok: false, error });

const decodeXml = (s: string) =>
  s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, "&");
const tidy = (t: string) => t.replace(/\u0000/g, "").replace(/[ \t ]+/g, " ").replace(/ ?\n ?/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
const numSort = (a: string, b: string) => parseInt(a.match(/\d+/)![0]) - parseInt(b.match(/\d+/)![0]);
const textsOf = (xml: string, tag: string) => Array.from(xml.matchAll(new RegExp(`<${tag}(?:\\s[^>]*)?>([^<]*)</${tag}>`, "g")), (m) => decodeXml(m[1])).join("");
const blocksOf = (xml: string, tag: string) => Array.from(xml.matchAll(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "g")), (m) => m[1]);

async function readDocx(zip: JSZip): Promise<string> {
  const f = zip.file("word/document.xml");
  if (!f) throw new Error("ساختار فایل Word معتبر نیست.");
  return blocksOf(await f.async("string"), "w:p").map((p) => {
    const text = textsOf(p, "w:t");
    const style = p.match(/<w:pStyle\s[^>]*w:val="([^"]*)"/)?.[1] ?? "";
    return text && /^(Heading|Title|عنوان)/i.test(style) ? "# " + text : text;
  }).filter(Boolean).join("\n");
}

async function readPptx(zip: JSZip): Promise<string> {
  const names = Object.keys(zip.files).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n)).sort(numSort);
  if (!names.length) throw new Error("ساختار فایل PowerPoint معتبر نیست.");
  const out: string[] = [];
  for (const [i, n] of names.slice(0, 80).entries()) {
    const paras = blocksOf(await zip.file(n)!.async("string"), "a:p").map((p) => textsOf(p, "a:t")).filter(Boolean);
    if (paras.length) out.push(`# اسلاید ${i + 1}\n` + paras.join("\n"));
  }
  return out.join("\n\n");
}

async function readXlsx(zip: JSZip): Promise<string> {
  const sst = zip.file("xl/sharedStrings.xml");
  const shared = sst ? blocksOf(await sst.async("string"), "si").map((si) => textsOf(si, "t")) : [];
  const names = Object.keys(zip.files).filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n)).sort(numSort);
  if (!names.length) throw new Error("ساختار فایل Excel معتبر نیست.");
  const out: string[] = [];
  for (const [i, n] of names.slice(0, 10).entries()) {
    const xml = await zip.file(n)!.async("string");
    const rows = blocksOf(xml, "row").slice(0, 200).map((r) =>
      Array.from(r.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g), (m) => {
        const t = m[1].match(/\bt="([^"]*)"/)?.[1];
        const v = m[2]?.match(/<v>([^<]*)<\/v>/)?.[1];
        if (t === "s") return shared[Number(v)] ?? "";
        if (t === "inlineStr") return textsOf(m[2] ?? "", "t");
        return v !== undefined ? decodeXml(v) : "";
      }).join("\t")).filter((r) => r.replace(/\t/g, "").trim());
    if (rows.length) out.push(`# برگه ${i + 1}\n` + rows.join("\n"));
  }
  return out.join("\n\n");
}

/**
 * حداقل نویسه‌ی متنی (بدون فاصله) در کل فایل تا PDF «متنی» حساب شود و اصلاً OCR نشود.
 * فقط مجموع متن کل فایل ملاک است (نه میانگین هر صفحه)؛ PDFِ ترکیبی (متن + تصویر) هم متنِ خودش را دارد و مثل فایل متنی خوانده می‌شود.
 */
const MIN_TEXT_CHARS = 60;
/** خروجی toMarkdown را به صفحه‌ها می‌شکند و عنوان فایل، بخش Metadata و سرتیترهای ساختاری را حذف می‌کند */
function splitPages(md: string): { page: number; text: string }[] {
  const body = md
    .replace(/^#\s.*$/m, "")                                         // عنوان فایل
    .replace(/^##\s*Metadata[\s\S]*?(?=^##\s*Contents|(?![\s\S]))/im, "") // بخش Metadata (نام نویسنده، uuid و …)
    .replace(/^##\s*Contents\s*$/im, "");
  const marks = Array.from(body.matchAll(/^#{1,6}\s*Page\s*(\d+)\s*$/gim));
  if (!marks.length) return [{ page: 0, text: tidy(body) }];
  return marks.map((m, i) => ({ page: Number(m[1]), text: tidy(body.slice(m.index! + m[0].length, marks[i + 1]?.index ?? body.length)) }));
}

async function readPdf(env: Env, bytes: ArrayBuffer, name: string, userId: string | number): Promise<Extracted> {
  let text = "";
  try {
    const ai = env.AI as any;
    const res = await ai.toMarkdown([{ name: name || "file.pdf", blob: new Blob([bytes], { type: "application/pdf" }) }]);
    const r = Array.isArray(res) ? res[0] : res;
    if (r && r.format !== "error") text = String(r.data ?? "");
    else console.error("toMarkdown", String(r?.error ?? "").slice(0, 200));
  } catch (e) {
    console.error("toMarkdown failed", e instanceof Error ? e.message : e);
  }
  text = tidy(text);
  const pages = splitPages(text);
  // طول متن واقعی (بدون عنوان/Metadata/سرتیتر صفحه)؛ وگرنه اسکن به‌اشتباه «متنی» تشخیص داده می‌شود.
  const realLen = pages.reduce((n, p) => n + p.text.replace(/\s+/g, "").length, 0);
  const plain = pages.map((p) => p.text).filter(Boolean).join("\n\n");

  // متنِ قابل‌قبول در کل فایل ⇒ مثل هر فایل متنی دیگر؛ هیچ OCRی (و هیچ مصرف سقف OCRی) در کار نیست
  if (realLen >= MIN_TEXT_CHARS) return { ok: true, text: plain };

  // لایه‌ی متن ندارد ⇒ اسکن ⇒ OCR با مدل vision (صفحه‌به‌صفحه)
  if (await ocrLimitHit(env, userId)) return fail(`سقف روزانه‌ی تبدیل تصویر/اسکن به متن تمام شد؛ فردا دوباره امتحان کن. ${OCR_CAP_NOTE}`);
  return ocrSmart(env, bytes, "application/pdf");
}

/** عکس/تصویر ← متن با OCR (سقف روزانه: اعتبار ساخت ارائه + ۲، مثل وب) */
async function readImage(env: Env, bytes: ArrayBuffer, mime: string, userId: string | number): Promise<Extracted> {
  if (bytes.byteLength > VISION_MAX_IMAGE_BYTES) return fail("تصویر برای تبدیل به متن حداکثر ۴ مگابایت می‌تواند باشد؛ آن را به‌صورت «عکس» (نه «فایل») بفرست تا تلگرام کوچکش کند.");
  if (await ocrLimitHit(env, userId)) return fail(`سقف روزانه‌ی تبدیل تصویر به متن تمام شد؛ فردا دوباره امتحان کن. ${OCR_CAP_NOTE}`);
  return ocrSmart(env, bytes, mime);
}

export interface TgFileRef { fileId: string; name: string; mime: string; size?: number; isPhoto?: boolean }

/** از پیام تلگرام، فایل قابل‌پردازش (سند یا عکس) را برمی‌گرداند؛ عکس: بزرگ‌ترین اندازه‌ی ≤۴ مگابایت (سقف OCR) */
export function fileRefOf(msg: any): TgFileRef | null {
  if (msg.document?.file_id) {
    const d = msg.document;
    return { fileId: d.file_id, name: String(d.file_name ?? "file"), mime: String(d.mime_type ?? ""), size: d.file_size };
  }
  if (Array.isArray(msg.photo) && msg.photo.length) {
    const sizes = [...msg.photo].sort((a: any, b: any) => (a.file_size ?? 0) - (b.file_size ?? 0));
    const pick = [...sizes].reverse().find((p: any) => (p.file_size ?? 0) <= VISION_MAX_IMAGE_BYTES) ?? sizes[0];
    return { fileId: pick.file_id, name: "photo.jpg", mime: "image/jpeg", size: pick.file_size, isPhoto: true };
  }
  return null;
}

const extOf = (name: string, mime: string) => {
  const e = (name.split(".").pop() || "").toLowerCase();
  if (e && e !== name.toLowerCase()) return e;
  if (mime === "application/pdf") return "pdf";
  if (mime === "image/png") return "png";
  if (mime.startsWith("image/jpeg")) return "jpg";
  if (mime.startsWith("text/")) return "txt";
  return "";
};

const isSupportedExt = (ext: string) => TEXT_EXT.has(ext) || IMG_EXT.has(ext) || ["docx", "pptx", "xlsx", "pdf"].includes(ext);
const unsupportedFile = (): Extracted =>
  fail(`این نوع فایل پشتیبانی نمی‌شود. ${SUPPORTED_NOTE} بفرست (فایل‌های قدیمی doc/ppt/xls را ابتدا به docx/pptx/xlsx تبدیل کن).`);

/** دانلود از تلگرام و استخراج متن؛ خطاها پیام فارسی آماده برای کاربر هستند */
export async function extractTelegramFile(env: Env, ref: TgFileRef, userId: string | number): Promise<Extracted> {
  const ext = extOf(ref.name, ref.mime);
  if (!isSupportedExt(ext)) return unsupportedFile();
  if ((ref.size ?? 0) > TG_MAX_FILE) return fail("حجم فایل حداکثر ۱۵ مگابایت می‌تواند باشد.");

  let bytes: ArrayBuffer;
  try {
    const info = await tg<{ file_path?: string; file_size?: number }>(env, "getFile", { file_id: ref.fileId });
    if (!info.file_path) return fail("دریافت فایل از تلگرام ممکن نشد؛ دوباره بفرست.");
    if ((info.file_size ?? 0) > TG_MAX_FILE) return fail("حجم فایل حداکثر ۱۵ مگابایت می‌تواند باشد.");
    const base = env.TELEGRAM_API_BASE || "https://api.telegram.org";
    const r = await fetch(`${base}/file/bot${env.TELEGRAM_BOT_TOKEN}/${info.file_path}`, { signal: AbortSignal.timeout(60_000) });
    if (!r.ok) return fail("دریافت فایل از تلگرام ممکن نشد؛ دوباره بفرست.");
    bytes = await r.arrayBuffer();
  } catch (e) {
    console.error("telegram file download", e instanceof Error ? e.message : e);
    return fail("دریافت فایل از تلگرام ممکن نشد؛ دوباره بفرست.");
  }
  return extractFileBytes(env, bytes, ref.name, ref.mime, userId);
}

/**
 * از بایت‌های فایل به متن؛ هسته‌ی مشترک ربات تلگرام و نسخه‌ی وب (web-ocr-workflow.ts)،
 * پس هر دو دقیقاً یک مسیر را می‌روند: toMarkdown ← (فقط اگر متنِ قابل‌قبولی نداشت = اسکن) OCR با مدل vision.
 */
export async function extractFileBytes(env: Env, bytes: ArrayBuffer, name: string, mime: string, userId: string | number): Promise<Extracted> {
  const ext = extOf(name, mime);
  if (!isSupportedExt(ext)) return unsupportedFile();
  if (bytes.byteLength > TG_MAX_FILE) return fail("حجم فایل حداکثر ۱۵ مگابایت می‌تواند باشد.");

  try {
    let text: string;
    if (TEXT_EXT.has(ext)) {
      const raw = new TextDecoder("utf-8").decode(bytes);
      text = ext.startsWith("htm") ? decodeXml(raw.replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]+>/g, " ")) : raw;
    } else if (ext === "pdf") {
      const r = await readPdf(env, bytes, name, userId);
      if (!r.ok) return r;
      text = r.text;
    } else if (IMG_EXT.has(ext)) {
      const r = await readImage(env, bytes, ext === "png" ? "image/png" : "image/jpeg", userId);
      if (!r.ok) return r;
      text = r.text;
    } else {
      const zip = await JSZip.loadAsync(bytes);
      text = ext === "docx" ? await readDocx(zip) : ext === "pptx" ? await readPptx(zip) : await readXlsx(zip);
    }
    text = tidy(text);
    return text.length < 30 ? fail("متن قابل‌خواندنی در فایل پیدا نشد؛ فایل دیگری را امتحان کن.") : { ok: true, text };
  } catch (e) {
    console.error("extract file", ext, e instanceof Error ? e.message : e);
    return fail(e instanceof Error && /معتبر نیست/.test(e.message) ? e.message : "خواندن فایل ممکن نشد؛ فایل سالم‌تری را امتحان کن.");
  }
}
