/**
 * ورودی صوتی: تبدیل ویس و فایل صوتی تلگرام به متن با Deepgram (https://deepgram.com).
 * - DEEPGRAM_API_KEY: کلید API (می‌تواند چند کلید باشد، هر خط یا «;» یا «,» یکی؛ با خطای اعتبار/سقف/سرور کلید بعدی امتحان می‌شود). بدون آن ورودی صوتی خاموش است.
 * - DEEPGRAM_MODEL: اختیاری، پیش‌فرض nova-3 (فارسی «fa» روی Nova-3 پشتیبانی می‌شود)
 * - DEEPGRAM_LANGUAGE: اختیاری، پیش‌فرض fa؛ «auto» = تشخیص خودکار زبان، «multi» = چندزبانه
 * سقف روزانه‌ی هر کاربر مثل خواندن فایل (اعتبار ساخت ارائه + ۱۵) است، ولی شمارنده‌اش جدا از OCR است.
 */
import type { Env } from "./env";
import { hitLimit } from "./auth";
import { OCR_CAP_NOTE, ocrCap } from "./ocr-limit";
import { today, type Uid } from "./settings";

/** سقف انتظار برای Deepgram؛ خودِ Deepgram بعد از ۱۰ دقیقه 504 می‌دهد، پس کمی کمتر (فایل‌های بلند تا ۲۴ مگابایت ≈ ۲۰–۲۵ دقیقه صدا) */
const STT_TIMEOUT_MS = 9 * 60_000;

export const AUDIO_EXT = new Set(["mp3", "m4a", "wav", "ogg", "oga", "opus", "flac", "aac", "amr", "wma"]);
const MIME_BY_EXT: Record<string, string> = {
  mp3: "audio/mpeg", m4a: "audio/mp4", wav: "audio/wav", ogg: "audio/ogg", oga: "audio/ogg", opus: "audio/ogg",
  flac: "audio/flac", aac: "audio/aac", amr: "audio/amr", wma: "audio/x-ms-wma",
};

/** نوع محتوای فایل صوتی آپلودی وب ← پسوند (مرورگرها برای فایل صوتی نوع‌های گوناگونی می‌فرستند) */
export const AUDIO_TYPES = new Map<string, string>([
  ["audio/mpeg", "mp3"], ["audio/mp3", "mp3"], ["audio/mp4", "m4a"], ["audio/x-m4a", "m4a"], ["audio/m4a", "m4a"],
  ["audio/wav", "wav"], ["audio/x-wav", "wav"], ["audio/wave", "wav"], ["audio/ogg", "ogg"], ["audio/opus", "ogg"],
  ["audio/flac", "flac"], ["audio/x-flac", "flac"], ["audio/aac", "aac"], ["audio/amr", "amr"],
]);

const keysOf = (env: Env) => String(env.DEEPGRAM_API_KEY ?? "").split(/[\n;,]+/).map((k) => k.trim()).filter(Boolean);
export const deepgramEnabled = (env: Env) => keysOf(env).length > 0;

export type SttResult = { ok: true; text: string } | { ok: false; error: string };

/** ویس/فایل صوتی ← متن. خطاها پیام فارسی آماده برای کاربرند. */
export async function transcribeAudio(env: Env, bytes: ArrayBuffer, ext: string, userId: Uid): Promise<SttResult> {
  const keys = keysOf(env);
  if (!keys.length) return { ok: false, error: "ورودی صوتی فعال نیست؛ موضوع را به‌صورت متن بفرست." };
  if (await hitLimit(env, `stt:${userId}:${today()}`, await ocrCap(env, userId), 172_800)) {
    return { ok: false, error: `سقف روزانه‌ی تبدیل صدا به متن تمام شد؛ فردا دوباره امتحان کن. ${OCR_CAP_NOTE}` };
  }
  const lang = (env.DEEPGRAM_LANGUAGE || "fa").trim();
  const q = new URLSearchParams({ model: (env.DEEPGRAM_MODEL || "nova-3").trim(), smart_format: "true", punctuate: "true" });
  if (lang.toLowerCase() === "auto") q.set("detect_language", "true"); else q.set("language", lang);
  const start = Math.floor(Math.random() * keys.length);
  let last = "";
  for (let i = 0; i < keys.length; i++) {
    const key = keys[(start + i) % keys.length];
    try {
      const r = await fetch(`https://api.deepgram.com/v1/listen?${q}`, {
        method: "POST",
        headers: { Authorization: `Token ${key}`, "Content-Type": MIME_BY_EXT[ext] ?? "application/octet-stream" },
        body: bytes,
        signal: AbortSignal.timeout(STT_TIMEOUT_MS),
      });
      if (r.status === 400) return { ok: false, error: "فایل صوتی قابل‌خواندن نبود؛ ویس یا فایل صوتی دیگری را امتحان کن." };
      if (!r.ok) { last = `HTTP ${r.status} ${(await r.text().catch(() => "")).slice(0, 200)}`; continue; } // ۴۰۱/۴۰۲/۴۲۹/۵xx ⇒ کلید بعدی
      const j = (await r.json()) as { results?: { channels?: { alternatives?: { transcript?: string }[] }[] } };
      const text = (j.results?.channels ?? []).map((c) => c.alternatives?.[0]?.transcript ?? "").filter(Boolean).join("\n").trim();
      return text ? { ok: true, text } : { ok: false, error: "صدایی که قابل‌تشخیص باشد در فایل پیدا نشد؛ واضح‌تر بگو یا دوباره بفرست." };
    } catch (e) {
      last = e instanceof Error ? e.message : String(e);
      if (e instanceof Error && e.name === "TimeoutError") break; // کلید بعدی هم همین‌قدر طول می‌کشد؛ ۹ دقیقه‌ی دیگر منتظر نمان
    }
  }
  console.error("deepgram", last);
  return { ok: false, error: "تبدیل صدا به متن ناموفق بود؛ چند لحظه بعد دوباره امتحان کن." };
}
