// رندر وبلاگ: فهرست /blog و مقاله‌ها /blog/<slug>. داده‌ها در blog-data.ts هستند.
import { PAGES, PAGE_BY_SLUG } from "./landing-data";
import { POSTS, POST_BY_SLUG, type BlogSection, type Post } from "./blog-data";
import { BRAND, CSS, esc, inline, jsonLd, plain, renderSection } from "./landing";

const BLOG_TITLE = "وبلاگ پاورپوینت‌ساز فارسی | راهنمای ساخت و ارائه‌ی پاورپوینت";
const BLOG_DESC = "راهنمای کاربردی ساخت و ارائه‌ی پاورپوینت فارسی: ساختار دفاعیه، تعداد اسلاید، ایده‌ی موضوع، طراحی راست‌به‌چپ، نوشتن موضوع برای هوش مصنوعی و ارائه‌ی بدون استرس.";

const EXTRA_CSS = `
.meta{display:flex;flex-wrap:wrap;gap:6px 16px;justify-content:center;color:var(--muted);font-size:.86rem;margin:0 0 18px}
.tldr{background:linear-gradient(135deg,#eaf1ff,#e1f8fc)!important;border-color:#cfdcf7!important}
.tldr h2{font-size:1.05rem}
.toc ol{margin:0;padding-inline-start:22px}.toc li{margin-bottom:4px}
.toc a{text-decoration:none}.toc a:hover{text-decoration:underline}
.posts{display:grid;grid-template-columns:repeat(auto-fit,minmax(290px,1fr));gap:16px;margin:18px 0}
.post{display:flex;flex-direction:column;gap:8px;border:1px solid var(--line);border-radius:var(--radius);background:var(--card);box-shadow:var(--shadow);padding:20px 22px;text-decoration:none;color:var(--text)}
.post:hover{border-color:var(--primary)}
.post b{font-size:1.06rem;line-height:1.7}
.post p{margin:0;color:var(--muted);font-size:.92rem;flex:1}
.tag{align-self:flex-start;background:var(--soft);color:var(--primary);border-radius:999px;padding:1px 12px;font-size:.78rem;font-weight:700}
.post small{color:var(--muted)}
h2[id]{scroll-margin-top:80px}`;

/** مسیر → فهرست وبلاگ یا یک مقاله. */
export function findBlog(pathname: string): { kind: "index" } | { kind: "post"; post: Post } | { kind: "trailing"; to: string } | undefined {
  const m = /^\/blog(?:\/([a-z0-9-]+))?(\/?)$/.exec(pathname);
  if (!m) return undefined;
  if (!m[1]) return m[2] ? { kind: "trailing", to: "/blog" } : { kind: "index" };
  const post = POST_BY_SLUG.get(m[1]);
  if (!post) return undefined;
  return m[2] ? { kind: "trailing", to: `/blog/${post.slug}` } : { kind: "post", post };
}

/** ورودی‌های sitemap برای فهرست وبلاگ و همه‌ی مقاله‌ها. */
export function blogSitemapEntries(site: string): string {
  const newest = POSTS.map((p) => p.updated).sort().at(-1) ?? "";
  const url = (loc: string, lastmod: string, pr: string) => `  <url>\n    <loc>${loc}</loc>\n    <lastmod>${lastmod}</lastmod>\n    <changefreq>monthly</changefreq>\n    <priority>${pr}</priority>\n  </url>\n`;
  return url(`${site}/blog`, newest, "0.7") + POSTS.map((p) => url(`${site}/blog/${p.slug}`, p.updated, "0.6")).join("");
}

const fa = (n: number) => String(n).replace(/\d/g, (d) => "۰۱۲۳۴۵۶۷۸۹"[+d]);
const faDate = (iso: string) => new Intl.DateTimeFormat("fa-IR", { dateStyle: "long", timeZone: "UTC" }).format(new Date(iso + "T00:00:00Z"));

