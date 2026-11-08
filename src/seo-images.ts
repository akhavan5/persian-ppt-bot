// سئوی تصویر: مسیر تصویرهای اختصاصی هر صفحه/مقاله (تولید با scripts/gen-seo-images.py)، <figure>، ImageObject و تگ‌های sitemap تصویر.
// نام فایل‌ها باید با اسکریپت تولید تصویر هماهنگ بماند.
import { BRAND, esc } from "./landing";
import type { Section } from "./landing-data";

export type ImgKind = "landing" | "blog";
export interface Img { path: string; w: number; h: number }

/** بخش «مرحله‌ای» که برایش تصویر مراحل ساخته می‌شود (همان شرط howToNode و اسکریپت تولید). */
export const stepsSection = (sections: Section[]) => sections.find((x) => x.steps && x.steps.length >= 3);

export function heroImages(kind: ImgKind, slug: string) {
  const b = `/img/${kind}/${slug}`;
  return {
    og: { path: `${b}.png`, w: 1200, h: 630 } as Img,
    webp: { path: `${b}.webp`, w: 1200, h: 630 } as Img,
    small: { path: `${b}-640.webp`, w: 640, h: 336 } as Img,
    // نسبت‌های ۱:۱ و ۴:۳ (فقط مقاله‌ها) برای Article rich results
    sq: kind === "blog" ? ({ path: `${b}-1x1.webp`, w: 1080, h: 1080 } as Img) : undefined,
    r43: kind === "blog" ? ({ path: `${b}-4x3.webp`, w: 1200, h: 900 } as Img) : undefined,
  };
}
export const stepsImage = (kind: ImgKind, slug: string): Img => ({ path: `/img/${kind === "blog" ? "blog-steps" : "steps"}/${slug}.webp`, w: 1200, h: 630 });

export const heroAlt = (nav: string) => `${nav}: نمونه‌ی اسلاید فارسی راست‌به‌چپ ساخته‌شده با ${BRAND}`;
export function stepsAlt(heading: string, steps: { t: string }[]): string {
  const t = steps.map((s) => s.t).join("، ");
  return `مراحل «${heading}»: ${t.length > 190 ? t.slice(0, 187) + "…" : t}`;
}

/** تصویر اصلی بالای صفحه: <picture> با srcset وب‌پی، ابعاد ثابت (بدون CLS) و بارگذاری با اولویت (LCP). */
export function heroFigure(kind: ImgKind, slug: string, alt: string, caption: string): string {
  const h = heroImages(kind, slug);
  return `<figure class="fig hero-fig"><img src="${h.webp.path}" srcset="${h.small.path} 640w, ${h.webp.path} 1200w" sizes="(max-width:760px) 100vw, 860px" width="1200" height="630" alt="${esc(alt)}" fetchpriority="high" decoding="async"><figcaption>${esc(caption)}</figcaption></figure>`;
}
export function stepsFigure(kind: ImgKind, slug: string, alt: string, caption: string): string {
  const i = stepsImage(kind, slug);
  return `<figure class="fig"><img src="${i.path}" width="${i.w}" height="${i.h}" alt="${esc(alt)}" loading="lazy" decoding="async"><figcaption>${esc(caption)}</figcaption></figure>`;
}
/** پیش‌بارگذاری تصویر LCP در <head>. */
export function heroPreload(kind: ImgKind, slug: string): string {
  const h = heroImages(kind, slug);
  return `<link rel="preload" as="image" href="${h.webp.path}" imagesrcset="${h.small.path} 640w, ${h.webp.path} 1200w" imagesizes="(max-width:760px) 100vw, 860px" fetchpriority="high">`;
}

export const IMG_CSS = `
.fig{margin:22px 0;text-align:center}
.fig img{display:block;width:100%;height:auto;aspect-ratio:1200/630;border-radius:var(--radius);border:1px solid var(--line);box-shadow:var(--shadow);background:var(--soft)}
.fig figcaption{margin-top:8px;color:var(--muted);font-size:.86rem;line-height:1.7}
.hero-fig{margin:6px 0 24px}`;

/** گره ImageObject داده‌ی ساختاریافته (با سازنده و اعتبار تصویر برای گوگل ایمیج). */
export function imageNode(site: string, img: Img, caption: string, id?: string) {
  const url = `${site}${img.path}`;
  return {
    "@type": "ImageObject", "@id": id ?? `${url}#image`, url, contentUrl: url, width: img.w, height: img.h, caption, name: caption, inLanguage: "fa-IR",
    encodingFormat: img.path.endsWith(".png") ? "image/png" : "image/webp", creditText: BRAND, creator: { "@id": `${site}/#org` }, copyrightNotice: `© ${BRAND}`,
  };
}

/** تگ‌های <image:image> در sitemap؛ گوگل فقط image:loc را می‌خواند. */
export const imageTags = (site: string, paths: string[]) => [...new Set(paths)].map((p) => `    <image:image><image:loc>${site}${p}</image:loc></image:image>\n`).join("");

export const HOME_IMAGES = ["/og-image.png", ...["ocean", "forest", "sunset", "royal", "violet", "midnight"].map((k) => `/img/home/template-${k}.webp`)];

/** همه‌ی تصویرهای یک صفحه برای sitemap. */
export function pageImagePaths(kind: ImgKind, slug: string, hasSteps: boolean): string[] {
  const h = heroImages(kind, slug);
  return [h.og.path, h.webp.path, ...(h.sq ? [h.sq.path] : []), ...(h.r43 ? [h.r43.path] : []), ...(hasSteps ? [stepsImage(kind, slug).path] : [])];
}
