/**
 * قالب HTML اینفوگرافیک تک‌صفحه‌ای. رنگ‌ها از همان THEMES ارائه‌ها می‌آیند؛ فونت همیشه Vazirmatn است (از Google Fonts، مثل پیش‌نمایش و PDF).
 * بدون ایموجی: Browser Rendering ممکن است فونت ایموجی نداشته باشد؛ به‌جای آیکن، شماره‌ی بخش و شکل‌های CSS استفاده شده است.
 * فقط به themes.ts و util.ts وابسته است تا جدا از Worker هم قابل آزمایش باشد.
 */
import { THEMES, type Theme } from "./themes";
import { toFa } from "./util";
import type { IgBlock, IgLayout, Infographic } from "./infographic";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export const IG_WIDTH: Record<IgLayout, number> = { wide: 1800, tall: 1200 };

export interface IgRenderOpts {
  theme: string;
  digits: boolean;
  layout: IgLayout;
  /** تصویر تزئینی (data: URI)؛ خالی = بدون تصویر */
  image?: string;
  /** نشانی سایت برای پانویس (فقط نام دامنه نشان داده می‌شود) */
  site?: string;
}

export function renderInfographicHtml(ig: Infographic, o: IgRenderOpts): string {
  const t: Theme = THEMES[o.theme] ?? THEMES.ocean;
  const W = IG_WIDTH[o.layout];
  const cols = o.layout === "wide" ? 3 : 2;
  const base = o.layout === "wide" ? 25 : 24;
  const tx = (s: string) => esc(o.digits ? toFa(String(s)) : String(s));
  const num = (n: number) => (o.digits ? toFa(String(n)) : String(n));
  const dark = t.bg.toUpperCase() < "808080"; // پس‌زمینه‌ی تیره (مثل تم نیمه‌شب)

  const label = (l: string, fallback: string) => `<div class="lb">${tx(l || fallback)}</div>`;
  const maxBar = (items: { value: number }[]) => Math.max(...items.map((i) => i.value), 1);

  const block = (b: IgBlock): string => {
    switch (b.type) {
      case "definition": return `<div class="bk def">${label(b.label, "تعریف")}<p>${tx(b.text)}</p></div>`;
      case "keyfact": return `<div class="bk key">${label(b.label, "نکته‌ی کلیدی")}<p>${tx(b.text)}</p></div>`;
      case "example": return `<div class="bk ex">${label(b.label, "مثال")}<p>${tx(b.text)}</p></div>`;
      case "formula": return `<div class="bk fm">${b.label ? label(b.label, "") : ""}<p dir="ltr">${tx(b.text)}</p></div>`;
      case "bullets": return `<div class="bk">${b.label ? label(b.label, "") : ""}<ul>${b.items.map((i) => `<li>${tx(i)}</li>`).join("")}</ul></div>`;
      case "stats": return `<div class="bk st">${b.items.map((s) => `<div class="s"><b>${tx(s.value)}</b><span>${tx(s.label)}</span></div>`).join("")}</div>`;
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
      case "definition": case "keyfact": case "example": return base * 2.4 + lines(b.text) * lh;
      case "formula": return base * 2.2 + lines(b.text, cpl - 6) * lh;
      case "bullets": return (b.label ? base * 1.4 : 0) + b.items.reduce((a, i) => a + lines(i, cpl - 3) * lh + base * 0.4, 0);
      case "stats": return base * 4.6;
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
    colHtml[k] += `<section class="pn"><header><span class="no">${num(i + 1)}</span><h2>${tx(s.title)}</h2></header><div class="bd">${s.blocks.map(block).join("")}</div></section>`;
    heights[k] += base * 3.6 + s.blocks.reduce((a, b) => a + estimate(b) + base * 0.6, 0) + base * 1.1;
  });
  const panels = colHtml.filter(Boolean).map((h) => `<div class="col">${h}</div>`).join("");

  let host = "";
  try { if (o.site) host = new URL(o.site).hostname.replace(/^www\./, ""); } catch { /* نشانی نامعتبر */ }

  const css = `
:root{--bg:#${t.bg};--sf:#${t.surface};--pr:#${t.primary};--dk:#${t.dark};--ac:#${t.accent};--tx:#${t.text};--mt:#${t.muted};--on:#${t.onPrimary};
--hl:#${dark ? t.accent : t.primary};--line:color-mix(in srgb,var(--pr) 28%,var(--bg));--tint:color-mix(in srgb,var(--ac) ${dark ? 18 : 14}%,var(--bg));--soft:color-mix(in srgb,var(--pr) ${dark ? 16 : 7}%,var(--bg))}
*{box-sizing:border-box}
html,body{margin:0;padding:0}
body{width:${W}px;background:var(--soft);color:var(--tx);font-family:'Vazirmatn','Tahoma',sans-serif;font-size:${base}px;line-height:1.55;direction:rtl}
.top{background:var(--dk);color:var(--on);padding:${base * 1.5}px ${base * 2}px;display:flex;align-items:center;justify-content:space-between;gap:${base * 1.5}px;border-bottom:${base / 4}px solid var(--ac)}
.top .tt{flex:1;min-width:0}
.top h1{margin:0;font-size:${base * 2.1}px;line-height:1.35;font-weight:800}
.top p{margin:${base * 0.4}px 0 0;font-size:${base * 0.95}px;opacity:.82}
.top img{width:${o.layout === "wide" ? 330 : 240}px;height:${o.layout === "wide" ? 190 : 150}px;object-fit:cover;border-radius:${base * 0.7}px;border:3px solid var(--ac);flex:none}
.wrap{padding:${base * 1.2}px ${base * 1.4}px ${base * 0.6}px}
.cols{display:flex;gap:${base * 1.1}px;align-items:flex-start}
.col{flex:1;min-width:0}
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
.st{display:flex;gap:${base * 0.5}px}
.st .s{flex:1;background:var(--sf);border:1.5px solid var(--line);border-radius:${base * 0.45}px;padding:${base * 0.55}px ${base * 0.4}px;text-align:center}
.st b{display:block;font-size:${base * 1.7}px;line-height:1.2;color:var(--hl);font-weight:800}
.st span{display:block;font-size:${base * 0.78}px;color:var(--mt);margin-top:${base * 0.12}px}
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
.take{margin:0 ${base * 1.4}px ${base * 0.9}px;background:var(--dk);color:var(--on);border-radius:${base * 0.7}px;padding:${base * 0.8}px ${base * 1.1}px;display:flex;align-items:center;gap:${base * 0.8}px;border-right:${base * 0.3}px solid var(--ac)}
.take .lb{margin:0;background:var(--ac);color:var(--dk);font-size:${base * 0.8}px;flex:none}
.take p{margin:0;font-size:${base * 1.02}px;font-weight:700}
.ft{padding:0 ${base * 1.4}px ${base * 0.9}px;text-align:left;color:var(--mt);font-size:${base * 0.7}px;direction:ltr}`;

  return `<!doctype html>
<html lang="fa" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=${W}">
<title>${esc(ig.title)}</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Vazirmatn:wght@400;500;700;800&display=swap">
<style>${css}</style></head>
<body>
<div class="top"><div class="tt"><h1>${tx(ig.title)}</h1>${ig.subtitle ? `<p>${tx(ig.subtitle)}</p>` : ""}</div>${o.image ? `<img src="${o.image}" alt="">` : ""}</div>
<div class="wrap"><div class="cols">${panels}</div></div>
${ig.takeaway ? `<div class="take"><span class="lb">جمع‌بندی</span><p>${tx(ig.takeaway)}</p></div>` : ""}
${host ? `<div class="ft">${esc(host)}</div>` : ""}
</body></html>`;
}
