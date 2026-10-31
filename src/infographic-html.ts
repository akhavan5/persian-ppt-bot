/**
 * قالب HTML اینفوگرافیک تک‌صفحه‌ای. رنگ‌ها از همان THEMES ارائه‌ها می‌آیند؛ فونت همیشه Vazirmatn است (از Google Fonts، مثل پیش‌نمایش و PDF).
 * بدون ایموجی: Browser Rendering ممکن است فونت ایموجی نداشته باشد؛ به‌جای آیکن، شماره‌ی بخش و شکل‌های CSS استفاده شده است.
 * فقط به themes.ts و util.ts وابسته است تا جدا از Worker هم قابل آزمایش باشد.
 */
import { THEMES, type Theme } from "./themes";
import { toFa } from "./util";
import type { IgBlock, IgLayout, Infographic } from "./infographic";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** پوستر افقی ۶۴۰۰px (قبلاً ۵۱۲۰، ۴۲۴۰ و ۳۴۵۶): با همان اندازه‌ی فونت، هر ستون حدود ۲۵٪ پهن‌تر از ۵۱۲۰ می‌شود (جدول و کارت کمتر می‌شکنند)؛ عکس‌ِ تلگرام از سقف ۱۰۰۰۰px می‌گذرد و فقط فایل کامل (sendDocument) فرستاده می‌شود */
export const IG_WIDTH: Record<IgLayout, number> = { wide: 6400, tall: 1200 };

export interface IgRenderOpts {
  theme: string;
  digits: boolean;
  layout: IgLayout;
  /** تصویر تزئینی (data: URI)؛ خالی = بدون تصویر */
  image?: string;
  /** نشانی سایت برای پانویس (فقط نام دامنه نشان داده می‌شود) */
  site?: string;
  /** false = بدون واترمارک (نام دامنه‌ی پانویس)؛ نشانی سایت برای فونت‌ها همچنان استفاده می‌شود */
  mark?: boolean;
}

