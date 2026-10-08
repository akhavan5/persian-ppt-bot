/**
 * تبدیل تصویر / PDF اسکن‌شده به متن (OCR) با API رایگان ocr.space.
 * فایل‌های متنی، Word، PowerPoint، Excel و PDF متنی در خود مرورگر خوانده می‌شوند و به این‌جا نمی‌رسند؛
 * این مسیر فقط برای تصویر و PDF بدون لایه‌ی متن است.
 *
 * محدودیت سطح رایگان: ۱ مگابایت برای هر فایل. کلید رایگان: https://ocr.space/ocrapi/freekey (متغیر OCR_SPACE_API_KEY).
 * بدون کلید، کلید دموی عمومی استفاده می‌شود که سقف درخواستش بسیار کم است.
 * دقت OCR برای فارسی محدود است (موتور ۱ با زبان عربی)؛ متن خروجی فقط ورودی مدل است و قبل از استفاده نرمال‌سازی می‌شود.
 */
import type { Env } from "./env";

export const OCR_MAX_BYTES = 1_000_000;
export const OCR_TYPES = new Set(["image/png", "image/jpeg", "application/pdf"]);

/** ی/ک عربی ← فارسی، حذف اعراب و کشیده */
const normFa = (s: string) => s.replace(/ي/g, "ی").replace(/ى/g, "ی").replace(/ك/g, "ک").replace(/[\u064B-\u065F\u0640]/g, "");

export async function ocrSpace(env: Env, bytes: ArrayBuffer, mime: string): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  const form = new FormData();
  form.append("file", new Blob([bytes], { type: mime }), mime === "application/pdf" ? "scan.pdf" : mime === "image/png" ? "scan.png" : "scan.jpg");
  form.append("language", "ara");
  form.append("OCREngine", "1");
  form.append("scale", "true");
  form.append("detectOrientation", "true");
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
    return { ok: false, error: "سرویس تبدیل تصویر به متن پاسخ نداد؛ کمی بعد دوباره امتحان کن." };
  }
  if (!r.ok) return { ok: false, error: "سرویس تبدیل تصویر به متن در دسترس نیست؛ کمی بعد دوباره امتحان کن." };
  const j = (await r.json().catch(() => null)) as any;
  if (!j || j.IsErroredOnProcessing || !Array.isArray(j.ParsedResults)) {
    console.error("ocr error", JSON.stringify(j?.ErrorMessage ?? j?.OCRExitCode ?? "unknown").slice(0, 300));
    return { ok: false, error: "متنی از تصویر خوانده نشد؛ تصویر واضح‌تر یا فایل متنی را امتحان کن." };
  }
  const text = normFa(j.ParsedResults.map((p: any) => String(p?.ParsedText ?? "")).join("\n")).replace(/\s+\n/g, "\n").trim();
  return text.length < 20 ? { ok: false, error: "متن قابل‌خواندنی در تصویر پیدا نشد." } : { ok: true, text };
}
