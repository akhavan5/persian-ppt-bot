/** دریافت تصویر از Pexels (اختیاری). بدون PEXELS_API_KEY اسلایدها بدون تصویر ساخته می‌شوند. */
import type { Env } from "./env";
import type { Slide } from "./types";
import { IMAGE_BOX } from "./pptx";

const PX_W = 1200;
const PX_H = Math.round((PX_W * IMAGE_BOX.h) / IMAGE_BOX.w);

async function fetchOne(key: string, query: string): Promise<Uint8Array | null> {
  try {
    const r = await fetch(
      `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=1&orientation=landscape`,
      { headers: { Authorization: key }, signal: AbortSignal.timeout(10_000) },
    );
    if (!r.ok) return null;
    const photo = ((await r.json()) as any)?.photos?.[0];
    const src: string | undefined = photo?.src?.original;
    if (!src) return null;
    // سرور تصویر Pexels خودش برش (crop) هم‌اندازه‌ی کادر را انجام می‌دهد؛ پردازش تصویر در Worker لازم نیست
    const img = await fetch(`${src}?auto=compress&cs=tinysrgb&fit=crop&w=${PX_W}&h=${PX_H}`, {
      signal: AbortSignal.timeout(15_000),
    });
    return img.ok ? new Uint8Array(await img.arrayBuffer()) : null;
  } catch {
    return null;
  }
}

/** {شماره‌ی اسلاید → بایت‌های تصویر} برای اسلایدهای image_text */
export async function fetchImages(env: Env, slides: Slide[]): Promise<Map<number, Uint8Array>> {
  const out = new Map<number, Uint8Array>();
  const key = env.PEXELS_API_KEY;
  if (!key) return out;
  const idx = slides.flatMap((s, i) => (s.layout === "image_text" && s.image_query ? [i] : []));
  const res = await Promise.all(idx.map((i) => fetchOne(key, slides[i].image_query!)));
  idx.forEach((i, k) => { const r = res[k]; if (r) out.set(i, r); });
  return out;
}