export function renderInfographicHtml(ig: Infographic, o: IgRenderOpts): string {
  const t: Theme = THEMES[o.theme] ?? THEMES.ocean;
  const W = IG_WIDTH[o.layout];
  const cols = o.layout === "wide" ? 4 : 2;
  const base = o.layout === "wide" ? 74 : 24; // پوستر افقی: فونت پایه ۴۰ ← ۴۸ ← ۵۸ ← ۶۸ ← ۷۴ (در مجموع ۴۵٪ بزرگ‌تر از اول) تا در پیش‌نمایش تلگرام خواناتر باشد؛ ۴ ستون در ۶۴۰۰px. اگر مجموع ابعاد عکس (با مقیاس ۱.۵) از سقف ۱۰۰۰۰px تلگرام بگذرد، فقط فایل کامل فرستاده می‌شود (sendDocument)
  const tx = (s: string) => esc(o.digits ? toFa(String(s)) : String(s));
  const num = (n: number) => (o.digits ? toFa(String(n)) : String(n));
  const dark = t.bg.toUpperCase() < "808080"; // پس‌زمینه‌ی تیره (مثل تم نیمه‌شب)

  const label = (l: string, fallback: string) => `<div class="lb">${tx(l || fallback)}</div>`;
  const maxBar = (items: { value: number }[]) => Math.max(...items.map((i) => i.value), 1);

  // KaTeX حروف فارسی را در یک خط بدون شکستن می‌چیند و از کادر بیرون می‌زند؛ پس برای فرمول‌هایی که «tex» آن حرف فارسی دارد فقط متن ساده نشان داده می‌شود
  const texOk = (b: { tex?: string }) => !!b.tex && !/[\u0600-\u06FF]/.test(b.tex);
  const block = (b: IgBlock): string => {
    switch (b.type) {
      case "definition": return `<div class="bk def">${label(b.label, "تعریف")}<p>${tx(b.text)}</p></div>`;
      case "keyfact": return `<div class="bk key">${label(b.label, "نکته‌ی کلیدی")}<p>${tx(b.text)}</p></div>`;
      case "example": return `<div class="bk ex">${label(b.label, "مثال")}<p>${tx(b.text)}</p></div>`;
      case "warning": return `<div class="bk wn">${label(b.label, "هشدار")}<p>${tx(b.text)}</p></div>`;
      case "tip": return `<div class="bk tp">${label(b.label, "نکته‌ی طلایی")}<p>${tx(b.text)}</p></div>`;
      case "formula": return `<div class="bk fm">${b.label ? label(b.label, "") : ""}<p dir="${texOk(b) ? "ltr" : "auto"}"${texOk(b) ? ` data-tex="${esc(b.tex!)}"` : ""}>${esc(b.text)}</p></div>`;
      case "flow": {
        const horiz = b.items.length <= 3;
        const node = (s: { label: string; text: string }) => `<div class="nd">${s.label ? `<b>${tx(s.label)}</b>` : ""}${s.text ? `<span>${tx(s.text)}</span>` : ""}</div>`;
        return `<div class="bk fl ${horiz ? "h" : "v"}">${b.label ? label(b.label, "") : ""}<div class="fx">${b.items.map(node).join('<i class="ar"></i>')}</div></div>`;
      }
      case "timeline": return `<div class="bk tl">${b.label ? label(b.label, "") : ""}<ol>${b.items.map((i) =>
        `<li>${i.label ? `<b>${tx(i.label)}</b>` : ""}${i.text ? `<span>${tx(i.text)}</span>` : ""}</li>`).join("")}</ol></div>`;
      case "donut": {
        const sum = b.items.reduce((a, i) => a + i.value, 0) || 1;
        let acc = 0;
        const stops = b.items.map((i, k) => { const from = acc; acc += (i.value / sum) * 100; return `var(--d${k}) ${from.toFixed(2)}% ${acc.toFixed(2)}%`; }).join(",");
        return `<div class="bk dn">${b.label ? label(b.label, "") : ""}<div class="dr"><div class="ring" style="background:conic-gradient(${stops})"></div><ul>${b.items.map((i, k) =>
          `<li><s style="background:var(--d${k})"></s><span>${tx(i.label)}</span><em dir="ltr">${tx(String(i.value))}${tx(b.unit)}</em></li>`).join("")}</ul></div></div>`;
      }
      case "cards": return `<div class="bk cd">${b.items.map((i) => `<div class="c"><b>${tx(i.title)}</b><span>${tx(i.text)}</span></div>`).join("")}</div>`;
      case "glossary": return `<div class="bk gl">${b.items.map((i) => `<div class="g"><b>${tx(i.term)}</b><span>${tx(i.text)}</span></div>`).join("")}</div>`;
      case "bullets": return `<div class="bk">${b.label ? label(b.label, "") : ""}<ul>${b.items.map((i) => `<li>${tx(i)}</li>`).join("")}</ul></div>`;
      case "stats": return `<div class="bk st">${b.items.map((s) => {
        // مقدارهایی مثل «۲۱۳ (۲۰٫۴٪)»: عدد اصلی بزرگ، بخش داخل پرانتز در خط دوم و کوچک‌تر (برای جلوگیری از بیرون‌زدگی کارت)
        const raw = String(s.value).trim();
        const m = raw.match(/^(.+?)\s*([(（][^)）]*[)）])$/);
        const main = m ? m[1] : raw;
        const sub = m ? m[2] : "";
        const len = [...main].length;
        const sz = len > 9 ? " z3" : len > 6 ? " z2" : "";
        return `<div class="s${sz}"><b>${tx(main)}${sub ? `<small dir="ltr">${tx(sub)}</small>` : ""}</b><span>${tx(s.label)}</span></div>`;
      }).join("")}</div>`;
      case "table": return `<div class="bk tb"><table><thead><tr>${b.headers.map((h) => `<th>${tx(h)}</th>`).join("")}</tr></thead><tbody>${
        b.rows.map((r) => `<tr>${r.map((c) => `<td>${tx(c)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
      case "steps": return `<div class="bk sp">${b.label ? label(b.label, "") : ""}<ol>${b.items.map((s, i) =>
        `<li><i>${num(i + 1)}</i><div>${s.label ? `<b>${tx(s.label)}</b>` : ""}${s.text ? `<span>${tx(s.text)}</span>` : ""}</div></li>`).join("")}</ol></div>`;
      case "compare": return `<div class="bk cmp">${[b.left, b.right].map((s, k) =>
        `<div class="c${k}"><h4>${tx(s.title)}</h4><ul>${s.items.map((i) => `<li>${tx(i)}</li>`).join("")}</ul></div>`).join("")}</div>`;
      case "bars": {
        const m = maxBar(b.items);
        return `<div class="bk br">${b.label ? label(b.label, "") : ""}${b.items.map((i) =>
          `<div class="r"><span>${tx(i.label)}</span><div class="tr"><div class="f" style="width:${Math.max(4, Math.round((i.value / m) * 100))}%"></div></div><em dir="ltr">${tx(String(i.value))}${tx(i.text)}</em></div>`).join("")}</div>`;
      }
    }
  };

  // چیدمان ستون‌ها: ارتفاع هر پنل تخمین زده می‌شود و پنل بعدی در کوتاه‌ترین ستون می‌نشیند (شماره‌ی پنل‌ها ترتیب مطالعه را نشان می‌دهد)؛
  // ستون‌بندی خودکار CSS ستون‌ها را نامتوازن می‌کرد
  const cpl = Math.max(20, Math.floor(((W - base * 2.8 - base * 1.1 * (cols - 1)) / cols - base * 3) / (base * 0.52))); // تعداد نویسه در هر خط
  const lines = (s: string, w = cpl) => Math.max(1, Math.ceil(s.length / w));
  const lh = base * 1.55;
  const estimate = (b: IgBlock): number => {
    switch (b.type) {
      case "definition": case "keyfact": case "example": case "warning": case "tip": return base * 2.4 + lines(b.text) * lh;
      case "formula": return base * 2.2 + lines(b.text, cpl - 6) * lh + (texOk(b) ? base * 1.2 : 0);
      case "flow": {
        const n = b.items.length, mx = Math.max(...b.items.map((i) => i.text.length));
        return (b.label ? base * 1.4 : 0) + (n <= 3
          ? base * 2.6 + lines(String(" ").repeat(mx), Math.max(8, Math.floor(cpl / n) - 4)) * base * 1.25
          : n * (base * 1.9 + lines(String(" ").repeat(mx), cpl - 6) * base * 1.25) + (n - 1) * base * 0.9);
      }
      case "timeline": return (b.label ? base * 1.4 : 0) + b.items.reduce((a, i) => a + base * 1.5 + lines(i.text, cpl - 8) * base * 1.25 + base * 0.3, 0);
      case "donut": return (b.label ? base * 1.4 : 0) + Math.max(base * 7.2, b.items.length * base * 1.6) + base * 0.4;
      case "cards": return Math.ceil(b.items.length / 2) * (base * 2.3 + lines(String(" ").repeat(Math.max(...b.items.map((i) => i.text.length))), Math.max(10, Math.floor(cpl / 2) - 3)) * base * 1.25 + base * 0.5);
      case "glossary": return b.items.reduce((a, i) => a + lines(i.term + " " + i.text, cpl) * base * 1.3 + base * 0.6, 0);
      case "bullets": return (b.label ? base * 1.4 : 0) + b.items.reduce((a, i) => a + lines(i, cpl - 3) * lh + base * 0.4, 0);
      case "stats": return base * (b.items.some((i) => /[(（]/.test(String(i.value))) ? 6.2 : 4.6);
      case "table": return base * 2 + b.rows.reduce((a, r) => a + Math.max(...r.map((c) => lines(c, Math.floor(cpl / b.headers.length) - 1))) * base * 1.25 + base * 0.8, 0);
      case "steps": return (b.label ? base * 1.4 : 0) + b.items.reduce((a, i) => a + base * 1.4 + lines(i.text, cpl - 5) * base * 1.2 + base * 0.4, 0);
      case "compare": return base * 2.4 + Math.max(b.left.items.length, b.right.items.length) * base * 2.4;
      case "bars": return (b.label ? base * 1.4 : 0) + b.items.length * base * 1.6;
    }
  };
  const heights = new Array<number>(cols).fill(0);
  const colHtml = new Array<string>(cols).fill("");
  ig.sections.forEach((s, i) => {
    const k = heights.indexOf(Math.min(...heights));
    colHtml[k] += `<section class="pn" data-i="${i}"><header><span class="no">${num(i + 1)}</span><h2>${tx(s.title)}</h2></header><div class="bd">${s.blocks.map(block).join("")}</div></section>`;
    heights[k] += base * 3.6 + s.blocks.reduce((a, b) => a + estimate(b) + base * 0.6, 0) + base * 1.1;
  });
  const panels = colHtml.filter(Boolean).map((h) => `<div class="col">${h}</div>`).join("");

  const hls = ig.highlights?.length
    ? `<div class="hls">${ig.highlights.map((h) => `<div class="h"><b>${tx(h.value)}</b><span>${tx(h.label)}</span></div>`).join("")}</div>`
    : "";
  // KaTeX فقط وقتی فرمول LaTeX دارد از CDN بارگذاری می‌شود؛ اگر بارگذاری نشد، همان متن ساده‌ی فرمول می‌ماند
  const hasTex = ig.sections.some((sec) => sec.blocks.some((bl) => bl.type === "formula" && texOk(bl)));
  const katex = hasTex
    ? `<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.css">
<script src="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.js"></script>`
    : "";
  const katexRun = hasTex
    ? `<script>try{document.querySelectorAll("[data-tex]").forEach(function(e){try{window.katex.render(e.getAttribute("data-tex"),e,{throwOnError:true,displayMode:true})}catch(x){}})}catch(x){}
function fit(){try{[].slice.call(document.querySelectorAll(".fm p[data-tex]")).forEach(function(p){var s=parseFloat(getComputedStyle(p).fontSize),n=0;while(p.scrollWidth>p.clientWidth+1&&s>${Math.round(base * 0.6)}&&n<25){s*=0.93;p.style.fontSize=s+"px";n++}})}catch(x){}}
window.addEventListener("load",function(){(document.fonts&&document.fonts.ready?document.fonts.ready:Promise.resolve()).then(fit)})</script>`
    : "";

  // توازن ستون‌ها با ارتفاع واقعی: بعد از بارگذاری فونت، ارتفاع هر پنل اندازه گرفته می‌شود و بهترین چیدمان (کمترین ارتفاع بلندترین ستون) انتخاب می‌شود.
  // عرض ستون‌ها داینامیک است: پنلی که جدول چندستونه، مقایسه، کارت یا فلو افقی دارد ستونش را پهن‌تر می‌خواهد (وزن ۱ تا ۱.۴)؛ عرض ستون‌ها به نسبت این وزن‌ها پخش می‌شود
  // و ارتفاع هر پنل در انتخاب چیدمان بر اساس عرض جدیدش تقریب زده می‌شود. اگر اجرای اسکریپت ممکن نشد، همان چیدمان تخمینی بالا با ستون‌های هم‌عرض می‌ماند.
  const balance = `<script>(function(){function pw(p){var w=1;[].slice.call(p.querySelectorAll(".bk")).forEach(function(b){var k=1,c=b.classList;
if(c.contains("tb")){var n=b.querySelectorAll("th").length;k=n>=4?1.4:n==3?1.2:1}
else if(c.contains("cmp"))k=1.25;else if(c.contains("cd"))k=1.15;else if(c.contains("fl")&&c.contains("h"))k=1.15;else if(c.contains("st")&&b.children.length>=3)k=1.15;
if(k>w)w=k});return w}
function go(){try{var cols=[].slice.call(document.querySelectorAll(".col")),n=cols.length;if(n<2)return;
var ps=[].slice.call(document.querySelectorAll(".pn"));ps.sort(function(a,b){return a.getAttribute("data-i")-b.getAttribute("data-i")});
var m=ps.length,h=ps.map(function(p){return p.offsetHeight}),wt=ps.map(pw),total=Math.pow(n,m);if(total>70000)return;
var best=0,bs=1e12,bw=null;for(var k=0;k<total;k++){var x=k,a=[],cw=[],i,top=-1,ok=true;for(i=0;i<n;i++)cw.push(1);
for(i=0;i<m;i++){var c=x%n;x=Math.floor(x/n);if(c>top+1){ok=false;break}if(c>top)top=c;a.push(c);if(wt[i]>cw[c])cw[c]=wt[i]}
if(!ok)continue;var sw=0,s=[];for(i=0;i<n;i++){sw+=cw[i];s.push(0)}
for(i=0;i<m;i++){s[a[i]]+=h[i]*(0.3+0.7*(cw[a[i]]?(1/n)/(cw[a[i]]/sw):1))}
var mx=Math.max.apply(null,s),mn=Math.min.apply(null,s),sc=mx*1000+(mx-mn);if(sc<bs){bs=sc;best=k;bw=cw}}
var x2=best;ps.forEach(function(p,i){cols[x2%n].appendChild(p);x2=Math.floor(x2/n)});
if(bw)cols.forEach(function(c,i){c.style.flex=bw[i]+" 1 0"})}catch(e){}}
window.addEventListener("load",function(){(document.fonts&&document.fonts.ready?document.fonts.ready:Promise.resolve()).then(go)})})()</script>`;

  let host = "", origin = "https://pptsaz.ir";
  try { if (o.site) { const u = new URL(o.site); host = u.hostname.replace(/^www\./, ""); origin = u.origin; } } catch { /* نشانی نامعتبر */ }
  // فونت وزیرمتن از خود سایت (CORS باز است)؛ به Google Fonts در مرورگر راه دور (REST) تکیه نمی‌کنیم
  const fontFace = `@font-face{font-family:'Vazirmatn';font-weight:100 600;font-style:normal;font-display:block;src:url('${origin}/fonts/Vazirmatn-Regular.woff2') format('woff2'),url('${origin}/fonts/Vazirmatn-Regular.ttf') format('truetype')}` +
    `@font-face{font-family:'Vazirmatn';font-weight:700 900;font-style:normal;font-display:block;src:url('${origin}/fonts/Vazirmatn-Bold.woff2') format('woff2'),url('${origin}/fonts/Vazirmatn-Bold.ttf') format('truetype')}`;

  const css = `
:root{--bg:#${t.bg};--sf:#${t.surface};--pr:#${t.primary};--dk:#${t.dark};--ac:#${t.accent};--tx:#${t.text};--mt:#${t.muted};--on:#${t.onPrimary};
--hl:#${dark ? t.accent : t.primary};--d0:var(--pr);--d1:var(--ac);--d2:color-mix(in srgb,var(--pr) 50%,var(--ac));--d3:color-mix(in srgb,var(--pr) 45%,var(--bg));--d4:color-mix(in srgb,var(--ac) 45%,var(--bg));
--rd:#d64545;--gn:#2f9e6b;--line:color-mix(in srgb,var(--pr) 28%,var(--bg));--tint:color-mix(in srgb,var(--ac) ${dark ? 18 : 14}%,var(--bg));--soft:color-mix(in srgb,var(--pr) ${dark ? 16 : 7}%,var(--bg))}
*{box-sizing:border-box}
html,body{margin:0;padding:0}
body{width:${W}px;background:var(--soft);color:var(--tx);font-family:'Vazirmatn','Tahoma',sans-serif;font-size:${base}px;line-height:1.55;direction:rtl}
.top{background:var(--dk);color:var(--on);padding:${base * 1.5}px ${base * 2}px;display:flex;align-items:center;justify-content:space-between;gap:${base * 1.5}px;border-bottom:${base / 4}px solid var(--ac)}
.top .tt{flex:1;min-width:0}
.top h1{margin:0;font-size:${base * 2.1}px;line-height:1.35;font-weight:800}
.top p{margin:${base * 0.4}px 0 0;font-size:${base * 0.95}px;opacity:.82}
.top img{width:${Math.round(base * (o.layout === "wide" ? 15.2 : 10.8))}px;height:${Math.round(base * (o.layout === "wide" ? 8.8 : 6.7))}px;object-fit:cover;border-radius:${base * 0.7}px;border:3px solid var(--ac);flex:none}
.wrap{padding:${base * 1.2}px ${base * 1.4}px ${base * 0.6}px}
.cols{display:flex;gap:${base * 1.1}px;align-items:stretch}
.col{flex:1;min-width:0;display:flex;flex-direction:column}
.col>.pn:last-child{flex:1;margin-bottom:0;display:flex;flex-direction:column}
.col>.pn:last-child>.bd{flex:1}
.pn{margin:0 0 ${base * 1.1}px;border:2px solid var(--line);border-radius:${base * 0.7}px;background:var(--bg);overflow:hidden}
.pn>header{background:var(--pr);color:var(--on);display:flex;align-items:center;gap:${base * 0.6}px;padding:${base * 0.55}px ${base * 0.8}px}
.pn .no{flex:none;width:${base * 1.7}px;height:${base * 1.7}px;border-radius:50%;background:var(--ac);color:var(--dk);display:flex;align-items:center;justify-content:center;font-weight:800;font-size:${base * 0.95}px}
.pn h2{margin:0;font-size:${base * 1.12}px;line-height:1.4;font-weight:700}
.bd{padding:${base * 0.7}px;display:flex;flex-direction:column;gap:${base * 0.6}px}
.bk{border-radius:${base * 0.45}px}
.bk p{margin:0}
.bk ul{margin:0;padding:0 ${base * 1.1}px 0 0}
.bk li{margin:${base * 0.18}px 0}
.bk li::marker{color:var(--ac)}
.lb{display:inline-block;font-size:${base * 0.72}px;font-weight:700;letter-spacing:.01em;padding:${base * 0.05}px ${base * 0.55}px;border-radius:${base * 0.3}px;background:var(--pr);color:var(--on);margin-bottom:${base * 0.3}px}
.def{background:var(--tint);padding:${base * 0.6}px ${base * 0.75}px;border-right:${base * 0.2}px solid var(--ac)}
.key{background:var(--sf);padding:${base * 0.6}px ${base * 0.75}px;border:1.5px solid var(--line)}
.key .lb{background:var(--ac);color:var(--dk)}
.ex{border:2px dashed var(--line);padding:${base * 0.6}px ${base * 0.75}px}
.ex .lb{background:var(--dk)}
.fm{background:var(--dk);color:var(--on);padding:${base * 0.7}px ${base * 0.75}px;text-align:center;font-size:${base * 1.02}px;font-weight:700}
.fm .lb{background:var(--ac);color:var(--dk)}
.fm p{overflow-wrap:anywhere}
.st{display:flex;gap:${base * 0.5}px}
.st .s{flex:1 1 0;min-width:0;background:var(--sf);border:1.5px solid var(--line);border-radius:${base * 0.45}px;padding:${base * 0.55}px ${base * 0.4}px;text-align:center}
.st b{display:block;font-size:${base * 1.7}px;line-height:1.2;color:var(--hl);font-weight:800;overflow-wrap:anywhere}
.st .z2 b{font-size:${base * 1.4}px}
.st .z3 b{font-size:${base * 1.15}px}
.st b small{display:block;font-size:.6em;font-weight:700;line-height:1.3;unicode-bidi:plaintext;overflow-wrap:anywhere}
.st span{display:block;font-size:${base * 0.78}px;color:var(--mt);margin-top:${base * 0.12}px;overflow-wrap:anywhere}
.tb table{width:100%;border-collapse:collapse;font-size:${base * 0.84}px;overflow:hidden;border-radius:${base * 0.4}px}
.tb th{background:var(--pr);color:var(--on);padding:${base * 0.3}px ${base * 0.4}px;text-align:center;font-weight:700}
.tb td{padding:${base * 0.3}px ${base * 0.4}px;text-align:center;border-bottom:1px solid var(--line)}
.tb tbody tr:nth-child(even) td{background:var(--sf)}
.sp ol{list-style:none;margin:0;padding:0}
.sp li{display:flex;gap:${base * 0.55}px;align-items:flex-start;margin:0 0 ${base * 0.4}px;position:relative}
.sp i{flex:none;width:${base * 1.35}px;height:${base * 1.35}px;border-radius:50%;background:var(--pr);color:var(--on);font-style:normal;font-weight:700;font-size:${base * 0.78}px;display:flex;align-items:center;justify-content:center;margin-top:${base * 0.05}px}
.sp li div{flex:1}
.sp b{display:block;font-size:${base * 0.92}px;line-height:1.4}
.sp span{display:block;font-size:${base * 0.82}px;color:var(--mt)}
.cmp{display:flex;gap:${base * 0.5}px}
.cmp>div{flex:1;border:1.5px solid var(--line);border-radius:${base * 0.45}px;overflow:hidden;background:var(--bg)}
.cmp h4{margin:0;padding:${base * 0.3}px ${base * 0.5}px;text-align:center;font-size:${base * 0.9}px;background:var(--pr);color:var(--on)}
.cmp .c1 h4{background:var(--dk)}
.cmp ul{padding:${base * 0.45}px ${base * 1.2}px ${base * 0.45}px ${base * 0.4}px;font-size:${base * 0.84}px}
.br .r{display:flex;align-items:center;gap:${base * 0.45}px;margin:${base * 0.25}px 0;font-size:${base * 0.82}px}
.br .r span{flex:0 0 32%}
.br .tr{flex:1;height:${base * 0.6}px;background:var(--sf);border-radius:99px;overflow:hidden;border:1px solid var(--line)}
.br .f{height:100%;background:var(--ac);border-radius:99px}
.br em{flex:0 0 auto;font-style:normal;font-weight:700;min-width:${base * 2.2}px;text-align:left;color:var(--hl)}
.wn{background:color-mix(in srgb,var(--rd) 13%,var(--bg));padding:${base * 0.6}px ${base * 0.75}px;border-right:${base * 0.2}px solid var(--rd)}
.wn .lb{background:var(--rd);color:#fff}
.tp{background:color-mix(in srgb,var(--gn) 13%,var(--bg));padding:${base * 0.6}px ${base * 0.75}px;border-right:${base * 0.2}px solid var(--gn)}
.tp .lb{background:var(--gn);color:#fff}
.fm .katex{font-size:1.12em;color:var(--on)}
.fm .katex-display{margin:${base * 0.2}px 0}
.fl .fx{display:flex;gap:${base * 0.35}px;align-items:stretch}
.fl.v .fx{flex-direction:column;align-items:stretch}
.fl .nd{flex:1;min-width:0;background:var(--sf);border:1.5px solid var(--line);border-radius:${base * 0.45}px;padding:${base * 0.4}px ${base * 0.5}px;text-align:center}
.fl .nd b{display:block;font-size:${base * 0.9}px;line-height:1.4;color:var(--hl)}
.fl .nd span{display:block;font-size:${base * 0.78}px;color:var(--mt);line-height:1.45}
.fl .ar{flex:none;width:0;height:0;align-self:center}
.fl.h .ar{border-top:${base * 0.4}px solid transparent;border-bottom:${base * 0.4}px solid transparent;border-right:${base * 0.6}px solid var(--ac)}
.fl.v .ar{border-right:${base * 0.45}px solid transparent;border-left:${base * 0.45}px solid transparent;border-top:${base * 0.6}px solid var(--ac);margin:${base * 0.05}px 0}
.tl ol{list-style:none;margin:0;padding:0 ${base * 0.9}px 0 0;border-right:${base * 0.12}px solid var(--line)}
.tl li{position:relative;margin:0 0 ${base * 0.5}px;padding-right:${base * 0.7}px}
.tl li::before{content:"";position:absolute;right:${-base * 0.5}px;top:${base * 0.45}px;width:${base * 0.55}px;height:${base * 0.55}px;border-radius:50%;background:var(--ac);border:${base * 0.1}px solid var(--bg)}
.tl b{display:inline-block;font-size:${base * 0.85}px;color:var(--hl);margin-inline-end:${base * 0.4}px}
.tl span{font-size:${base * 0.84}px}
.dn .dr{display:flex;align-items:center;gap:${base * 0.8}px}
.dn .ring{flex:none;width:${base * 6.2}px;height:${base * 6.2}px;border-radius:50%;position:relative}
.dn .ring::after{content:"";position:absolute;inset:28%;border-radius:50%;background:var(--bg)}
.dn ul{list-style:none;margin:0;padding:0;flex:1;min-width:0}
.dn li{display:flex;align-items:center;gap:${base * 0.4}px;margin:${base * 0.2}px 0;font-size:${base * 0.82}px}
.dn li s{flex:none;width:${base * 0.7}px;height:${base * 0.7}px;border-radius:${base * 0.15}px}
.dn li span{flex:1;min-width:0}
.dn li em{flex:none;font-style:normal;font-weight:700;color:var(--hl)}
.cd{display:flex;flex-wrap:wrap;gap:${base * 0.5}px}
.cd .c{flex:1 1 calc(50% - ${base * 0.25}px);min-width:0;background:var(--sf);border:1.5px solid var(--line);border-top:${base * 0.2}px solid var(--ac);border-radius:${base * 0.45}px;padding:${base * 0.4}px ${base * 0.55}px}
.cd b{display:block;font-size:${base * 0.9}px;line-height:1.4;color:var(--hl)}
.cd span{display:block;font-size:${base * 0.8}px;color:var(--mt);line-height:1.5}
.gl .g{padding:${base * 0.3}px 0;border-bottom:1px dashed var(--line);font-size:${base * 0.84}px}
.gl .g:last-child{border-bottom:0}
.gl b{color:var(--hl);margin-inline-end:${base * 0.4}px}
.gl b::after{content:":"}
.hls{display:flex;gap:${base * 0.7}px;margin:0 0 ${base * 1.1}px}
.hls .h{flex:1;background:var(--bg);border:2px solid var(--line);border-bottom:${base * 0.2}px solid var(--ac);border-radius:${base * 0.6}px;padding:${base * 0.5}px ${base * 0.6}px;text-align:center}
.hls b{display:block;font-size:${base * 2}px;line-height:1.2;color:var(--hl);font-weight:800}
.hls span{display:block;font-size:${base * 0.82}px;color:var(--mt);margin-top:${base * 0.1}px}
.take{margin:0 ${base * 1.4}px ${base * 0.9}px;background:var(--dk);color:var(--on);border-radius:${base * 0.7}px;padding:${base * 0.8}px ${base * 1.1}px;display:flex;align-items:center;gap:${base * 0.8}px;border-right:${base * 0.3}px solid var(--ac)}
.take .lb{margin:0;background:var(--ac);color:var(--dk);font-size:${base * 0.8}px;flex:none}
.take p{margin:0;font-size:${base * 1.02}px;font-weight:700}
.ft{padding:0 ${base * 1.4}px ${base * 0.9}px;text-align:left;color:var(--mt);font-size:${base * 0.7}px;direction:ltr}`;

  return `<!doctype html>
<html lang="fa" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=${W}">
<title>${esc(ig.title)}</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Vazirmatn:wght@400;500;700;800&display=swap">
${katex}
<style>${fontFace}${css}</style></head>
<body>
<div class="top"><div class="tt"><h1>${tx(ig.title)}</h1>${ig.subtitle ? `<p>${tx(ig.subtitle)}</p>` : ""}</div>${o.image ? `<img src="${o.image}" alt="">` : ""}</div>
<div class="wrap">${hls}<div class="cols">${panels}</div></div>
${ig.takeaway ? `<div class="take"><span class="lb">جمع‌بندی</span><p>${tx(ig.takeaway)}</p></div>` : ""}
${host && o.mark !== false ? `<div class="ft">${esc(host)}</div>` : ""}
${katexRun}
${balance}
</body></html>`;
}
