/**
 * نسخه‌ی PDF ارائه برای ربات تلگرام (سمت سرور).
 * همان صفحه‌ی HTML پیش‌نمایش وب (renderPreview) در مرورگر بدون‌سر کلودفلر (Browser Rendering) باز و به PDF تبدیل می‌شود؛
 * پس فونت فارسی (Vazirmatn از Google Fonts)، راست‌به‌چپ، نمودارها و تصویرها دقیقاً مثل پیش‌نمایش وب درمی‌آیند.
 * هر اسلاید یک صفحه است؛ یادداشت سخنرانی مثل پیش‌نمایش وب در کادری زیر همان اسلاید می‌آید (صفحه ۱۳٫۳۳×۱۰ اینچ؛ اگر هیچ اسلایدی یادداشت نداشته باشد ۱۳٫۳۳×۷٫۵).
 *
 * سهمیه: پلن رایگان Workers = ۱۰ دقیقه مرورگر در روز؛ برای همین PDF فقط با دکمه‌ی کاربر ساخته می‌شود (نه خودکار برای همه)،
 * نتیجه ۲۴ ساعت در KV نگه داشته می‌شود تا کلیک دوباره مرورگر جدید نخواهد، و سقف روزانه‌ی هر کاربر در bot.ts اعمال می‌شود.
 */
import puppeteer from "@cloudflare/puppeteer";
import JSZip from "jszip";
import type { Env } from "./env";
import type { Uid } from "./settings";
import { loadFileDirect, loadPreview } from "./files";
import { pdfPageHeight, renderPreview } from "./preview";

const TTL = 24 * 60 * 60;
const pdfKey = (userId: Uid, id: string) => `pdf:${userId}:${id}`;

export type PdfResult = { ok: true; data: Uint8Array; title: string } | { ok: false; error: string };

function toBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

/** PDF ذخیره‌شده (اگر قبلاً ساخته شده)، بدون مصرف مرورگر */
export async function cachedPdf(env: Env, userId: Uid, id: string): Promise<Uint8Array | null> {
  const r = await env.FILES.get(pdfKey(userId, id), "arrayBuffer");
  return r ? new Uint8Array(r) : null;
}

/** راه‌اندازی مرورگر؛ اگر کلودفلر به‌خاطر محدودیت تعداد مرورگر تازه در دقیقه/هم‌زمانی ۴۲۹ داد، چند بار با فاصله دوباره تلاش می‌کند */
async function launchWithRetry(env: Env) {
  const waits = [3000, 7000, 12000];
  for (let i = 0; ; i++) {
    try {
      return await puppeteer.launch(env.BROWSER!);
    } catch (e) {
      const msg = String(e instanceof Error ? e.message : e);
      console.error("pdf launch", i + 1, msg.slice(0, 300)); // متن کامل خطا برای عیب‌یابی
      if (i >= waits.length || !/429|rate|too many|concurrent|limit/i.test(msg)) throw e;
      await new Promise((r) => setTimeout(r, waits[i]));
    }
  }
}

export async function buildDeckPdf(env: Env, userId: Uid, id: string): Promise<PdfResult> {
  const p = await loadPreview(env, userId, id);
  if (!p) return { ok: false, error: "⌛️ این ارائه منقضی شده است (ارائه‌ها ۲۴ ساعت نگه داشته می‌شوند)." };
  if (!env.BROWSER) return { ok: false, error: "⚠️ ساخت PDF روی این سرویس فعال نیست." };

  // تصویرهای اسلایدها از داخل فایل PPTX بیرون کشیده و به‌صورت data: URI در صفحه گذاشته می‌شوند (مرورگر بدون‌سر به نشست کاربر دسترسی ندارد)
  const pdfImgs: Record<number, string> = {};
  if (p.images.length) {
    const f = await loadFileDirect(env, userId, id).catch(() => null);
    if (f) {
      const zip = await JSZip.loadAsync(f.data);
      for (const i of p.images) {
        const name = Object.keys(zip.files).find((n) => n.startsWith(`ppt/media/image-${i + 1}-`));
        if (!name) continue;
        const bytes = await zip.files[name].async("uint8array");
        pdfImgs[i] = `data:${/\.png$/i.test(name) ? "image/png" : "image/jpeg"};base64,${toBase64(bytes)}`;
      }
    }
  }

  const html = renderPreview(p.deck, { id, theme: p.theme, font: p.font, digits: p.digits, images: p.images, nonce: "", pdf: pdfImgs });
  const browser = await launchWithRetry(env);
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle0", timeout: 40_000 });
    await page.evaluate("document.fonts.ready.then(function(){return 1})"); // فونت وب کامل بارگذاری شود
    const buf = await page.pdf({ width: "13.333in", height: `${pdfPageHeight(p.deck)}in`, printBackground: true, preferCSSPageSize: true });
    const data = new Uint8Array(buf);
    if (data.byteLength < 1000) return { ok: false, error: "⚠️ ساخت PDF ناموفق بود؛ کمی بعد دوباره امتحان کن." };
    if (data.byteLength <= 24 * 1024 * 1024) await env.FILES.put(pdfKey(userId, id), data, { expirationTtl: TTL }).catch((e) => console.error("pdf cache", e));
    return { ok: true, data, title: p.deck.title };
  } finally {
    await browser.close().catch(() => {});
  }
}
