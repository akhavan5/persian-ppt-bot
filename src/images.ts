/** تصویر اسلاید: با Workers AI (مدل FLUX) ساخته می‌شود؛ بدون binding «AI» و با داشتن PEXELS_API_KEY از Pexels جستجو می‌شود.
 *  فعلاً در هر ارائه فقط یک تصویر ساخته می‌شود (MAX_IMAGES). */
import type { Env } from "./env";
import type { Slide } from "./types";
import { IMAGE_BOX } from "./pptx";

export const MAX_IMAGES = 1;
const MODEL_MAIN = "@cf/black-forest-labs/flux-1-schnell";
const MODEL_BACKUP = "@cf/bytedance/stable-diffusion-xl-lightning";
const STYLE = ", professional presentation slide image, subject large and centered filling the frame, detailed, vivid colors, high quality, no text, no letters, no watermark";

const PX_W = 1200;
const PX_H = Math.round((PX_W * IMAGE_BOX.h) / IMAGE_BOX.w);

const withTimeout = <T>(p: Promise<T>, ms: number): Promise<T> =>
  Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error("timeout")), ms))]);

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

async function generate(env: Env, model: string, query: string): Promise<Uint8Array | null> {
  const input = model === MODEL_MAIN ? { prompt: query + STYLE, steps: 4 } : { prompt: query + STYLE, num_steps: 8 };
  try {
    return await toBytes(await withTimeout((env.AI as any).run(model, input), 45_000));
  } catch (e) {
    console.error("image gen failed", model, String(e).slice(0, 200));
    return null;
  }
}

async function pexels(key: string, query: string): Promise<Uint8Array | null> {
  try {
    const r = await fetch(
      `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=1&orientation=landscape`,
      { headers: { Authorization: key }, signal: AbortSignal.timeout(10_000) },
    );
    if (!r.ok) return null;
    const src: string | undefined = ((await r.json()) as any)?.photos?.[0]?.src?.original;
    if (!src) return null;
    const img = await fetch(`${src}?auto=compress&cs=tinysrgb&fit=crop&w=${PX_W}&h=${PX_H}`, { signal: AbortSignal.timeout(15_000) });
    return img.ok ? new Uint8Array(await img.arrayBuffer()) : null;
  } catch {
    return null;
  }
}

/** نسخه‌ی وب: تصویر از همان API سازگار با OpenAI (همان OPENAI_BASE_URL و OPENAI_API_KEY) گرفته می‌شود، نه از Workers AI/Pexels.
 *  مدل با OPENAI_IMAGE_MODEL (پیش‌فرض dall-e-3) و اندازه با OPENAI_IMAGE_SIZE (اختیاری) تنظیم می‌شود. */
async function viaApi(env: Env, query: string): Promise<Uint8Array | null> {
  const base = (env.OPENAI_BASE_URL || "https://api.gapgpt.app/v1").replace(/\/+$/, "");
  const headers = { "content-type": "application/json", authorization: `Bearer ${env.OPENAI_API_KEY}` };
  // اگر آدرس API از نوع OpenAI-compatible کلودفلر باشد (…/accounts/ID/ai/v1)، آن /images/generations را ندارد؛
  // تصویر باید از مسیر …/ai/run/<model> گرفته شود (خروجی: {result:{image:base64}} یا خود تصویر)
  const runBase = (env.OPENAI_IMAGE_BASE_URL || "").trim().replace(/\/+$/, "");
  const cf = !!runBase || /api\.cloudflare\.com\/client\/v4\/accounts\/[^/]+\/ai\/v1$/.test(base);
  try {
    if (cf) {
      const model = env.OPENAI_IMAGE_MODEL || MODEL_MAIN;
      const url = `${runBase || base.replace(/\/v1$/, "/run")}/${model}`;
      let r: Response;
      if (/flux-2/i.test(model)) {
        // خانواده‌ی FLUX.2 ورودی را فقط به‌صورت multipart/form-data می‌پذیرد
        const f = new FormData();
        f.append("prompt", query + STYLE);
        f.append("width", "1024");
        f.append("height", "832");
        r = await fetch(url, { method: "POST", headers: { authorization: headers.authorization }, body: f, signal: AbortSignal.timeout(90_000) });
      } else {
        const input = /flux/i.test(model) ? { prompt: query + STYLE, steps: 4 } : { prompt: query + STYLE, num_steps: 8 };
        r = await fetch(url, { method: "POST", headers, body: JSON.stringify(input), signal: AbortSignal.timeout(60_000) });
      }
      if (!r.ok) { console.error("image api", r.status, (await r.text()).slice(0, 200)); return null; }
      if ((r.headers.get("content-type") || "").startsWith("image/")) return await toBytes(new Uint8Array(await r.arrayBuffer()));
      const j = (await r.json()) as any;
      return await toBytes({ image: j?.result?.image ?? j?.image });
    }
    const model = env.OPENAI_IMAGE_MODEL || "dall-e-3";
    const size = env.OPENAI_IMAGE_SIZE || (/gpt-image/i.test(model) ? "1536x1024" : "1792x1024");
    const r = await fetch(`${base}/images/generations`, {
      method: "POST", headers, body: JSON.stringify({ model, prompt: query + STYLE, n: 1, size }),
      signal: AbortSignal.timeout(90_000),
    });
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

/** {شماره‌ی اسلاید → بایت‌های تصویر} برای اسلایدهای image_text (حداکثر MAX_IMAGES تا) */
export async function fetchImages(env: Env, slides: Slide[], max = MAX_IMAGES, useApi = false): Promise<Map<number, Uint8Array>> {
  const out = new Map<number, Uint8Array>();
  const idx = slides.flatMap((s, i) => (s.layout === "image_text" && s.image_query ? [i] : [])).slice(0, max);
  const res = await Promise.all(idx.map(async (i) => {
    const q = slides[i].image_query!;
    if (useApi && env.OPENAI_API_KEY) { const r = await viaApi(env, q); if (r) return r; } // اگر API تصویر نداد، به Workers AI/Pexels برمی‌گردد
    if (env.AI) return (await generate(env, MODEL_MAIN, q)) ?? (await generate(env, MODEL_BACKUP, q));
    return env.PEXELS_API_KEY ? pexels(env.PEXELS_API_KEY, q) : null;
  }));
  idx.forEach((i, k) => { const r = res[k]; if (r) out.set(i, r); });
  return out;
}
