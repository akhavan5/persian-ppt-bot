/**
 * OCR با مدل‌های vision کلودفلر (Workers AI) از راه API و با چرخش حساب‌ها (همان fetchWithAccounts که تصویر/LLM استفاده می‌کنند)،
 * نه بایندینگ. جایگزین ocr.space که برای فارسی و PDF چندصفحه‌ای قابل‌اعتماد نبود.
 *
 * - تصویر (png/jpg): مستقیم به مدل vision داده می‌شود.
 * - PDF اسکن‌شده: JPEGهای صفحه‌ها (فیلتر DCTDecode؛ مثل خروجی CamScanner و بیشتر اسکنرها) از داخل PDF بیرون کشیده و صفحه‌به‌صفحه خوانده می‌شود.
 *   PDFی که تصویرش JPEG نباشد (مثلاً Flate/JBIG2) پشتیبانی نمی‌شود و پیام راهنما برمی‌گردد.
 * - ترتیب مدل‌ها (ارزان ← گران): gemma-4 ← qwen3.8 ← mistral-small؛ با OCR_VISION_MODELS (با کاما) قابل تغییر است.
 * - اگر همه‌ی مدل‌ها شکست خوردند و فایل ≤۱ مگابایت بود، آخرین راه ocr.space است.
 */
import type { Env } from "./env";
import { PoolExhausted, fetchWithAccounts } from "./accounts";
import { ocrSpace, OCR_MAX_BYTES } from "./extract";

export type OcrResult = { ok: true; text: string } | { ok: false; error: string };

const DEFAULT_MODELS = "@cf/google/gemma-4-26b-a4b-it,@cf/qwen/qwen3.8-27b,@cf/mistralai/mistral-small-3.1-24b-instruct";
/** سقف صفحه برای هر PDF و سقف حجم هر تصویر (JPEG بزرگ‌تر رد می‌شود) */
export const VISION_MAX_PAGES = 12;
export const VISION_MAX_IMAGE_BYTES = 4_000_000;
const CONCURRENCY = 3;

const PROMPT =
  "Transcribe ALL the text in this image exactly as written. The text is usually Persian (Farsi, right-to-left); keep Persian letters, English words, digits and math formulas as they appear. " +
  "Keep line breaks and reading order. Output ONLY the transcribed text, with no explanation, no translation and no markdown fences. If the image has no readable text, output exactly: EMPTY";

const toB64 = (u8: Uint8Array) => {
  let s = "";
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  return btoa(s);
};

/** متن بی‌معنی (فارسی که لاتینِ دارای نشانه خوانده شده) را تشخیص می‌دهد */
export function looksGarbled(text: string): boolean {
  const letters = (text.match(/[A-Za-zÀ-ɏ؀-ۿ]/g) ?? []).length;
  const odd = (text.match(/[À-ɏ]/g) ?? []).length;
  const fa = (text.match(/[؀-ۿ]/g) ?? []).length;
  return letters > 0 && odd / letters > 0.05 && fa / letters < 0.3;
}

/** ی/ک عربی ← فارسی، حذف اعراب و کشیده */
const normFa = (s: string) => s.replace(/ي/g, "ی").replace(/ى/g, "ی").replace(/ك/g, "ک").replace(/[ً-ٟـ]/g, "");

/** برای مدل‌هایی که پیش‌فرض «فکر» می‌کنند (مثل qwen) فکر کردن خاموش می‌شود */
const THINKERS = /qwen|glm|kimi/i;

async function readOne(env: Env, img: { bytes: Uint8Array; mime: string }, models: string[]): Promise<string> {
  const url = `data:${img.mime};base64,${toB64(img.bytes)}`;
  for (const model of models) {
    const body: Record<string, unknown> = {
      model,
      messages: [{ role: "user", content: [{ type: "text", text: PROMPT }, { type: "image_url", image_url: { url } }] }],
      max_tokens: 4096,
      temperature: 0,
    };
    if (THINKERS.test(model)) body.chat_template_kwargs = { enable_thinking: false };
    let r: Response;
    try {
      r = await fetchWithAccounts(env, (a) => fetch(`${a.base}/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${a.token}` },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(90_000),
      }));
    } catch (e) {
      if (e instanceof PoolExhausted) throw e; // همه‌ی حساب‌ها سقف خورده‌اند؛ مدل دیگر هم کمکی نمی‌کند
      console.error("vision ocr fetch", model, e instanceof Error ? e.message : e);
      continue;
    }
    if (!r.ok) {
      console.error("vision ocr http", model, r.status, (await r.text().catch(() => "")).slice(0, 300));
      continue;
    }
    const j = (await r.json().catch(() => null)) as any;
    const c = j?.choices?.[0]?.message?.content;
    const text = normFa(typeof c === "string" ? c : Array.isArray(c) ? c.map((p: any) => p?.text ?? "").join("") : "").replace(/^```\w*\n?|```$/g, "").trim();
    if (!text || /^EMPTY\.?$/i.test(text)) return ""; // صفحه‌ی بدون متن
    if (looksGarbled(text)) { console.error("vision ocr garbled", model); continue; }
    return text;
  }
  return "";
}

