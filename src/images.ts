/** تصویر اسلاید (وب و تلگرام): فقط از همان API مدل‌های اصلی (OPENAI_API_KEY، با چرخش حساب‌ها) ساخته می‌شود؛
 *  Workers AI (binding) و Pexels استفاده نمی‌شوند. اگر API تصویر ندهد، اسلاید بدون تصویر می‌ماند.
 *  تعداد تصویر هر ارائه از بیرون می‌آید (وب: رایگان ۱، پلاس ۳، پرو ۶ — تلگرام: MAX_IMAGES = ۱). */
import type { Env } from "./env";
import type { Slide } from "./types";
import { IMAGE_BOX } from "./pptx";
import { fetchWithAccounts, parseAccounts } from "./accounts";

export const MAX_IMAGES = 1;
/** فاصله‌ی شروع درخواست تصویرها (میلی‌ثانیه): تصویر دوم ۳ ثانیه بعد از اول، سوم ۶ ثانیه بعد و ... */
const IMAGE_STAGGER_MS = 3000;
const MODEL_MAIN = "@cf/black-forest-labs/flux-1-schnell";
const STYLE = ", professional presentation slide image, subject large and centered filling the frame, detailed, vivid colors, high quality, no text, no letters, no watermark";

const PX_W = 1200;
const PX_H = Math.round((PX_W * IMAGE_BOX.h) / IMAGE_BOX.w);

const fromBase64 = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

/** مدل‌های مختلف خروجی را متفاوت برمی‌گردانند: {image: base64}، جریان باینری یا بایت خام */
async function toBytes(out: unknown): Promise<Uint8Array | null> {
  let b: Uint8Array | null = null;
  if (out instanceof ReadableStream) b = new Uint8Array(await new Response(out).arrayBuffer());
  else if (out instanceof ArrayBuffer) b = new Uint8Array(out);
  else if (out instanceof Uint8Array) b = out;
  else if (typeof (out as any)?.image === "string") b = fromBase64((out as any).image);
  return b && b.length > 1000 ? b : null; // فایل خیلی کوچک = خروجی خراب
}

/** تصویر از همان API سازگار با OpenAI (همان OPENAI_BASE_URL و OPENAI_API_KEY) گرفته می‌شود، نه از Workers AI/Pexels.
 *  مدل با OPENAI_IMAGE_MODEL (پیش‌فرض dall-e-3) و اندازه با OPENAI_IMAGE_SIZE (اختیاری) تنظیم می‌شود. */
async function viaApi(env: Env, query: string): Promise<Uint8Array | null> {
  const pool = parseAccounts(env); // OPENAI_API_KEY ممکن است فهرستی از حساب‌ها باشد؛ چرخش مثل LLM
  if (!pool.length) return null;
  // اگر آدرس API از نوع OpenAI-compatible کلودفلر باشد (…/accounts/ID/ai/v1)، آن /images/generations را ندارد؛
  // تصویر باید از مسیر …/ai/run/<model> گرفته شود (خروجی: {result:{image:base64}} یا خود تصویر)
  try {
    if (pool[0].cf) {
      const model = env.OPENAI_IMAGE_MODEL || MODEL_MAIN;
      const r = await fetchWithAccounts(env, (a) => {
        const url = `${a.runBase}/${model}`;
        if (/flux-2/i.test(model)) {
          // خانواده‌ی FLUX.2 ورودی را فقط به‌صورت multipart/form-data می‌پذیرد
          const f = new FormData();
          f.append("prompt", query + STYLE);
          f.append("width", "1024");
          f.append("height", "832");
          return fetch(url, { method: "POST", headers: { authorization: `Bearer ${a.token}` }, body: f, signal: AbortSignal.timeout(90_000) });
        }
        const input = /flux/i.test(model) ? { prompt: query + STYLE, steps: 4 } : { prompt: query + STYLE, num_steps: 8 };
        return fetch(url, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${a.token}` }, body: JSON.stringify(input), signal: AbortSignal.timeout(60_000) });
      });
      if (!r.ok) { console.error("image api", r.status, (await r.text()).slice(0, 200)); return null; }
      if ((r.headers.get("content-type") || "").startsWith("image/")) return await toBytes(new Uint8Array(await r.arrayBuffer()));
      const j = (await r.json()) as any;
      return await toBytes({ image: j?.result?.image ?? j?.image });
    }
    const model = env.OPENAI_IMAGE_MODEL || "dall-e-3";
    const size = env.OPENAI_IMAGE_SIZE || (/gpt-image/i.test(model) ? "1536x1024" : "1792x1024");
    const r = await fetchWithAccounts(env, (a) => fetch(`${a.base}/images/generations`, {
      method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${a.token}` },
      body: JSON.stringify({ model, prompt: query + STYLE, n: 1, size }), signal: AbortSignal.timeout(90_000),
    }));
    if (!r.ok) { console.error("image api", r.status, (await r.text()).slice(0, 200)); return null; }
    const d = ((await r.json()) as any)?.data?.[0];
    let b: Uint8Array | null = null;
    if (typeof d?.b64_json === "string") b = fromBase64(d.b64_json);
    else if (typeof d?.url === "string") {
      const img = await fetch(d.url, { signal: AbortSignal.timeout(30_000) });
      if (img.ok) b = new Uint8Array(await img.arrayBuffer());
    }
    return b && b.length > 1000 ? b : null;
  } catch (e) {
    console.error("image api failed", String(e).slice(0, 200));
    return null;
  }
}

/** {شماره‌ی اسلاید → بایت‌های تصویر} برای اسلایدهای image_text (حداکثر MAX_IMAGES تا).
 *  پارامتر useApi فقط برای سازگاری با فراخوانی‌های قبلی مانده و بی‌اثر است: همه‌ی کانال‌ها از API می‌گیرند. */
export async function fetchImages(env: Env, slides: Slide[], max = MAX_IMAGES, _useApi = true): Promise<Map<number, Uint8Array>> {
  const out = new Map<number, Uint8Array>();
  const idx = slides.flatMap((s, i) => (s.layout === "image_text" && s.image_query ? [i] : [])).slice(0, max);
  // بین شروع درخواست هر تصویر چند ثانیه فاصله است تا درخواست‌ها هم‌زمان به Workers AI نرسند (هم‌زمانی گاهی یکی را در صف نگه می‌دارد و تایم‌اوت می‌شود)
  const res = await Promise.all(idx.map(async (i, k) => {
    if (k) await new Promise((r) => setTimeout(r, k * IMAGE_STAGGER_MS));
    return viaApi(env, slides[i].image_query!);
  }));
  idx.forEach((i, k) => { const r = res[k]; if (r) out.set(i, r); });
  return out;
}