function words(p: Post): number {
  const t = [p.h1, ...p.tldr, ...p.intro, ...p.sections.flatMap((s) => [s.h2, ...(s.paras ?? []), ...(s.list ?? []), ...(s.after ?? []), ...(s.steps ?? []).flatMap((x) => [x.t, x.d]), ...(s.table?.rows.flat() ?? []), ...(s.chips ?? [])]), ...p.faq.flatMap((f) => [f.q, f.a])].map(plain).join(" ");
  return t.split(/\s+/).filter(Boolean).length;
}
const readMin = (p: Post) => Math.max(1, Math.round(words(p) / 200));

function head(o: { title: string; desc: string; url: string; site: string; type: "website" | "article"; ld: unknown; imgAlt: string }): string {
  const { title, desc, url, site } = o;
  return `<!doctype html>
<html lang="fa" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<meta name="robots" content="index,follow,max-image-preview:large,max-snippet:-1">
<meta name="author" content="${BRAND}">
<meta name="theme-color" content="#2563eb">
<link rel="canonical" href="${url}">
<link rel="alternate" hreflang="fa-IR" href="${url}">
<link rel="alternate" hreflang="x-default" href="${url}">
<meta property="og:type" content="${o.type}">
<meta property="og:locale" content="fa_IR">
<meta property="og:site_name" content="${BRAND}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${url}">
<meta property="og:image" content="${site}/og-image.png">
<meta property="og:image:type" content="image/png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="${esc(o.imgAlt)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(desc)}">
<meta name="twitter:image" content="${site}/og-image.png">
<meta name="twitter:image:alt" content="${esc(o.imgAlt)}">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="icon" href="/favicon.ico" sizes="48x48">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="manifest" href="/manifest.webmanifest">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="preload" href="https://fonts.gstatic.com/s/vazirmatn/v16/Dxxo8j6PP2D_kU2muijlGMWWMmk.woff2" as="font" type="font/woff2" crossorigin>
<script type="application/ld+json">${jsonLd(o.ld)}</script>
<style>${CSS}${EXTRA_CSS}</style>
</head>`;
}

function shell(site: string, current: string, main: string): string {
  const nav = PAGES.filter((x) => x.slug !== "ppt-saz").map((x) => `<a href="/${x.slug}">${esc(x.nav)}</a>`).join("") + `<a href="/blog"${current === "blog" ? ' aria-current="page"' : ""}>وبلاگ</a><a href="/#pricing">تعرفه</a>`;
  const guides = PAGES.map((x) => `<li><a href="/${x.slug}">${esc(x.nav)}</a></li>`).join("");
  const arts = POSTS.map((x) => `<li><a href="/blog/${x.slug}">${esc(x.nav)}</a></li>`).join("");
  return `<body>
<header class="top">
  <div class="wrap wide in">
    <a class="brand" href="/" aria-label="${BRAND}"><i>📊</i><span>${BRAND}</span></a>
    <nav class="links" aria-label="منوی اصلی">${nav}</nav>
    <a class="btn sm" href="/#topic">ساخت رایگان</a>
  </div>
</header>
${main}
<footer>
  <div class="wrap wide">
    <div class="ft">
      <div>
        <a class="brand" href="/"><i>📊</i><span>${BRAND}</span></a>
        <p style="margin-top:10px;color:var(--muted)">از یک موضوع ساده تا ارائه‌ای کامل و آماده‌ی نمایش؛ فارسی، راست‌به‌چپ و قابل‌ویرایش.</p>
      </div>
      <div><h4>راهنماها</h4><ul>${guides}</ul></div>
      <div><h4>از وبلاگ</h4><ul>${arts}<li><a href="/blog">همه‌ی مقاله‌ها</a></li></ul></div>
    </div>
    <div class="copy">© ${BRAND} (pptsaz.ir) — همه‌ی حقوق محفوظ است.</div>
  </div>
</footer>
</body>
</html>
`;
}

