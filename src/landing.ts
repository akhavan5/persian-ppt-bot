// رندر صفحه‌های سئو (کلیدواژه‌ای). داده‌ها در landing-data.ts هستند.
import { PAGES, PAGE_BY_SLUG, type Page, type Section } from "./landing-data";
import { POSTS, POST_BY_SLUG } from "./blog-data";

export const BRAND = "پاورپوینت‌ساز فارسی";

export const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
// [متن](/مسیر) → لینک داخلی
export const inline = (s: string) => esc(s)
  .replace(/\[([^\]]+)\]\((\/[a-z0-9\-#/]*)\)/g, '<a href="$2">$1</a>')
  .replace(/\[([^\]]+)\]\((https:\/\/t\.me\/[A-Za-z0-9_]+)\)/g, '<a href="$2" rel="noopener" target="_blank">$1</a>');
export const plain = (s: string) => s.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");
export const jsonLd = (o: unknown) => JSON.stringify(o).replace(/</g, "\\u003c");

export const fa = (n: number) => String(n).replace(/\d/g, (d) => "۰۱۲۳۴۵۶۷۸۹"[+d]);
export const faDate = (iso: string) => new Intl.DateTimeFormat("fa-IR", { dateStyle: "long", timeZone: "UTC" }).format(new Date(iso + "T00:00:00Z"));

/** گره‌های مشترک داده‌ی ساختاریافته‌ی همه‌ی صفحه‌های Worker (سازمان و وب‌سایت)؛ یک‌جا تعریف شده تا با صفحه‌ی اصلی هماهنگ بماند. */
export function siteNodes(SITE: string) {
  return [
    {
      "@type": "Organization", "@id": `${SITE}/#org`, name: BRAND, alternateName: ["pptsaz", "pptsaz.ir", "پاورپوینت ساز فارسی", "پاورپوینت ساز"], url: `${SITE}/`,
      logo: { "@type": "ImageObject", url: `${SITE}/icon-512.png`, width: 512, height: 512 }, description: "ابزار آنلاین ساخت پاورپوینت فارسی و قابل‌ویرایش با هوش مصنوعی", email: "info@pptsaz.ir",
      contactPoint: { "@type": "ContactPoint", email: "info@pptsaz.ir", url: "https://t.me/pptsaz_bot", contactType: "customer support", areaServed: "IR", availableLanguage: "fa" }, sameAs: ["https://t.me/pptsaz_bot"],
    },
    { "@type": "WebSite", "@id": `${SITE}/#website`, name: BRAND, alternateName: ["پاورپوینت ساز فارسی", "پاورپوینت ساز", "pptsaz.ir"], url: `${SITE}/`, inLanguage: "fa-IR", publisher: { "@id": `${SITE}/#org` } },
  ];
}

/** سربرگ‌های امنیتی و کش مشترک پاسخ‌های HTML ساخته‌شده در Worker. stale-while-revalidate: بازدید بعد از انقضا هم فوری جواب می‌گیرد. */
export const HTML_HEADERS: Record<string, string> = {
  "content-type": "text/html; charset=utf-8", "content-language": "fa",
  "cache-control": "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400", vary: "Accept-Encoding",
  "x-content-type-options": "nosniff", "x-frame-options": "DENY", "referrer-policy": "strict-origin-when-cross-origin",
  "permissions-policy": "camera=(), microphone=(), geolocation=()", "strict-transport-security": "max-age=31536000; includeSubDomains",
};

/** اگر صفحه بخش «مرحله‌ای» (steps) دارد، همان مراحل ظاهرشده را به‌صورت HowTo معرفی می‌کند (بدون متن اضافه که در صفحه دیده نشود). */
export function howToNode(url: string, sections: Section[]) {
  const sec = sections.find((x) => x.steps && x.steps.length >= 3);
  if (!sec?.steps) return undefined;
  return {
    "@type": "HowTo", "@id": `${url}#howto`, name: sec.h2, inLanguage: "fa-IR", isPartOf: { "@id": `${url}#webpage` },
    step: sec.steps.map((x, i) => ({ "@type": "HowToStep", position: i + 1, name: x.t, text: plain(x.d) })),
  };
}

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

export const CSS = `@font-face{font-family:Vazirmatn;font-style:normal;font-weight:400;font-display:swap;src:url(/fonts/Vazirmatn-Regular.woff2) format("woff2"),url(https://fonts.gstatic.com/s/vazirmatn/v16/Dxxo8j6PP2D_kU2muijlGMWWMmk.woff2) format("woff2");unicode-range:U+0600-06FF,U+0750-077F,U+0870-088E,U+0890-0891,U+0897-08E1,U+08E3-08FF,U+200C-200E,U+2010-2011,U+204F,U+2E41,U+FB50-FDFF,U+FE70-FE74,U+FE76-FEFC}
@font-face{font-family:Vazirmatn;font-style:normal;font-weight:700;font-display:swap;src:url(/fonts/Vazirmatn-Bold.woff2) format("woff2"),url(https://fonts.gstatic.com/s/vazirmatn/v16/Dxxo8j6PP2D_kU2muijlGMWWMmk.woff2) format("woff2");unicode-range:U+0600-06FF,U+0750-077F,U+0870-088E,U+0890-0891,U+0897-08E1,U+08E3-08FF,U+200C-200E,U+2010-2011,U+204F,U+2E41,U+FB50-FDFF,U+FE70-FE74,U+FE76-FEFC}
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
.ft .all{grid-column:1/-1}.ft ul.cols{columns:200px 3;column-gap:22px}.ft ul.cols li{break-inside:avoid}
footer li{margin-bottom:4px}
footer a{color:var(--muted);text-decoration:none}footer a:hover{color:var(--primary)}
.copy{margin-top:16px;padding-top:12px;border-top:1px solid var(--line);color:var(--muted);font-size:.85rem}
.skip{position:absolute;inset-inline-start:12px;top:-60px;z-index:50;background:var(--primary);color:#fff;padding:8px 16px;border-radius:0 0 10px 10px;text-decoration:none;font-weight:700}
.skip:focus{top:0}
.upd{color:var(--muted);font-size:.86rem;margin:10px 0 0}
a:focus-visible,summary:focus-visible,.btn:focus-visible{outline:3px solid #93b4f8;outline-offset:2px;border-radius:6px}
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

/** فوتر مشترک صفحه‌های سئو و وبلاگ: ردیف اول (برند، مخاطب‌ها، پیوندهای سایت) و دو فهرست کامل راهنماها و مقاله‌ها. */
export function renderFooter(): string {
  const audiences = PAGES.filter((x) => x.audience).map((x) => `<li><a href="/${x.slug}">${esc(x.nav)}</a></li>`).join("");
  const guides = PAGES.filter((x) => !x.audience).map((x) => `<li><a href="/${x.slug}">${esc(x.nav)}</a></li>`).join("");
  const arts = POSTS.map((x) => `<li><a href="/blog/${x.slug}">${esc(x.nav)}</a></li>`).join("");
  return `<footer>
  <div class="wrap wide">
    <div class="ft">
      <div>
        <a class="brand" href="/"><i>📊</i><span>${BRAND}</span></a>
        <p style="margin-top:10px;color:var(--muted)">از یک موضوع ساده تا ارائه‌ای کامل و آماده‌ی نمایش؛ فارسی، راست‌به‌چپ و قابل‌ویرایش.</p>
        <p style="margin-top:8px;color:var(--muted)">تماس: <a href="https://t.me/pptsaz_bot" rel="noopener" target="_blank">@pptsaz_bot</a> · <a href="mailto:info@pptsaz.ir">info@pptsaz.ir</a></p>
      </div>
      <div><h4>برای چه کسانی؟</h4><ul>${audiences}</ul></div>
      <div><h4>پیوندهای سایت</h4><ul><li><a href="/#features">ویژگی‌ها</a></li><li><a href="/#how">نحوه‌ی کار</a></li><li><a href="/#usecases">مخاطبان</a></li><li><a href="/#pricing">تعرفه</a></li><li><a href="/#faq">پرسش‌های متداول</a></li><li><a href="/blog">وبلاگ</a></li><li><a href="/#contact">تماس با ما</a></li></ul></div>
      <div class="all"><h4>راهنماها</h4><ul class="cols">${guides}</ul></div>
      <div class="all"><h4>از وبلاگ</h4><ul class="cols">${arts}<li><a href="/blog">همه‌ی مقاله‌ها</a></li></ul></div>
    </div>
    <div class="copy">© ${BRAND} (pptsaz.ir) — همه‌ی حقوق محفوظ است.</div>
  </div>
</footer>`;
}

// مقاله‌های وبلاگ مرتبط با هر صفحه (برای لینک‌دهی داخلی)
const ARTICLES_FOR: Record<string, string[]> = {
  student: ["how-many-slides", "class-presentation-tips", "ai-powerpoint-prompt-persian", "ai-presentation-sample-slides", "time-management-presentation-sample", "make-powerpoint-from-scratch"],
  "thesis-defense": ["thesis-defense-slides-guide", "thesis-defense-powerpoint-how-to", "defense-judges-common-questions", "how-to-defend-your-presentation", "how-many-slides"],
  teacher: ["persian-powerpoint-design", "how-many-slides", "presentation-topic-ideas", "class-presentation-tips"],
  business: ["ai-powerpoint-charts", "persian-powerpoint-design", "how-many-slides", "entrepreneurship-presentation-sample"],
  free: ["ai-powerpoint-step-by-step", "free-powerpoint-templates-persian", "chatgpt-powerpoint-persian", "ai-powerpoint-faq-persian", "powerpoint-ai-without-credit-card-persian"],
  "ppt-saz": ["best-way-persian-powerpoint", "best-persian-font-powerpoint", "ai-powerpoint-step-by-step", "pptsaz-honest-comparison"],
  compare: ["foreign-ai-presentation-tools-persian-test", "pptsaz-honest-comparison", "best-ai-powerpoint-makers-persian", "chatgpt-powerpoint-persian", "ai-powerpoint-faq-persian", "gemini-copilot-powerpoint-persian"],
  "text-to-pptx": ["ai-powerpoint-prompt-persian", "best-way-persian-powerpoint", "ai-powerpoint-charts"],
  "word-to-pptx": ["best-way-persian-powerpoint", "fix-persian-powerpoint-broken", "persian-rtl-slides"],
  "pdf-to-pptx": ["best-way-persian-powerpoint", "thesis-defense-slides-guide", "ai-powerpoint-prompt-persian"],
  "telegram-bot": ["ai-powerpoint-mobile-telegram", "ai-powerpoint-faq-persian", "ai-powerpoint-step-by-step"],
  "ai-powerpoint-maker": ["ai-powerpoint-prompt-persian", "chatgpt-powerpoint-persian", "ai-powerpoint-step-by-step", "gemini-copilot-powerpoint-persian"],
  "online-powerpoint-maker": ["ai-powerpoint-step-by-step", "ai-powerpoint-mobile-telegram", "best-way-persian-powerpoint", "make-powerpoint-from-scratch"],
  "canva-alternative": ["foreign-ai-presentation-tools-persian-test", "pptsaz-honest-comparison", "best-ai-powerpoint-makers-persian", "persian-powerpoint-design", "ai-powerpoint-faq-persian"],
  "gamma-alternative": ["foreign-ai-presentation-tools-persian-test", "pptsaz-honest-comparison", "best-ai-powerpoint-makers-persian", "chatgpt-powerpoint-persian", "ai-powerpoint-faq-persian", "gemini-copilot-powerpoint-persian"],
  "slide-maker": ["ai-powerpoint-step-by-step", "persian-powerpoint-design", "how-many-slides"],
  "pitch-deck": ["ai-powerpoint-charts", "persian-powerpoint-design", "how-many-slides", "entrepreneurship-presentation-sample"],
  "proposal-presentation": ["thesis-defense-slides-guide", "defense-judges-common-questions", "how-many-slides", "class-presentation-tips"],
  "article-presentation": ["ai-powerpoint-prompt-persian", "best-way-persian-powerpoint", "how-many-slides"],
  "school-presentation": ["class-presentation-tips", "presentation-topic-ideas", "how-many-slides", "time-management-presentation-sample", "make-powerpoint-from-scratch"],
  "ppt-with-images": ["persian-powerpoint-design", "ai-powerpoint-step-by-step", "free-powerpoint-templates-persian"],
  "speaker-notes": ["class-presentation-tips", "how-to-defend-your-presentation", "how-many-slides", "ai-powerpoint-prompt-persian"],
  "medical-presentation": ["mental-health-presentation-sample", "thesis-defense-slides-guide", "how-many-slides", "persian-rtl-slides"],
  "engineering-presentation": ["thesis-defense-slides-guide", "defense-judges-common-questions", "ai-powerpoint-charts", "persian-rtl-slides"],
  "law-presentation": ["defense-judges-common-questions", "how-to-defend-your-presentation", "thesis-defense-slides-guide", "how-many-slides"],
  "management-presentation": ["entrepreneurship-presentation-sample", "ai-powerpoint-charts", "how-many-slides", "persian-powerpoint-design"],
  "clergy-presentation": ["class-presentation-tips", "persian-powerpoint-design", "best-persian-font-powerpoint", "how-many-slides"],
  "iranian-powerpoint-maker": ["foreign-ai-presentation-tools-persian-test", "best-ai-powerpoint-makers-persian", "pptsaz-honest-comparison", "ai-powerpoint-faq-persian", "powerpoint-ai-without-credit-card-persian", "gemini-copilot-powerpoint-persian"],
  "persian-powerpoint-templates": ["free-powerpoint-templates-persian", "best-persian-font-powerpoint", "persian-powerpoint-design", "persian-rtl-slides"],
  "konkur-presentation": ["time-management-presentation-sample", "class-presentation-tips", "how-many-slides", "presentation-topic-ideas"],
  "ready-made-powerpoint": ["free-powerpoint-templates-persian", "presentation-topic-ideas", "class-presentation-tips", "persian-powerpoint-design", "make-powerpoint-from-scratch"],
};

// ۲۵ مهر ۱۴۰۵: صفحه‌های قابلیت‌ها (لینک، اینفوگرافیک، جزوه، Excel) و مقاله‌های جدید؛ به‌جای دست‌زدن به فهرست‌های بالا، اینجا به آن‌ها اضافه می‌شوند
const MORE_ARTICLES: Record<string, string[]> = {
  "link-to-pptx": ["webpage-to-presentation-guide", "pdf-link-to-powerpoint-tools-compared", "best-way-persian-powerpoint", "ai-powerpoint-prompt-persian"],
  "infographic-maker": ["persian-infographic-guide", "handout-vs-slides-vs-infographic", "persian-powerpoint-design", "best-persian-font-powerpoint"],
  "handout-maker": ["handout-vs-slides-vs-infographic", "class-presentation-tips", "persian-infographic-guide", "how-to-defend-your-presentation"],
  "excel-to-pptx": ["excel-data-presentation-guide", "ai-powerpoint-charts", "how-many-slides", "entrepreneurship-presentation-sample"],
  student: ["self-introduction-presentation-sample", "global-warming-presentation-sample"],
  "school-presentation": ["global-warming-presentation-sample", "self-introduction-presentation-sample"],
  teacher: ["handout-vs-slides-vs-infographic", "persian-infographic-guide"],
  business: ["excel-data-presentation-guide", "handout-vs-slides-vs-infographic"],
  "management-presentation": ["excel-data-presentation-guide"],
  "medical-presentation": ["persian-infographic-guide"],
  "thesis-defense": ["handout-vs-slides-vs-infographic"],
  "text-to-pptx": ["webpage-to-presentation-guide", "excel-data-presentation-guide"],
  "word-to-pptx": ["handout-vs-slides-vs-infographic"],
  "pdf-to-pptx": ["pdf-link-to-powerpoint-tools-compared", "webpage-to-presentation-guide"],
  "article-presentation": ["webpage-to-presentation-guide", "pdf-link-to-powerpoint-tools-compared"],
  compare: ["pdf-link-to-powerpoint-tools-compared"],
  "iranian-powerpoint-maker": ["pdf-link-to-powerpoint-tools-compared"],
  "ppt-with-images": ["persian-infographic-guide"],
  "speaker-notes": ["handout-vs-slides-vs-infographic"],
  "slide-maker": ["handout-vs-slides-vs-infographic"],
  "persian-powerpoint-templates": ["persian-infographic-guide"],
  "telegram-bot": ["webpage-to-presentation-guide"],
  "ai-powerpoint-maker": ["webpage-to-presentation-guide"],
};
for (const [page, slugs] of Object.entries(MORE_ARTICLES)) ARTICLES_FOR[page] = [...new Set([...(ARTICLES_FOR[page] ?? []), ...slugs])];

// صفحه‌های جدید در بخش «راهنماهای مرتبط» صفحه‌های قدیمی (لینک‌دهی داخلی دوطرفه)
const MORE_RELATED: Record<string, string[]> = {
  free: ["link-to-pptx", "infographic-maker", "handout-maker", "excel-to-pptx"],
  "ppt-saz": ["link-to-pptx", "infographic-maker", "handout-maker", "excel-to-pptx"],
  student: ["handout-maker"],
  teacher: ["handout-maker", "infographic-maker"],
  business: ["excel-to-pptx", "infographic-maker"],
  "management-presentation": ["excel-to-pptx"],
  "school-presentation": ["infographic-maker"],
  "medical-presentation": ["infographic-maker"],
  "text-to-pptx": ["link-to-pptx", "excel-to-pptx"],
  "word-to-pptx": ["handout-maker", "link-to-pptx"],
  "pdf-to-pptx": ["link-to-pptx", "excel-to-pptx"],
  "article-presentation": ["link-to-pptx"],
  "ppt-with-images": ["infographic-maker"],
  "speaker-notes": ["handout-maker"],
  "slide-maker": ["infographic-maker", "handout-maker", "link-to-pptx"],
  "telegram-bot": ["link-to-pptx", "infographic-maker", "handout-maker"],
  "ai-powerpoint-maker": ["link-to-pptx", "infographic-maker"],
  "online-powerpoint-maker": ["link-to-pptx"],
  "persian-powerpoint-templates": ["infographic-maker"],
};

/** مقاله → صفحه‌های فرودی که به آن لینک می‌دهند؛ برای لینک برگشتی از مقاله به صفحه‌های ابزار (لینک‌دهی داخلی دوطرفه). */
export const LANDINGS_FOR_POST: Map<string, string[]> = (() => {
  const m = new Map<string, string[]>();
  for (const [page, slugs] of Object.entries(ARTICLES_FOR)) for (const s of slugs) m.set(s, [...(m.get(s) ?? []), page]);
  return m;
})();

export function renderLanding(p: Page, SITE: string): string {
  const url = `${SITE}/${p.slug}`;
  const h1Text = p.h1.join("");
  const articles = (ARTICLES_FOR[p.slug] ?? []).map((s) => POST_BY_SLUG.get(s)).filter((x) => !!x);
  const related = [...new Set([...p.related, ...(MORE_RELATED[p.slug] ?? [])])].filter((slug) => slug !== p.slug).map((slug) => PAGE_BY_SLUG.get(slug)).filter((x): x is Page => !!x);

  const howTo = howToNode(url, p.sections);
  const ld = {
    "@context": "https://schema.org",
    "@graph": [
      ...siteNodes(SITE),
      {
        "@type": "WebPage", "@id": `${url}#webpage`, url, name: p.title, description: p.desc, inLanguage: "fa-IR",
        isPartOf: { "@id": `${SITE}/#website` }, breadcrumb: { "@id": `${url}#breadcrumb` }, publisher: { "@id": `${SITE}/#org` }, mainEntity: { "@id": `${url}#faq` },
        primaryImageOfPage: { "@type": "ImageObject", url: `${SITE}/og-image.png`, width: 1200, height: 630 }, dateModified: p.updated,
        ...(p.audience ? { audience: { "@type": "Audience", audienceType: p.audience } } : {}),
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
      ...(howTo ? [howTo] : []),
    ],
  };

  const nav = PAGES.filter((x) => x.slug !== "ppt-saz" && x.menu !== false).map((x) => `<a href="/${x.slug}"${x.slug === p.slug ? ' aria-current="page"' : ""}>${esc(x.nav)}</a>`).join("") + `<a href="/blog">وبلاگ</a><a href="/#pricing">تعرفه</a>`;

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
<link rel="preload" href="/fonts/Vazirmatn-Regular.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="/fonts/Vazirmatn-Bold.woff2" as="font" type="font/woff2" crossorigin>
<script type="application/ld+json">${jsonLd(ld)}</script>
<style>${CSS}</style>
</head>
<body>
<a class="skip" href="#main">رفتن به محتوا</a>
<header class="top">
  <div class="wrap wide in">
    <a class="brand" href="/" aria-label="${BRAND}"><i>📊</i><span>${BRAND}</span></a>
    <nav class="links" aria-label="منوی اصلی">${nav}</nav>
    <a class="btn sm" href="/#topic">ساخت رایگان</a>
  </div>
</header>
<main class="wrap" id="main">
  <nav class="crumb" aria-label="مسیر صفحه"><ol><li><a href="/">${BRAND}</a></li><li><span aria-current="page">${esc(p.nav)}</span></li></ol></nav>
  <div class="hero">
    <h1>${esc(p.h1[0])}<em>${esc(p.h1[1])}</em>${esc(p.h1[2])}</h1>
    <p class="lead">${esc(p.lead)}</p>
    <div class="cta-row"><a class="btn" href="/#topic">${esc(p.cta)}</a><a class="btn ghost" href="/#pricing">مشاهده‌ی تعرفه</a></div>
    <div class="trust"><span>🆓 ۳ ارائه‌ی رایگانِ ثبت‌نام</span><span>🔤 راست‌به‌چپ و فونت فارسی</span><span>✏️ کاملاً قابل‌ویرایش</span></div>
    <p class="upd">آخرین به‌روزرسانی: <time datetime="${p.updated}">${faDate(p.updated)}</time></p>
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
${renderFooter()}
</body>
</html>
`;
}
