/**
 * رندر صفحه‌های PDF به JPEG با مرورگر کلودفلر (Browser Rendering) + pdf.js از CDN.
 * فقط وقتی استفاده می‌شود که استخراج مستقیم تصویر از PDF (pdf-images.ts) چیزی پیدا نکند:
 * JBIG2، CCITT، JPX، CMYK، Indexed، تصویر ۱ بیتی، چند فیلتر پشت هم و ... را pdf.js خودش دیکد می‌کند.
 * اگر BROWSER تعریف نشده باشد یا هر مشکلی پیش بیاید، null برمی‌گردد و پیام قبلی به کاربر نمایش داده می‌شود.
 */
import type { Env } from "./env";
import { launchWithRetry } from "./pdf";

/** نسخه‌ی pdf.js ثابت است تا رفتار رندر عوض نشود */
export const PDFJS_VERSION = "6.2.108";
export const PDFJS_ROOT = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VERSION}`;
/** build «legacy»: روی مرورگرهای کمی قدیمی‌تر هم کار می‌کند (build عادی از قابلیت‌های جدید JS مثل Map.getOrInsertComputed استفاده می‌کند) */
export const PDFJS_BASE = `${PDFJS_ROOT}/legacy/build`;

const PAGE_HTML = `<!doctype html><html><body><script type="module">
import * as pdfjs from "${PDFJS_BASE}/pdf.min.mjs";
pdfjs.GlobalWorkerOptions.workerSrc = "${PDFJS_BASE}/pdf.worker.min.mjs";
window.__render = async (b64, maxPages, targetW) => {
  const bin = atob(b64), u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  // wasm برای JBIG2/JPX لازم است (بدون wasmUrl دیکد نمی‌شود)
  const task = pdfjs.getDocument({ data: u8, wasmUrl: "${PDFJS_ROOT}/wasm/", iccUrl: "${PDFJS_ROOT}/iccs/", cMapUrl: "${PDFJS_ROOT}/cmaps/", cMapPacked: true, standardFontDataUrl: "${PDFJS_ROOT}/standard_fonts/" });
  const pdf = await task.promise;
  const n = Math.min(pdf.numPages, maxPages), images = [];
  for (let i = 1; i <= n; i++) {
    const pg = await pdf.getPage(i);
    const v1 = pg.getViewport({ scale: 1 });
    const sc = Math.max(0.3, Math.min(3, targetW / v1.width, 4000 / v1.height));
    const vp = pg.getViewport({ scale: sc });
    const c = document.createElement("canvas");
    c.width = Math.ceil(vp.width); c.height = Math.ceil(vp.height);
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height);
    await pg.render({ canvasContext: ctx, viewport: vp }).promise;
    let q = 0.8, d = c.toDataURL("image/jpeg", q);
    while (d.length > 5200000 && q > 0.35) { q -= 0.15; d = c.toDataURL("image/jpeg", q); } // ≈ زیر ۴ مگابایت بایت
    images.push(d.slice(d.indexOf(",") + 1));
    pg.cleanup();
  }
  await task.destroy();
  window.__done = true;
  return { pages: pdf.numPages, images };
};
window.__ready = true;
</script></body></html>`;

const toB64 = (u8: Uint8Array) => {
  let s = "";
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  return btoa(s);
};
const fromB64 = (b: string) => Uint8Array.from(atob(b), (c) => c.charCodeAt(0));

/** صفحه‌های PDF ← JPEG (حداکثر maxPages صفحه‌ی اول)؛ هر خطا ⇒ null */
export async function renderPdfPages(env: Env, bytes: Uint8Array, maxPages: number, maxImageBytes: number, setup?: (page: any) => Promise<void>): Promise<{ bytes: Uint8Array; mime: "image/jpeg" }[] | null> {
  if (!env.BROWSER) return null;
  let browser: Awaited<ReturnType<typeof launchWithRetry>> | null = null;
  try {
    browser = await launchWithRetry(env);
    const page = await browser.newPage();
    if (setup) await setup(page);
    await page.setContent(PAGE_HTML, { waitUntil: "load", timeout: 30_000 });
    await page.waitForFunction("window.__ready === true", { timeout: 30_000 }); // ماژول pdf.js از CDN بارگذاری شود
    const res = (await page.evaluate(`window.__render(${JSON.stringify(toB64(bytes))}, ${maxPages}, 1400)`)) as { pages: number; images: string[] };
    const out = (res?.images ?? []).map(fromB64).filter((b) => b.byteLength > 1000 && b.byteLength <= maxImageBytes);
    return out.length ? out.map((b) => ({ bytes: b, mime: "image/jpeg" as const })) : null;
  } catch (e) {
    console.error("pdf render", e instanceof Error ? e.message.slice(0, 300) : e);
    return null;
  } finally {
    await browser?.close().catch(() => {});
  }
}