function renderBlogSection(s: BlogSection, i: number): string {
  let html = renderSection(s).replace("<section><h2>", `<section><h2 id="s${i + 1}">`);
  if (s.chips) {
    const chips = `<div class="chips">${s.chips.map((t) => `<a rel="nofollow" href="/?topic=${encodeURIComponent(t)}">${esc(t)}</a>`).join("")}</div>`;
    html = html.replace(/<\/section>$/, `${chips}</section>`);
  }
  return html;
}

export function renderBlogIndex(site: string): string {
  const url = `${site}/blog`;
  const ld = {
    "@context": "https://schema.org",
    "@graph": [
      { "@type": "Organization", "@id": `${site}/#org`, name: BRAND, url: `${site}/`, logo: { "@type": "ImageObject", url: `${site}/icon-512.png`, width: 512, height: 512 } },
      { "@type": "WebSite", "@id": `${site}/#website`, name: BRAND, alternateName: "pptsaz.ir", url: `${site}/`, inLanguage: "fa-IR", publisher: { "@id": `${site}/#org` } },
      { "@type": "CollectionPage", "@id": `${url}#webpage`, url, name: BLOG_TITLE, description: BLOG_DESC, inLanguage: "fa-IR", isPartOf: { "@id": `${site}/#website` }, breadcrumb: { "@id": `${url}#breadcrumb` } },
      { "@type": "BreadcrumbList", "@id": `${url}#breadcrumb`, itemListElement: [{ "@type": "ListItem", position: 1, name: BRAND, item: `${site}/` }, { "@type": "ListItem", position: 2, name: "وبلاگ", item: url }] },
      { "@type": "ItemList", itemListElement: POSTS.map((p, i) => ({ "@type": "ListItem", position: i + 1, url: `${site}/blog/${p.slug}`, name: p.h1 })) },
    ],
  };
  const sorted = [...POSTS].sort((a, b) => b.date.localeCompare(a.date));
  const main = `<main class="wrap wide">
  <nav class="crumb" aria-label="مسیر صفحه"><ol><li><a href="/">${BRAND}</a></li><li><span aria-current="page">وبلاگ</span></li></ol></nav>
  <div class="hero">
    <h1>وبلاگ <em>پاورپوینت‌ساز فارسی</em></h1>
    <p class="lead">راهنمای کاربردی ساخت و ارائه‌ی پاورپوینت فارسی: ساختار دفاعیه، تعداد اسلاید، ایده‌ی موضوع، طراحی راست‌به‌چپ و ارائه‌ی بدون استرس.</p>
  </div>
  <div class="posts">
${sorted.map((p) => `    <a class="post" href="/blog/${p.slug}"><span class="tag">${esc(p.category)}</span><b>${esc(p.h1)}</b><p>${esc(p.desc)}</p><small>${faDate(p.date)} · ${fa(readMin(p))} دقیقه مطالعه</small></a>`).join("\n")}
  </div>
  <article><section class="final"><h2>یک پیش‌نویس سریع می‌خواهی؟</h2><p>موضوع را بنویس و ظرف چند دقیقه فایل PPTX فارسی و قابل‌ویرایش را بگیر.</p><a class="btn" href="/#topic">✨ رایگان شروع کن</a></section></article>
</main>`;
  return head({ title: BLOG_TITLE, desc: BLOG_DESC, url, site, type: "website", ld, imgAlt: "وبلاگ پاورپوینت‌ساز فارسی" }) + "\n" + shell(site, "blog", main);
}

