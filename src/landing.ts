// رندر صفحه‌های سئو (کلیدواژه‌ای). داده‌ها در landing-data.ts هستند.
import { PAGES, PAGE_BY_SLUG, type Page, type Section } from "./landing-data";
import { POST_BY_SLUG } from "./blog-data";

export const BRAND = "پاورپوینت‌ساز فارسی";

export const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
// [متن](/مسیر) → لینک داخلی
export const inline = (s: string) => esc(s)
  .replace(/\[([^\]]+)\]\((\/[a-z0-9\-#/]*)\)/g, '<a href="$2">$1</a>')
  .replace(/\[([^\]]+)\]\((https:\/\/t\.me\/[A-Za-z0-9_]+)\)/g, '<a href="$2" rel="noopener" target="_blank">$1</a>');
export const plain = (s: string) => s.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");
export const jsonLd = (o: unknown) => JSON.stringify(o).replace(/</g, "\\u003c");

/** مسیر → صفحه‌ی سئو (با یا بدون اسلش پایانی). */
export function findLanding(pathname: string): { page: Page; trailingSlash: boolean } | undefined {
  const m = /^\/([a-z0-9-]+)(\/?)$/.exec(pathname);
  if (!m) return undefined;
  const page = PAGE_BY_SLUG.get(m[1]);
  return page ? { page, trailingSlash: m[2] === "/" } : undefined;
}

/** ورودی‌های sitemap برای همه‌ی صفحه‌ها. */
export function landingSitemapEntries(site: string): string {
  return PAGES.map((p) => `  <url>\n    <loc>${site}/${p.slug}</loc>\n    <lastmod>${p.updated}</lastmod>\n    <changefreq>monthly</changefreq>\n    <priority>0.8</priority>\n  </url>\n`).join("");
}

export const LANDING_PATHS = PAGES.map((p) => `/${p.slug}`);

export const CSS = `@font-face{font-family:Vazirmatn;font-style:normal;font-weight:100 900;font-display:swap;src:url(https://fonts.gstatic.com/s/vazirmatn/v16/Dxxo8j6PP2D_kU2muijlGMWWMmk.woff2) format("woff2");unicode-range:U+0600-06FF,U+0750-077F,U+0870-088E,U+0890-0891,U+0897-08E1,U+08E3-08FF,U+200C-200E,U+2010-2011,U+204F,U+2E41,U+FB50-FDFF,U+FE70-FE74,U+FE76-FEFC}
:root{--bg:#f8faff;--card:#fff;--text:#0f1b33;--muted:#5b6b86;--line:#e3e9f5;--primary:#2563eb;--primary-2:#06b6d4;--soft:#eef4ff;--radius:16px;--shadow:0 1px 2px rgba(15,27,51,.05),0 10px 30px rgba(37,99,235,.08)}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%;scroll-behavior:smooth;scroll-padding-top:70px}
body{margin:0;background:var(--bg);color:var(--text);font:16px/1.9 Vazirmatn,Tahoma,system-ui,sans-serif;background-image:radial-gradient(900px 420px at 85% -80px,#dbe8ff 0,transparent 70%),radial-gradient(700px 360px at 5% 0,#d9f6fb 0,transparent 70%);background-repeat:no-repeat}
a{color:var(--primary)}
.wrap{max-width:860px;margin:0 auto;padding:0 18px}
.wide{max-width:1040px}
header.top{position:sticky;top:0;z-index:20;background:rgba(255,255,255,.88);backdrop-filter:blur(10px);border-bottom:1px solid var(--line)}
header .in{display:flex;align-items:center;justify-content:space-between;gap:12px;min-height:64px}
.brand{white-space:nowrap;flex-shrink:0;display:flex;align-items:center;gap:10px;font-weight:800;font-size:1.05rem;color:var(--text);text-decoration:none}
.brand i{font-style:normal;display:grid;place-items:center;width:38px;height:38px;border-radius:11px;background:linear-gradient(135deg,var(--primary),var(--primary-2));color:#fff;font-size:20px;box-shadow:0 6px 16px rgba(37,99,235,.3)}
nav.links{display:flex;gap:12px;flex-wrap:nowrap}
nav.links a{color:var(--muted);text-decoration:none;font-size:.86rem;font-weight:600;white-space:nowrap}
nav.links a:hover,nav.links a[aria-current]{color:var(--primary)}
@media(max-width:1180px){nav.links{display:none}}
.btn{white-space:nowrap;display:inline-flex;align-items:center;justify-content:center;gap:8px;border:0;border-radius:12px;padding:12px 24px;font-weight:700;cursor:pointer;text-decoration:none;background:linear-gradient(135deg,var(--primary),#1d4ed8);color:#fff;box-shadow:0 6px 18px rgba(37,99,235,.28);transition:.15s}
.btn:hover{transform:translateY(-1px);box-shadow:0 10px 22px rgba(37,99,235,.34)}
.btn.ghost{background:#fff;color:var(--text);border:1px solid var(--line);box-shadow:none}
.btn.ghost:hover{border-color:var(--primary);color:var(--primary)}
.btn.sm{padding:7px 16px;font-size:.88rem;border-radius:10px}
.crumb{padding:16px 0 0;font-size:.85rem;color:var(--muted)}
.crumb ol{list-style:none;display:flex;flex-wrap:wrap;gap:6px;margin:0;padding:0}
.crumb li+li::before{content:"‹";margin-inline-end:6px;color:#9aa8c2}
.crumb a{color:var(--muted);text-decoration:none}.crumb a:hover{color:var(--primary)}
.hero{text-align:center;padding:30px 0 22px}
h1{font-size:clamp(1.55rem,4.2vw,2.35rem);margin:0 0 14px;line-height:1.55;font-weight:800}
h1 em{font-style:normal;background:linear-gradient(135deg,var(--primary),var(--primary-2));-webkit-background-clip:text;background-clip:text;color:transparent;padding:.25em .1em;-webkit-box-decoration-break:clone;box-decoration-break:clone}
.lead{font-size:1.07rem;color:var(--muted);margin:0 auto 22px;max-width:720px}
.cta-row{display:flex;gap:10px;justify-content:center;flex-wrap:wrap}
.trust{display:flex;gap:8px 18px;justify-content:center;flex-wrap:wrap;color:var(--muted);font-size:.86rem;margin:18px 0 6px}
article section{background:var(--card);border:1px solid var(--line);border-radius:var(--radius);box-shadow:var(--shadow);padding:22px 24px;margin:18px 0}
h2{font-size:1.28rem;margin:0 0 10px;font-weight:800;line-height:1.6}
h3{font-size:1rem;margin:0 0 4px}
p{margin:0 0 12px}
ul{margin:0 0 12px;padding-inline-start:22px}li{margin-bottom:6px}
ol.steps{list-style:none;counter-reset:s;margin:0 0 6px;padding:0;display:grid;gap:12px}
ol.steps li{counter-increment:s;display:grid;grid-template-columns:36px 1fr;gap:12px;margin:0}
ol.steps li::before{content:counter(s,persian);display:grid;place-items:center;width:36px;height:36px;border-radius:50%;background:var(--soft);color:var(--primary);font-weight:800}
ol.steps p{margin:0;color:var(--muted);font-size:.95rem}
.tbl{overflow-x:auto;margin:6px 0 12px;border:1px solid var(--line);border-radius:12px}
table{border-collapse:collapse;width:100%;min-width:420px;font-size:.95rem}
th,td{padding:10px 14px;text-align:right;border-bottom:1px solid var(--line);vertical-align:top}
th{background:var(--soft);font-weight:700}
tr:last-child td{border-bottom:0}
td:first-child{white-space:nowrap;font-weight:600}
.chips{display:flex;flex-wrap:wrap;gap:8px}
.chips a{display:inline-block;border:1px dashed #c5d3ee;border-radius:999px;padding:5px 14px;font-size:.9rem;color:var(--text);text-decoration:none;background:#fff}
.chips a:hover{border-color:var(--primary);color:var(--primary)}
details{border:1px solid var(--line);border-radius:12px;background:#fff;margin-bottom:10px}
summary{cursor:pointer;font-weight:700;padding:13px 16px;list-style:none;display:flex;justify-content:space-between;gap:10px}
summary::after{content:"+";color:var(--primary);font-size:1.3rem;line-height:1}
details[open] summary::after{content:"−"}
summary::-webkit-details-marker{display:none}
details p{padding:0 16px 14px;margin:0;color:#34415c}
.rel{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:12px}
.rel a{display:block;border:1px solid var(--line);border-radius:12px;padding:14px 16px;background:#fff;text-decoration:none;color:var(--text);font-weight:700}
.rel a:hover{border-color:var(--primary);color:var(--primary)}
.rel span{display:block;font-weight:400;font-size:.85rem;color:var(--muted);margin-top:2px}
.final{text-align:center;background:linear-gradient(135deg,#eaf1ff,#e1f8fc)}
.final p{color:var(--muted)}
footer{margin-top:34px;border-top:1px solid var(--line);background:#fff;padding:26px 0 18px;font-size:.9rem}
.ft{display:grid;gap:18px;grid-template-columns:1.2fr 1fr 1fr}
@media(max-width:720px){.ft{grid-template-columns:1fr}}
footer h4{margin:0 0 8px;font-size:.95rem}
footer ul{list-style:none;padding:0;margin:0}
footer li{margin-bottom:4px}
footer a{color:var(--muted);text-decoration:none}footer a:hover{color:var(--primary)}
.copy{margin-top:16px;padding-top:12px;border-top:1px solid var(--line);color:var(--muted);font-size:.85rem}
@media(prefers-reduced-motion:reduce){html{scroll-behavior:auto}.btn{transition:none}}`;

export function renderSection(s: Section): string {
  let h = `<section><h2>${esc(s.h2)}</h2>`;
  for (const p of s.paras ?? []) h += `<p>${inline(p)}</p>`;
  if (s.steps) h += `<ol class="steps">${s.steps.map((x) => `<li><div><h3>${esc(x.t)}</h3><p>${inline(x.d)}</p></div></li>`).join("")}</ol>`;
  if (s.list) h += `<ul>${s.list.map((x) => `<li>${inline(x)}</li>`).join("")}</ul>`;
  if (s.table) {
    h += `<div class="tbl" tabindex="0" role="region" aria-label="${esc(s.h2)}"><table><thead><tr><th scope="col">${esc(s.table.head[0])}</th><th scope="col">${esc(s.table.head[1])}</th></tr></thead><tbody>`;
    h += s.table.rows.map((r) => `<tr><td>${esc(r[0])}</td><td>${inline(r[1])}</td></tr>`).join("");
    h += `</tbody></table></div>`;
  }
  for (const p of s.after ?? []) h += `<p>${inline(p)}</p>`;
  return h + `</section>`;
}

// مقاله‌های وبلاگ مرتبط با هر صفحه (برای لینک‌دهی داخلی)
const ARTICLES_FOR: Record<string, string[]> = {
  student: ["how-many-slides", "class-presentation-tips", "ai-powerpoint-prompt-persian"],
  "thesis-defense": ["thesis-defense-slides-guide", "thesis-defense-powerpoint-how-to", "how-many-slides"],
  teacher: ["persian-powerpoint-design", "how-many-slides", "presentation-topic-ideas"],
  business: ["ai-powerpoint-charts", "persian-powerpoint-design", "how-many-slides"],
  free: ["ai-powerpoint-step-by-step", "free-powerpoint-templates-persian", "chatgpt-powerpoint-persian", "ai-powerpoint-faq-persian"],
  "ppt-saz": ["best-way-persian-powerpoint", "best-persian-font-powerpoint", "ai-powerpoint-step-by-step"],
  compare: ["best-ai-powerpoint-makers-persian", "chatgpt-powerpoint-persian", "ai-powerpoint-faq-persian"],
  "text-to-pptx": ["ai-powerpoint-prompt-persian", "best-way-persian-powerpoint", "ai-powerpoint-charts"],
  "word-to-pptx": ["best-way-persian-powerpoint", "fix-persian-powerpoint-broken", "persian-rtl-slides"],
  "pdf-to-pptx": ["best-way-persian-powerpoint", "thesis-defense-slides-guide", "ai-powerpoint-prompt-persian"],
  "telegram-bot": ["ai-powerpoint-mobile-telegram", "ai-powerpoint-faq-persian", "ai-powerpoint-step-by-step"],
  "ai-powerpoint-maker": ["ai-powerpoint-prompt-persian", "chatgpt-powerpoint-persian", "ai-powerpoint-step-by-step"],
  "online-powerpoint-maker": ["ai-powerpoint-step-by-step", "ai-powerpoint-mobile-telegram", "best-way-persian-powerpoint"],
  "gamma-alternative": ["best-ai-powerpoint-makers-persian", "chatgpt-powerpoint-persian", "ai-powerpoint-faq-persian"],
  "slide-maker": ["ai-powerpoint-step-by-step", "persian-powerpoint-design", "how-many-slides"],
  "pitch-deck": ["ai-powerpoint-charts", "persian-powerpoint-design", "how-many-slides"],
  "proposal-presentation": ["thesis-defense-slides-guide", "how-many-slides", "class-presentation-tips"],
  "article-presentation": ["ai-powerpoint-prompt-persian", "best-way-persian-powerpoint", "how-many-slides"],
  "school-presentation": ["class-presentation-tips", "presentation-topic-ideas", "how-many-slides"],
  "ppt-with-images": ["persian-powerpoint-design", "ai-powerpoint-step-by-step", "free-powerpoint-templates-persian"],
  "speaker-notes": ["class-presentation-tips", "how-many-slides", "ai-powerpoint-prompt-persian"],
};

export function renderLanding(p: Page, SITE: string): string {
  const url = `${SITE}/${p.slug}`;
  const h1Text = p.h1.join("");
  const articles = (ARTICLES_FOR[p.slug] ?? []).map((s) => POST_BY_SLUG.get(s)).filter((x) => !!x);
  const related = p.related.map((slug) => PAGE_BY_SLUG.get(slug)).filter((x): x is Page => !!x);

  const ld = {
    "@context": "https://schema.org",
    "@graph": [
      { "@type": "Organization", "@id": `${SITE}/#org`, name: BRAND, url: `${SITE}/`, logo: { "@type": "ImageObject", url: `${SITE}/icon-512.png`, width: 512, height: 512 } },
      { "@type": "WebSite", "@id": `${SITE}/#website`, name: BRAND, alternateName: "pptsaz.ir", url: `${SITE}/`, inLanguage: "fa-IR", publisher: { "@id": `${SITE}/#org` } },
      {
        "@type": "WebPage", "@id": `${url}#webpage`, url, name: p.title, description: p.desc, inLanguage: "fa-IR",
        isPartOf: { "@id": `${SITE}/#website` }, breadcrumb: { "@id": `${url}#breadcrumb` },
        primaryImageOfPage: { "@type": "ImageObject", url: `${SITE}/og-image.png`, width: 1200, height: 630 }, dateModified: p.updated,
      },
      {
        "@type": "BreadcrumbList", "@id": `${url}#breadcrumb`,
        itemListElement: [
          { "@type": "ListItem", position: 1, name: BRAND, item: `${SITE}/` },
          { "@type": "ListItem", position: 2, name: p.nav, item: url },
        ],
      },
      {
        "@type": "FAQPage", "@id": `${url}#faq`, isPartOf: { "@id": `${url}#webpage` }, inLanguage: "fa-IR",
        mainEntity: p.faq.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: plain(f.a) } })),
      },
    ],
  };

  const nav = PAGES.filter((x) => x.slug !== "ppt-saz" && x.menu !== false).map((x) => `<a href="/${x.slug}"${x.slug === p.slug ? ' aria-current="page"' : ""}>${esc(x.nav)}</a>`).join("") + `<a href="/blog">وبلاگ</a><a href="/#pricing">تعرفه</a>`;
  const guides = PAGES.map((x) => `<li><a href="/${x.slug}">${esc(x.nav)}</a></li>`).join("") + `<li><a href="/blog">وبلاگ</a></li>`;

  return `<!doctype html>
<html lang="fa" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(p.title)}</title>
<meta name="description" content="${esc(p.desc)}">
<meta name="robots" content="index,follow,max-image-preview:large,max-snippet:-1">
<meta name="author" content="${BRAND}">
<meta name="theme-color" content="#2563eb">
<link rel="canonical" href="${url}">
<link rel="alternate" hreflang="fa-IR" href="${url}">
<link rel="alternate" hreflang="x-default" href="${url}">
<meta property="og:type" content="website">
<meta property="og:locale" content="fa_IR">
<meta property="og:site_name" content="${BRAND}">
<meta property="og:title" content="${esc(h1Text)}">
<meta property="og:description" content="${esc(p.desc)}">
<meta property="og:url" content="${url}">
<meta property="og:image" content="${SITE}/og-image.png">
<meta property="og:image:type" content="image/png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="${esc(h1Text)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(h1Text)}">
<meta name="twitter:description" content="${esc(p.desc)}">
<meta name="twitter:image" content="${SITE}/og-image.png">
<meta name="twitter:image:alt" content="${esc(h1Text)}">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="icon" href="/favicon.ico" sizes="48x48">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="manifest" href="/manifest.webmanifest">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="preload" href="https://fonts.gstatic.com/s/vazirmatn/v16/Dxxo8j6PP2D_kU2muijlGMWWMmk.woff2" as="font" type="font/woff2" crossorigin>
<script type="application/ld+json">${jsonLd(ld)}</script>
<style>${CSS}</style>
</head>
<body>
<header class="top">
  <div class="wrap wide in">
    <a class="brand" href="/" aria-label="${BRAND}"><i>📊</i><span>${BRAND}</span></a>
    <nav class="links" aria-label="منوی اصلی">${nav}</nav>
    <a class="btn sm" href="/#topic">ساخت رایگان</a>
  </div>
</header>
<main class="wrap">
  <nav class="crumb" aria-label="مسیر صفحه"><ol><li><a href="/">${BRAND}</a></li><li><span aria-current="page">${esc(p.nav)}</span></li></ol></nav>
  <div class="hero">
    <h1>${esc(p.h1[0])}<em>${esc(p.h1[1])}</em>${esc(p.h1[2])}</h1>
    <p class="lead">${esc(p.lead)}</p>
    <div class="cta-row"><a class="btn" href="/#topic">${esc(p.cta)}</a><a class="btn ghost" href="/#pricing">مشاهده‌ی تعرفه</a></div>
    <div class="trust"><span>🆓 سهمیه‌ی رایگان روزانه</span><span>🔤 راست‌به‌چپ و فونت فارسی</span><span>✏️ کاملاً قابل‌ویرایش</span></div>
  </div>
  <article>
${p.sections.map(renderSection).join("\n")}
    <section>
      <h2>${esc(p.topicsTitle)}</h2>
      <p style="color:var(--muted);font-size:.92rem">روی هر مورد بزن تا در کادر موضوع قرار بگیرد و بتوانی آن را تغییر بدهی.</p>
      <div class="chips">${p.topics.map((t) => `<a rel="nofollow" href="/?topic=${encodeURIComponent(t)}">${esc(t)}</a>`).join("")}</div>
    </section>
    <section>
      <h2>پرسش‌های متداول</h2>
${p.faq.map((f) => `      <details><summary>${esc(f.q)}</summary><p>${inline(f.a)}</p></details>`).join("\n")}
    </section>
${articles.length ? `    <section>
      <h2>مقاله‌های مرتبط در وبلاگ</h2>
      <div class="rel">${articles.map((a) => `<a href="/blog/${a!.slug}">${esc(a!.nav)}<span>${esc(a!.category)}</span></a>`).join("")}</div>
    </section>
