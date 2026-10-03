/** تصویر اسلاید: با Workers AI (مدل FLUX) ساخته می‌شود؛ بدون binding «AI» و با داشتن PEXELS_API_KEY از Pexels جستجو می‌شود.
 *  فعلاً در هر ارائه فقط یک تصویر ساخته می‌شود (MAX_IMAGES). */
import type { Env } from "./env";
import type { Slide } from "./types";
import { IMAGE_BOX } from "./pptx";

export const MAX_IMAGES = 1;
const MODEL_MAIN = "@cf/black-forest-labs/flux-1-schnell";
const MODEL_BACKUP = "@cf/bytedance/stable-diffusion-xl-lightning";
const STYLE = ", clean modern illustration for a presentation slide, soft lighting, high quality, no text, no letters, no watermark";

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

/** {شماره‌ی اسلاید → بایت‌های تصویر} برای اسلایدهای image_text (حداکثر MAX_IMAGES تا) */
export async function fetchImages(env: Env, slides: Slide[], max = MAX_IMAGES): Promise<Map<number, Uint8Array>> {
  const out = new Map<number, Uint8Array>();
  const idx = slides.flatMap((s, i) => (s.layout === "image_text" && s.image_query ? [i] : [])).slice(0, max);
  const res = await Promise.all(idx.map(async (i) => {
    const q = slides[i].image_query!;
    if (env.AI) return (await generate(env, MODEL_MAIN, q)) ?? (await generate(env, MODEL_BACKUP, q));
    return env.PEXELS_API_KEY ? pexels(env.PEXELS_API_KEY, q) : null;
  }));
  idx.forEach((i, k) => { const r = res[k]; if (r) out.set(i, r); });
  return out;
}