export function renderPost(p: Post, site: string): string {
  const url = `${site}/blog/${p.slug}`;
  const landing = PAGE_BY_SLUG.get(p.landing);
  const related = p.related.map((s) => POST_BY_SLUG.get(s)).filter((x): x is Post => !!x);
  const ld = {
    "@context": "https://schema.org",
    "@graph": [
      { "@type": "Organization", "@id": `${site}/#org`, name: BRAND, url: `${site}/`, logo: { "@type": "ImageObject", url: `${site}/icon-512.png`, width: 512, height: 512 } },
      { "@type": "WebSite", "@id": `${site}/#website`, name: BRAND, alternateName: "pptsaz.ir", url: `${site}/`, inLanguage: "fa-IR", publisher: { "@id": `${site}/#org` } },
      {
        "@type": "BlogPosting", "@id": `${url}#article`, mainEntityOfPage: { "@id": `${url}#webpage` }, headline: p.h1, description: p.desc, inLanguage: "fa-IR",
        datePublished: p.date, dateModified: p.updated, wordCount: words(p), articleSection: p.category,
        author: { "@id": `${site}/#org` }, publisher: { "@id": `${site}/#org` }, image: { "@type": "ImageObject", url: `${site}/og-image.png`, width: 1200, height: 630 },
      },
      { "@type": "WebPage", "@id": `${url}#webpage`, url, name: p.title, description: p.desc, inLanguage: "fa-IR", isPartOf: { "@id": `${site}/#website` }, breadcrumb: { "@id": `${url}#breadcrumb` }, primaryImageOfPage: { "@type": "ImageObject", url: `${site}/og-image.png`, width: 1200, height: 630 } },
      {
        "@type": "BreadcrumbList", "@id": `${url}#breadcrumb`,
        itemListElement: [
          { "@type": "ListItem", position: 1, name: BRAND, item: `${site}/` },
          { "@type": "ListItem", position: 2, name: "وبلاگ", item: `${site}/blog` },
          { "@type": "ListItem", position: 3, name: p.nav, item: url },
        ],
      },
      { "@type": "FAQPage", "@id": `${url}#faq`, isPartOf: { "@id": `${url}#webpage` }, inLanguage: "fa-IR", mainEntity: p.faq.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: plain(f.a) } })) },
    ],
  };
  const main = `<main class="wrap">
  <nav class="crumb" aria-label="مسیر صفحه"><ol><li><a href="/">${BRAND}</a></li><li><a href="/blog">وبلاگ</a></li><li><span aria-current="page">${esc(p.nav)}</span></li></ol></nav>
  <div class="hero" style="padding-bottom:6px">
    <h1>${esc(p.h1)}</h1>
    <div class="meta"><span>${esc(p.category)}</span><span>آخرین به‌روزرسانی: <time datetime="${p.updated}">${faDate(p.updated)}</time></span><span>${fa(readMin(p))} دقیقه مطالعه</span></div>
  </div>
  <article>
    <section class="tldr"><h2>خلاصه</h2><ul>${p.tldr.map((t) => `<li>${inline(t)}</li>`).join("")}</ul></section>
    <section>${p.intro.map((t) => `<p>${inline(t)}</p>`).join("")}</section>
    <section class="toc"><h2>فهرست مطالب</h2><ol>${p.sections.map((s, i) => `<li><a href="#s${i + 1}">${esc(s.h2)}</a></li>`).join("")}<li><a href="#faq">پرسش‌های متداول</a></li></ol></section>
${p.sections.map(renderBlogSection).join("\n")}
    <section id="faq">
      <h2>پرسش‌های متداول</h2>
${p.faq.map((f) => `      <details><summary>${esc(f.q)}</summary><p>${inline(f.a)}</p></details>`).join("\n")}
    </section>
    <section>
      <h2>مقاله‌های مرتبط</h2>
      <div class="rel">${related.map((r) => `<a href="/blog/${r.slug}">${esc(r.nav)}<span>${esc(r.category)}</span></a>`).join("")}${landing ? `<a href="/${landing.slug}">${esc(landing.nav)}<span>ابزار ساخت</span></a>` : ""}</div>
    </section>
    <section class="final">
      <h2>آماده‌ای پیش‌نویس بگیری؟</h2>
      <p>موضوع را بنویس و ظرف چند دقیقه فایل PPTX فارسی و قابل‌ویرایش را بگیر؛ سهمیه‌ی رایگان روزانه داری.</p>
      <a class="btn" href="/#topic">${esc(p.cta)}</a>
    </section>
  </article>
</main>`;
  return head({ title: p.title, desc: p.desc, url, site, type: "article", ld, imgAlt: p.h1 }) + "\n" + shell(site, "post", main);
}
