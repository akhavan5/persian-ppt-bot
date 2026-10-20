/**
 * OCR با مدل‌های vision کلودفلر (Workers AI) از راه API و با چرخش حساب‌ها (همان fetchWithAccounts که تصویر/LLM استفاده می‌کنند)،
 * نه بایندینگ. جایگزین ocr.space که برای فارسی و PDF چندصفحه‌ای قابل‌اعتماد نبود.
 *
 * - تصویر (png/jpg): مستقیم به مدل vision داده می‌شود.
 * - PDF اسکن‌شده (بدون لایه‌ی متن؛ PDFِ دارای متن اصلاً به این‌جا نمی‌رسد، tg-file.ts): تصویرهای صفحه‌ها از داخل PDF بیرون کشیده و یکی‌یکی خوانده می‌شود (pdf-images.ts: JPEG مستقیم، Flate ← PNG).
 *   PDFی که تصویرش JBIG2/CCITT/Indexed باشد پشتیبانی نمی‌شود و پیام راهنما برمی‌گردد.
 * - ترتیب مدل‌ها (ارزان ← گران): gemma-4 ← qwen3.8 ← mistral-small؛ با OCR_VISION_MODELS (با کاما) قابل تغییر است.
 * - ocr.space فقط برای PDFی که JPEG قابل‌استخراج ندارد و ≤۱ مگابایت است باقی مانده است.
 */
import type { Env } from "./env";
import { PoolExhausted, fetchWithAccounts } from "./accounts";
import { ocrSpace, OCR_MAX_BYTES } from "./extract";
import { extractPdfImages, type PdfImage } from "./pdf-images";
import { renderPdfPages } from "./pdf-render";

export type OcrResult = { ok: true; text: string } | { ok: false; error: string };

const DEFAULT_MODELS = "@cf/google/gemma-4-26b-a4b-it,@cf/qwen/qwen3.8-27b,@cf/mistralai/mistral-small-3.1-24b-instruct";
/** سقف صفحه برای هر PDF و سقف حجم هر تصویر (JPEG بزرگ‌تر رد می‌شود) */
export const VISION_MAX_PAGES = 20;
export const VISION_MAX_IMAGE_BYTES = 4_000_000;
const CONCURRENCY = 3;

const PROMPT =
  "Transcribe ALL the text in this image exactly as written. The text is usually Persian (Farsi, right-to-left); keep Persian letters, English words, digits and math formulas as they appear. " +
  "Keep line breaks and reading order. Output ONLY the transcribed text, with no explanation, no translation and no markdown fences. If the image shows a multiple-choice question, put each option on its own line and start the option that is marked as chosen/correct (green check mark, ticked or filled box) with ✔. Write tables row by row with \" | \" between cells. If the image has no readable text, output exactly: EMPTY";

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

/** مدل‌هایی که پیش‌فرض «فکر» می‌کنند و تمام توکن‌ها را صرف reasoning می‌کنند (content=null, finish_reason=length)؛ فکر کردن خاموش می‌شود. هم‌راستا با THINKERS در llm.ts */
const THINKERS = /qwen3|qwen-3|qwen|glm|gemma-?4|kimi/i;