` : ""}    <section>
      <h2>راهنماهای مرتبط</h2>
      <div class="rel">${related.map((r) => `<a href="/${r.slug}">${esc(r.nav)}<span>${esc(r.title.split("|")[0].trim())}</span></a>`).join("")}</div>
    </section>
    <section class="final">
      <h2>آماده‌ای شروع کنی؟</h2>
      <p>موضوع را بنویس و ظرف چند دقیقه فایل PPTX فارسی و قابل‌ویرایش را بگیر.</p>
      <a class="btn" href="/#topic">${esc(p.cta)}</a>
    </section>
  </article>
</main>
<footer>
  <div class="wrap wide">
    <div class="ft">
      <div>
        <a class="brand" href="/"><i>📊</i><span>${BRAND}</span></a>
        <p style="margin-top:10px;color:var(--muted)">از یک موضوع ساده تا ارائه‌ای کامل و آماده‌ی نمایش؛ فارسی، راست‌به‌چپ و قابل‌ویرایش.</p>
      </div>
      <div><h4>راهنماها</h4><ul>${guides}</ul></div>
      <div><h4>پیوندهای سایت</h4><ul><li><a href="/#features">ویژگی‌ها</a></li><li><a href="/#how">نحوه‌ی کار</a></li><li><a href="/#pricing">تعرفه</a></li><li><a href="/#faq">پرسش‌های متداول</a></li><li><a href="/#contact">تماس با ما</a></li></ul></div>
    </div>
    <div class="copy">© ${BRAND} (pptsaz.ir) — همه‌ی حقوق محفوظ است.</div>
  </div>
</footer>
</body>
</html>
`;
}