async function readMany(env: Env, imgs: { bytes: Uint8Array; mime: string }[]): Promise<OcrResult> {
  const models = (env.OCR_VISION_MODELS || DEFAULT_MODELS).split(/[,\n;]+/).map((s) => s.trim()).filter(Boolean);
  const out: string[] = new Array(imgs.length).fill("");
  let next = 0;
  const worker = async () => { for (let i = next++; i < imgs.length; i = next++) out[i] = await readOne(env, imgs[i], models); };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, imgs.length) }, worker));
  const text = out.map((t, i) => (t && imgs.length > 1 ? `# صفحه ${i + 1}\n${t}` : t)).filter(Boolean).join("\n\n").trim();
  return text.length < 20 ? { ok: false, error: "متن قابل‌خواندنی در تصویر پیدا نشد؛ اسکن واضح‌تر (بدون سایه و کج‌شدگی) یا فایل متنی را بفرست." } : { ok: true, text };
}

const latin1 = (u8: Uint8Array) => new TextDecoder("latin1").decode(u8);

/** JPEGهای صفحه‌ها را به ترتیب سند از PDF بیرون می‌کشد (فقط استریم‌های DCTDecode) */
export function extractPdfJpegs(bytes: Uint8Array): Uint8Array[] {
  const s = latin1(bytes);
  const out: Uint8Array[] = [];
  const re = /stream\r?\n/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    const start = m.index + m[0].length;
    const dictFrom = Math.max(s.lastIndexOf("obj", m.index), m.index - 1500);
    const dict = s.slice(dictFrom, m.index);
    if (!/\/DCTDecode/.test(dict) || !/\/Subtype\s*\/Image/.test(dict)) continue;
    const w = Number(dict.match(/\/Width\s+(\d+)/)?.[1] ?? 0), h = Number(dict.match(/\/Height\s+(\d+)/)?.[1] ?? 0);
    if ((w && w < 200) || (h && h < 200)) continue; // آیکن/تصویر ریز
    let end = s.indexOf("endstream", start);
    if (end < 0) break;
    const len = Number(dict.match(/\/Length\s+(\d+)(?!\s+\d+\s+R)/)?.[1] ?? 0);
    const stop = len > 0 && start + len <= end ? start + len : end;
    const jpg = bytes.subarray(start, stop);
    if (jpg.length > 1000 && jpg[0] === 0xff && jpg[1] === 0xd8) out.push(jpg);
    re.lastIndex = end + 9;
  }
  return out;
}

/**
 * ورودی هوشمند: تصویر یا PDF اسکن‌شده ← متن (حداکثر VISION_MAX_PAGES صفحه‌ی اول).
 */
export async function ocrSmart(env: Env, bytes: ArrayBuffer, mime: string): Promise<OcrResult> {
  const u8 = new Uint8Array(bytes);
  let imgs: { bytes: Uint8Array; mime: string }[];
  if (mime === "application/pdf") {
    const jpgs = extractPdfJpegs(u8);
    if (!jpgs.length) {
      if (u8.byteLength <= OCR_MAX_BYTES) return ocrSpace(env, bytes, mime);
      return { ok: false, error: "این PDF اسکن است ولی تصاویر صفحه‌هایش در قالب قابل‌خواندن نیست؛ صفحه‌ها را به‌صورت عکس (JPG) بفرست." };
    }
    const usable = jpgs.filter((j) => j.byteLength <= VISION_MAX_IMAGE_BYTES);
    if (!usable.length) return { ok: false, error: "تصویر صفحه‌های این PDF بیش از حد بزرگ است؛ با کیفیت کمتر دوباره اسکن کن یا صفحه‌ها را به‌صورت عکس بفرست." };
    imgs = usable.slice(0, VISION_MAX_PAGES).map((b) => ({ bytes: b, mime: "image/jpeg" }));
  } else {
    if (u8.byteLength > VISION_MAX_IMAGE_BYTES) return { ok: false, error: "حجم تصویر برای تبدیل به متن حداکثر ۴ مگابایت است." };
    imgs = [{ bytes: u8, mime }];
  }

  let r: OcrResult;
  try {
    r = await readMany(env, imgs);
  } catch (e) {
    console.error("vision ocr pool", e instanceof Error ? e.message.slice(0, 200) : e);
    r = { ok: false, error: "سرویس تبدیل تصویر به متن موقتاً در دسترس نیست؛ کمی بعد دوباره امتحان کن." };
  }
  if (!r.ok && u8.byteLength <= OCR_MAX_BYTES) {
    const fb = await ocrSpace(env, bytes, mime); // آخرین راه
    if (fb.ok && !looksGarbled(fb.text)) return fb;
  }
  return r;
}
