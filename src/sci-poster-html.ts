/**
 * قالب HTML پوستر علمی چاپی با اندازه‌ی فیزیکی (mm). همه‌ی اندازه‌ها بر پایه‌ی طراحی A0 هستند و با ضریب --u
 * (A0=1، A1≈0.707، A2=0.5) کوچک می‌شوند، پس یک چیدمان در هر سه اندازه یکسان درمی‌آید.
 * فقط رنگ تخت و حاشیه (بدون سایه و گرادیان) تا در PDF برداری بماند.
 * اسکریپت «fit» اندازه‌ی متن ستون‌ها را طوری تنظیم می‌کند که محتوا دقیقاً یک صفحه را پر کند (هیچ‌وقت صفحه‌ی دوم ساخته نمی‌شود).
 * فقط به themes.ts و util.ts وابسته است.
 */
import { THEMES, type Theme } from "./themes";
import { toFa } from "./util";
import { posterGeometry, type PosterCfg, type PsBlock, type SciPoster } from "./sci-poster";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function renderPosterHtml(p: SciPoster, cfg: PosterCfg, o: { site?: string } = {}): string {
  const g = posterGeometry(cfg);
  const t: Theme = THEMES[cfg.theme] ?? THEMES.ocean;
  const fa = cfg.lang === "fa";
  const tx = (s: string) => esc(fa ? toFa(String(s)) : String(s));
  const label = (l: string) => (l ? `<div class="lb">${tx(l)}</div>` : "");
  const maxBar = (items: { value: number }[]) => Math.max(...items.map((i) => i.value), 1);
  // KaTeX حروف فارسی را بدون شکستن می‌چیند؛ پس برای tex دارای حرف فارسی فقط متن ساده نشان داده می‌شود
  const texOk = (b: { tex?: string }) => !!b.tex && !/[\u0600-\u06FF]/.test(b.tex);

  const block = (b: PsBlock): string => {
    switch (b.type) {
      case "p": return `<div class="bk"><p>${tx(b.text)}</p></div>`;
      case "bullets": return `<div class="bk"><ul>${b.items.map((i) => `<li>${tx(i)}</li>`).join("")}</ul></div>`;
      case "key": return `<div class="bk key">${label(b.label)}<p>${tx(b.text)}</p></div>`;
      case "formula": return `<div class="bk fm">${label(b.label)}<p dir="ltr"${texOk(b) ? ` data-tex="${esc(b.tex!)}"` : ""}>${esc(b.text)}</p></div>`;
      case "table": return `<div class="bk tb">${b.caption ? `<div class="cap">${tx(b.caption)}</div>` : ""}<table><thead><tr>${b.headers.map((h) => `<th>${tx(h)}</th>`).join("")}</tr></thead><tbody>${
        b.rows.map((r) => `<tr>${r.map((c) => `<td>${tx(c)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
      case "bars": {
        const m = maxBar(b.items);
        return `<div class="bk br">${label(b.label)}${b.items.map((i) =>
          `<div class="r"><span>${tx(i.label)}</span><div class="tr"><div class="f" style="width:${Math.max(3, Math.round((i.value / m) * 100))}%"></div></div><em dir="ltr">${tx(String(i.value))}${tx(b.unit)}</em></div>`).join("")}</div>`;
      }
      case "flow": return `<div class="bk fl">${label(b.label)}${b.items.map((s) =>
        `<div class="nd">${s.label ? `<b>${tx(s.label)}</b>` : ""}${s.text ? `<span>${tx(s.text)}</span>` : ""}</div>`).join('<i class="ar"></i>')}</div>`;
      case "stats": return `<div class="bk st">${b.items.map((s) => `<div class="s"><b dir="ltr">${tx(s.value)}</b><span>${tx(s.label)}</span></div>`).join("")}</div>`;
      case "refs": return `<div class="bk rf"><ol>${b.items.map((i) => `<li dir="auto">${esc(i)}</li>`).join("")}</ol></div>`; // منابع همان‌طور که در متن بودند (بدون تبدیل رقم)
    }
  };

  const sections = p.sections.map((s) => {
    const isRefs = s.blocks.every((b) => b.type === "refs");
    return `<section class="sec${isRefs ? " refsec" : ""}"><h2>${tx(s.title)}</h2>${s.blocks.map(block).join("")}</section>`;
  }).join("");

  const sep = fa ? "، " : ", ";
  const authors = p.authors.length
    ? `<div class="au">${p.authors.map((a) => `<span>${tx(a.name)}${a.aff.length ? `<sup>${tx(a.aff.join(","))}</sup>` : ""}</span>`).join(`<i>${sep}</i>`)}</div>`
    : "";
  const affs = p.affiliations.length
    ? `<div class="af">${p.affiliations.map((a, i) => `<span>${p.authors.some((x) => x.aff.length) ? `<sup>${tx(String(i + 1))}</sup> ` : ""}${tx(a)}</span>`).join("")}</div>`
    : "";
  const conf = p.conference ? `<div class="cf">${tx(p.conference)}</div>` : "";
  const footer = p.contact ? `<footer class="ft"><span dir="auto">${esc(p.contact)}</span></footer>` : "";

  const hasTex = p.sections.some((sec) => sec.blocks.some((bl) => bl.type === "formula" && texOk(bl)));
  const katex = hasTex
    ? `<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.css">\n<script src="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.js"></script>`
    : "";

  let origin = "https://pptsaz.ir";
  try { if (o.site) origin = new URL(o.site).origin; } catch { /* نشانی نامعتبر */ }
  // فونت وزیرمتن از خود سایت؛ به Google Fonts در مرورگر راه دور تکیه نمی‌کنیم
  const fontFace = `@font-face{font-family:'Vazirmatn';font-weight:100 600;font-style:normal;font-display:block;src:url('${origin}/fonts/Vazirmatn-Regular.woff2') format('woff2'),url('${origin}/fonts/Vazirmatn-Regular.ttf') format('truetype')}` +
    `@font-face{font-family:'Vazirmatn';font-weight:700 900;font-style:normal;font-display:block;src:url('${origin}/fonts/Vazirmatn-Bold.woff2') format('woff2'),url('${origin}/fonts/Vazirmatn-Bold.ttf') format('truetype')}`;

  const land = cfg.orient === "l";
  const dir = fa ? "rtl" : "ltr";
  const U = (n: number) => `calc(${n} * var(--u))`;
  const S = (n: number) => `calc(${n} * var(--s))`;
  const css = `
${fontFace}
@page{size:${g.pageW}mm ${g.pageH}mm;margin:0}
:root{--u:${g.u.toFixed(5)}pt;--f:1;--s:calc(var(--u) * var(--f));--bl:${g.bleed}mm;
--bg:#${t.bg};--sf:#${t.surface};--pr:#${t.primary};--dk:#${t.dark};--ac:#${t.accent};--tx:#${t.text};--mt:#${t.muted};--on:#${t.onPrimary};
--rd:#c0392b;--line:color-mix(in srgb,var(--pr) 35%,var(--bg));--tint:color-mix(in srgb,var(--ac) 14%,var(--bg));--soft:color-mix(in srgb,var(--pr) 7%,var(--bg))}
*{box-sizing:border-box}
html{background:var(--bg);-webkit-print-color-adjust:exact;print-color-adjust:exact}
html,body{margin:0;padding:0}
body{width:${g.pageW}mm;direction:${dir};font-family:'Vazirmatn','Tahoma','Arial',sans-serif;color:var(--tx);line-height:1.5;font-size:${S(34)}}
.page{position:relative;width:${g.pageW}mm;height:calc(${g.pageH}mm - 0.5mm);padding:var(--bl);display:flex;flex-direction:column;overflow:hidden;background:var(--bg);break-after:avoid;page-break-after:avoid}
.hd{margin:calc(-1 * var(--bl)) calc(-1 * var(--bl)) 0;padding:calc(var(--bl) + ${U(land ? 36 : 48)}) calc(var(--bl) + ${U(64)}) ${U(land ? 30 : 40)};background:var(--dk);color:var(--on);text-align:center;border-bottom:${U(14)} solid var(--ac)}
.hd .cf{font-size:${U(38)};opacity:.9;margin-bottom:${U(14)}}
.hd h1{margin:0 auto;max-width:96%;font-size:${U(land ? 100 : 116)};line-height:1.28;font-weight:800}
.hd .au{margin-top:${U(26)};font-size:${U(land ? 52 : 56)};font-weight:700;line-height:1.4}
.hd .au i{font-style:normal;opacity:.8}
.hd sup{font-size:.55em;vertical-align:super;line-height:0;font-weight:600}
.hd .af{margin-top:${U(12)};font-size:${U(36)};line-height:1.45;opacity:.92}
.hd .af span{display:inline-block;margin:0 ${U(18)}}
.mn{flex:1 1 0;min-height:0;padding:${U(44)} ${U(64)} ${U(30)};overflow:hidden}
.cols{column-count:${g.cols};column-gap:${U(52)};column-fill:balance;column-rule:${U(2)} solid var(--line)}
.sec{margin:0 0 ${S(40)}}
.sec h2{break-after:avoid;margin:0 0 ${S(20)};padding:${S(10)} ${S(22)};background:var(--pr);color:var(--on);font-size:${S(52)};line-height:1.3;font-weight:800;border-radius:${S(8)}}
.bk{break-inside:avoid;margin:0 0 ${S(20)}}
.bk:last-child{margin-bottom:0}
.bk p{margin:0}
.bk ul{margin:0;padding:0 ${S(40)} 0 0;list-style:none}
html[dir=ltr] .bk ul,body[dir=ltr] .bk ul{padding:0 0 0 ${S(40)}}
.bk li{position:relative;margin:0 0 ${S(12)};line-height:1.45}
.bk ul li::before{content:"";position:absolute;top:.62em;width:${S(14)};height:${S(14)};border-radius:50%;background:var(--ac);inset-inline-start:${S(-34)}}
.lb{font-weight:800;color:var(--pr);font-size:${S(32)};margin-bottom:${S(8)}}
.key{background:var(--tint);border-inline-start:${S(12)} solid var(--ac);padding:${S(18)} ${S(24)};border-radius:${S(6)}}
.key p{font-weight:600;color:var(--dk)}
.fm{background:var(--soft);border:${U(2)} solid var(--line);padding:${S(16)} ${S(20)};text-align:center;border-radius:${S(6)}}
.fm p{font-size:${S(38)};overflow:hidden}
.tb .cap{font-size:${S(27)};color:var(--mt);margin-bottom:${S(8)};font-weight:600}
.tb table{width:100%;border-collapse:collapse;font-size:${S(29)};line-height:1.35}
.tb th{background:var(--dk);color:var(--on);font-weight:700;padding:${S(10)} ${S(12)};text-align:start;border:${U(2)} solid var(--dk)}
.tb td{padding:${S(9)} ${S(12)};border:${U(2)} solid var(--line);vertical-align:top}
.tb tbody tr:nth-child(even) td{background:var(--soft)}
.br .r{display:grid;grid-template-columns:34% 1fr auto;align-items:center;gap:${S(14)};margin-bottom:${S(10)};font-size:${S(29)};line-height:1.3}
.br .tr{height:${S(30)};background:var(--soft);border:${U(2)} solid var(--line);border-radius:${S(15)};overflow:hidden}
.br .f{height:100%;background:var(--pr);border-radius:${S(15)}}
.br em{font-style:normal;font-weight:700;color:var(--dk);min-width:${S(70)};text-align:end}
.fl .nd{background:var(--soft);border:${U(3)} solid var(--line);border-radius:${S(10)};padding:${S(12)} ${S(18)};text-align:center;line-height:1.35}
.fl .nd b{display:block;color:var(--pr);font-size:${S(33)}}
.fl .nd span{display:block;font-size:${S(28)}}
.fl .ar{display:block;width:0;height:0;margin:${S(7)} auto;border-left:${S(15)} solid transparent;border-right:${S(15)} solid transparent;border-top:${S(19)} solid var(--ac)}
.st{display:flex;flex-wrap:wrap;gap:${S(14)}}
.st .s{flex:1 1 40%;background:var(--soft);border:${U(2)} solid var(--line);border-radius:${S(10)};padding:${S(14)} ${S(14)};text-align:center}
.st .s b{display:block;font-size:${S(64)};line-height:1.15;color:var(--pr);font-weight:800}
.st .s span{display:block;font-size:${S(26)};line-height:1.3;color:var(--mt)}
.rf ol{margin:0;padding:0 ${S(34)} 0 0;font-size:${S(22)};line-height:1.4;color:var(--tx)}
body[dir=ltr] .rf ol{padding:0 0 0 ${S(34)}}
.rf li{margin:0 0 ${S(8)};text-align:start}
.ft{margin:0 calc(-1 * var(--bl)) calc(-1 * var(--bl));padding:${U(18)} calc(var(--bl) + ${U(64)}) calc(var(--bl) + ${U(18)});background:var(--dk);color:var(--on);font-size:${U(32)};text-align:center}
`;

  // مرحله‌ی fit: بزرگ‌ترین ضریب --f که ستون‌های متوازن‌شده در ارتفاع موجود جا شوند (جست‌وجوی دودویی)؛ اگر جای خالی زیادی ماند، ستون‌ها وسط می‌آیند
  const script = `<script>(function(){
function fit(){try{var root=document.documentElement,mn=document.querySelector(".mn"),cols=document.querySelector(".cols");
var cs=getComputedStyle(mn),pt=parseFloat(cs.paddingTop),pb=parseFloat(cs.paddingBottom),avail=mn.clientHeight-pt-pb,lo=0.4,hi=1.8,best=lo;
for(var i=0;i<18;i++){var m=(lo+hi)/2;root.style.setProperty("--f",m);if(cols.offsetHeight<=avail){best=m;lo=m}else{hi=m}}
root.style.setProperty("--f",(best*0.985).toFixed(4));
var left=avail-cols.offsetHeight;if(left>avail*0.05)mn.style.paddingTop=(pt+left/2)+"px";
document.body.setAttribute("data-fit",best.toFixed(3))}catch(e){}}
function tex(){try{[].slice.call(document.querySelectorAll("[data-tex]")).forEach(function(e){try{window.katex.render(e.getAttribute("data-tex"),e,{throwOnError:true,displayMode:true})}catch(x){}})}catch(x){}}
function go(){tex();fit()}
window.addEventListener("load",function(){(document.fonts&&document.fonts.ready?document.fonts.ready:Promise.resolve()).then(go)})})()</script>`;

  return `<!doctype html><html lang="${cfg.lang}" dir="${dir}"><head><meta charset="utf-8"><title>${esc(p.title)}</title>
<style>${css}</style>${katex}</head><body dir="${dir}"><div class="page">
<header class="hd">${conf}<h1>${tx(p.title)}</h1>${authors}${affs}</header>
<main class="mn"><div class="cols">${sections}</div></main>${footer}
</div>${script}</body></html>`;
}
