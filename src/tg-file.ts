/**
 * دریافت فایل از تلگرام و تبدیل آن به متن (منبع محتوای ارائه)، هم‌ارز آپلود فایل در نسخه‌ی وب.
 * - txt/md/csv/json/html: مستقیم
 * - docx / pptx / xlsx: با JSZip (بدون هزینه‌ی هوش مصنوعی)
 * - PDF: Workers AI toMarkdown (رایگان برای PDF)؛ اگر لایه‌ی متن نداشت (اسکن) و ≤۱ مگابایت بود ← OCR
 * - تصویر (عکس یا فایل png/jpg): OCR با ocr.space (همان مسیر نسخه‌ی وب)
 * سقف دانلود ربات‌های تلگرام ۲۰ مگابایت است؛ سقف این‌جا ۱۵ مگابایت (مثل وب).
 */
import JSZip from "jszip";
import type { Env } from "./env";
import { OCR_MAX_BYTES, ocrSpace } from "./extract";
import { hitLimit } from "./auth";
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

async function readPdf(env: Env, bytes: ArrayBuffer, name: string): Promise<Extracted> {
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
  if (text.length >= 60) return { ok: true, text };
  // بدون لایه‌ی متن ⇒ احتمالاً اسکن
  if (bytes.byteLength <= OCR_MAX_BYTES) return ocrSpace(env, bytes, "application/pdf");
  return fail("این PDF لایه‌ی متنی ندارد (اسکن است) و برای تبدیل به متن بیش از ۱ مگابایت است؛ نسخه‌ی متنی‌اش یا یک عکس واضح از صفحه‌ها را بفرست.");
}

/** عکس/تصویر ← متن با OCR (سقف روزانه مثل وب) */
async function readImage(env: Env, bytes: ArrayBuffer, mime: string, userId: string | number): Promise<Extracted> {
  if (bytes.byteLength > OCR_MAX_BYTES) return fail("تصویر برای تبدیل به متن حداکثر ۱ مگابایت می‌تواند باشد؛ آن را به‌صورت «عکس» (نه «فایل») بفرست تا تلگرام کوچکش کند.");
  const day = new Date().toISOString().slice(0, 10);
  if (await hitLimit(env, `ocr:${userId}:${day}`, 15, 172_800)) return fail("سقف روزانه‌ی تبدیل تصویر به متن تمام شد؛ فردا دوباره امتحان کن.");
  return ocrSpace(env, bytes, mime);
}

export interface TgFileRef { fileId: string; name: string; mime: string; size?: number; isPhoto?: boolean }

/** از پیام تلگرام، فایل قابل‌پردازش (سند یا عکس) را برمی‌گرداند؛ عکس: بزرگ‌ترین اندازه‌ی ≤۱ مگابایت (سقف OCR) */
export function fileRefOf(msg: any): TgFileRef | null {
  if (msg.document?.file_id) {
    const d = msg.document;
    return { fileId: d.file_id, name: String(d.file_name ?? "file"), mime: String(d.mime_type ?? ""), size: d.file_size };
  }
  if (Array.isArray(msg.photo) && msg.photo.length) {
    const sizes = [...msg.photo].sort((a: any, b: any) => (a.file_size ?? 0) - (b.file_size ?? 0));
    const pick = [...sizes].reverse().find((p: any) => (p.file_size ?? 0) <= OCR_MAX_BYTES) ?? sizes[0];
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

/** دانلود از تلگرام و استخراج متن؛ خطاها پیام فارسی آماده برای کاربر هستند */
export async function extractTelegramFile(env: Env, ref: TgFileRef, userId: string | number): Promise<Extracted> {
  const ext = extOf(ref.name, ref.mime);
  if (!TEXT_EXT.has(ext) && !IMG_EXT.has(ext) && !["docx", "pptx", "xlsx", "pdf"].includes(ext)) {
    return fail(`این نوع فایل پشتیبانی نمی‌شود. ${SUPPORTED_NOTE} بفرست (فایل‌های قدیمی doc/ppt/xls را ابتدا به docx/pptx/xlsx تبدیل کن).`);
  }
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
  if (bytes.byteLength > TG_MAX_FILE) return fail("حجم فایل حداکثر ۱۵ مگابایت می‌تواند باشد.");

  try {
    let text: string;
    if (TEXT_EXT.has(ext)) {
      const raw = new TextDecoder("utf-8").decode(bytes);
      text = ext.startsWith("htm") ? decodeXml(raw.replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]+>/g, " ")) : raw;
    } else if (ext === "pdf") {
      const r = await readPdf(env, bytes, ref.name);
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