async function readOne(env: Env, img: { bytes: Uint8Array; mime: string }, models: string[]): Promise<string> {
  const url = `data:${img.mime};base64,${toB64(img.bytes)}`;
  for (const model of models) {
    const t0 = Date.now();
    const body: Record<string, unknown> = {
      model,
      messages: [{ role: "user", content: [{ type: "text", text: PROMPT }, { type: "image_url", image_url: { url } }] }],
      max_tokens: 6000,
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
      console.error("vision ocr fetch", model, `${Date.now() - t0}ms`, e instanceof Error ? e.message : e);
      continue;
    }
    if (!r.ok) {
      console.error("vision ocr http", model, r.status, `${Date.now() - t0}ms`, (await r.text().catch(() => "")).slice(0, 400));
      continue;
    }
    const j = (await r.json().catch(() => null)) as any;
    const c = j?.choices?.[0]?.message?.content;
    const text = normFa(typeof c === "string" ? c : Array.isArray(c) ? c.map((p: any) => p?.text ?? "").join("") : "").replace(/^```\w*\n?|```$/g, "").trim();
    if (!text) {
      // پاسخ خالی: ساختار پاسخ را لاگ می‌کنیم (مثلاً محتوا در reasoning_content یا finish_reason=length) و مدل بعدی امتحان می‌شود
      console.error("vision ocr empty", model, `${Date.now() - t0}ms`, JSON.stringify(j)?.slice(0, 500));
      continue;
    }
    if (/^EMPTY\.?$/i.test(text)) return ""; // مدل می‌گوید متنی نیست
    if (looksGarbled(text)) { console.error("vision ocr garbled", model, text.slice(0, 120)); continue; }
    console.log("vision ocr ok", model, `${Date.now() - t0}ms`, text.length);
    return text;
  }
  return "";
}

async function readEach(env: Env, imgs: { bytes: Uint8Array; mime: string }[]): Promise<string[]> {
  const models = (env.OCR_VISION_MODELS || DEFAULT_MODELS).split(/[,\n;]+/).map((s) => s.trim()).filter(Boolean);
  const out: string[] = new Array(imgs.length).fill("");
  let next = 0;
  const worker = async () => { for (let i = next++; i < imgs.length; i = next++) out[i] = await readOne(env, imgs[i], models); };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, imgs.length) }, worker));
  return out;
}

async function readMany(env: Env, imgs: { bytes: Uint8Array; mime: string }[]): Promise<OcrResult> {
  const out = await readEach(env, imgs);
  const text = out.map((t, i) => (t && imgs.length > 1 ? `# صفحه ${i + 1}\n${t}` : t)).filter(Boolean).join("\n\n").trim();
  return text.length < 20 ? { ok: false, error: "متن قابل‌خواندنی در تصویر پیدا نشد؛ اسکن واضح‌تر (بدون سایه و کج‌شدگی) یا فایل متنی را بفرست." } : { ok: true, text };
}

/**
 * ورودی هوشمند: تصویر یا PDF اسکن‌شده ← متن (حداکثر VISION_MAX_PAGES صفحه‌ی اول).
 */
export async function ocrSmart(env: Env, bytes: ArrayBuffer, mime: string): Promise<OcrResult> {
  const u8 = new Uint8Array(bytes);
  let imgs: { bytes: Uint8Array; mime: string }[];
  if (mime === "application/pdf") {
    const found = await extractPdfImages(u8, undefined, { limit: VISION_MAX_PAGES, maxBytes: VISION_MAX_IMAGE_BYTES }).catch((e) => { console.error("pdf images", e instanceof Error ? e.message : e); return { images: [] as PdfImage[], pages: 0 }; });
    const usable = found.images.filter((j) => j.bytes.byteLength <= VISION_MAX_IMAGE_BYTES);
    if (!usable.length) {
      // استخراج مستقیم چیزی نداد (JBIG2/CCITT/JPX/CMYK/... یا تصویر خیلی بزرگ) ⇒ صفحه‌ها با مرورگر (pdf.js) رندر می‌شوند
      const rendered = await renderPdfPages(env, u8, VISION_MAX_PAGES, VISION_MAX_IMAGE_BYTES);
      if (rendered) return readMany(env, rendered);
      if (!found.images.length) {
        if (u8.byteLength <= OCR_MAX_BYTES) return ocrSpace(env, bytes, mime);
        return { ok: false, error: "این PDF اسکن است ولی تصاویر صفحه‌هایش در قالب قابل‌خواندن نیست؛ صفحه‌ها را به‌صورت عکس (JPG) بفرست." };
      }
      return { ok: false, error: "تصویر صفحه‌های این PDF بیش از حد بزرگ است؛ با کیفیت کمتر دوباره اسکن کن یا صفحه‌ها را به‌صورت عکس بفرست." };
    }
    imgs = usable.slice(0, VISION_MAX_PAGES);
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
  return r;
}
