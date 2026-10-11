/**
 * تبدیل تصویر / PDF اسکن‌شده به متن (OCR) با API رایگان ocr.space.
 * فایل‌های متنی، Word، PowerPoint، Excel و PDF متنی در خود مرورگر خوانده می‌شوند و به این‌جا نمی‌رسند؛
 * این مسیر فقط برای تصویر و PDF بدون لایه‌ی متن است.
 *
 * محدودیت سطح رایگان: ۱ مگابایت برای هر فایل. کلید رایگان: https://ocr.space/ocrapi/freekey (متغیر OCR_SPACE_API_KEY).
 * بدون کلید، کلید دموی عمومی استفاده می‌شود که سقف درخواستش بسیار کم است.
 * موتور ۳ (OCREngine=3) فارسی را با تشخیص خودکار زبان می‌خواند؛ موتور ۱ منسوخ شده و کد زبان «ara» را دیگر نمی‌پذیرد (خطای E201).
 * سقف سطح رایگان برای موتور ۳: ۱۰۰۰ تبدیل در ماه (جدا از ۲۵٬۰۰۰ تبدیل موتور ۱/۲). متن خروجی فقط ورودی مدل است و قبل از استفاده نرمال‌سازی می‌شود.
 */
import type { Env } from "./env";

export const OCR_MAX_BYTES = 1_000_000;
export const OCR_TYPES = new Set(["image/png", "image/jpeg", "application/pdf"]);

/** ی/ک عربی ← فارسی، حذف اعراب و کشیده */
const normFa = (s: string) => s.replace(/ي/g, "ی").replace(/ى/g, "ی").replace(/ك/g, "ک").replace(/[\u064B-\u065F\u0640]/g, "");

type OcrRes = { ok: true; text: string } | { ok: false; error: string; retry?: boolean };

/** موتور ۳ گاهی خطای داخلی (E580/۵xx) می‌دهد؛ چند بار دوباره امتحان می‌کنیم. موتور ۲ فارسی بلد نیست و متن بی‌معنی لاتین برمی‌گرداند، پس عمداً به آن برنمی‌گردیم. */
export async function ocrSpace(env: Env, bytes: ArrayBuffer, mime: string): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  let last: OcrRes = { ok: false, error: "سرویس تبدیل تصویر به متن در دسترس نیست؛ کمی بعد دوباره امتحان کن." };
  for (const engine of ["3", "3", "3"]) {
    last = await ocrOnce(env, bytes, mime, engine);
    if (last.ok || !last.retry) break;
  }
  return last.ok ? last : { ok: false, error: last.error };
}

async function ocrOnce(env: Env, bytes: ArrayBuffer, mime: string, engine: string): Promise<OcrRes> {
  const form = new FormData();
  form.append("file", new Blob([bytes], { type: mime }), mime === "application/pdf" ? "scan.pdf" : mime === "image/png" ? "scan.png" : "scan.jpg");
  // موتور ۳: تشخیص خودکار زبان (فارسی هم پشتیبانی می‌شود)؛ پارامتر language عمداً فرستاده نمی‌شود
  form.append("OCREngine", engine);
  form.append("scale", "true");
  form.append("isOverlayRequired", "false");
  let r: Response;
  try {
    r = await fetch("https://api.ocr.space/parse/image", {
      method: "POST",
      headers: { apikey: (env.OCR_SPACE_API_KEY || "helloworld").trim() },
      body: form,
      signal: AbortSignal.timeout(28_000),
    });
  } catch (e) {
    console.error("ocr fetch", e instanceof Error ? e.message : e);
    return { ok: false, retry: true, error: "سرویس تبدیل تصویر به متن پاسخ نداد؛ کمی بعد دوباره امتحان کن." };
  }
  if (!r.ok) {
    const body = await r.text().catch(() => "");
    console.error("ocr http", engine, r.status, body.slice(0, 300), "key:", env.OCR_SPACE_API_KEY ? "custom" : "demo(helloworld)");
    if (r.status === 403 || r.status === 429)
      return { ok: false, error: env.OCR_SPACE_API_KEY ? "سقف درخواست سرویس OCR تمام شده است؛ کمی بعد دوباره امتحان کن." : "سرویس OCR با کلید عمومی (دمو) رد شد؛ مدیر باید کلید OCR_SPACE_API_KEY را تنظیم کند." };
    return { ok: false, retry: r.status >= 500, error: "سرویس تبدیل تصویر به متن در دسترس نیست؛ کمی بعد دوباره امتحان کن." };
  }
  const j = (await r.json().catch(() => null)) as any;
  if (!j || j.IsErroredOnProcessing || !Array.isArray(j.ParsedResults)) {
    console.error("ocr error", JSON.stringify(j?.ErrorMessage ?? j?.OCRExitCode ?? "unknown").slice(0, 300));
    return { ok: false, retry: true, error: "متنی از تصویر خوانده نشد؛ تصویر واضح‌تر یا فایل متنی را امتحان کن." };
  }
  const text = normFa(j.ParsedResults.map((p: any) => String(p?.ParsedText ?? "")).join("\n")).replace(/\s+\n/g, "\n").trim();
  if (text.length < 20) return { ok: false, error: "متن قابل‌خواندنی در تصویر پیدا نشد." };
  // متن بی‌معنی (فارسی که لاتینِ دارای نشانه خوانده شده، مثل «ÇiÇ lůl») ← خطا، نه ساخت اسلاید از آشغال
  const letters = (text.match(/[A-Za-z\u00C0-\u024F\u0600-\u06FF]/g) ?? []).length;
  const odd = (text.match(/[\u00C0-\u024F]/g) ?? []).length;
  const fa = (text.match(/[\u0600-\u06FF]/g) ?? []).length;
  if (letters && odd / letters > 0.05 && fa / letters < 0.3)
    return { ok: false, error: "کیفیت تشخیص متن پایین بود و نتیجه قابل‌اعتماد نیست؛ عکس واضح‌تر (بدون سایه و کج‌شدگی) یا فایل متنی را بفرست." };
  return { ok: true, text };
}
