/**
 * پیش‌نمایش ارائه در مرورگر + خروجی PDF.
 * صفحه‌ی HTML سمت سرور ساخته می‌شود و هر اسلاید با همان مختصات (اینچ) و همان قاعده‌ی اندازه‌ی فونت فایل PPTX (pptx.ts) رسم می‌شود.
 * PDF: دکمه‌ی «ذخیره PDF» چاپ مرورگر را باز می‌کند (مقصد: Save as PDF)؛ استایل چاپ هر اسلاید را یک صفحه‌ی ۱۳٫۳۳×۷٫۵ اینچ می‌کند.
 * فونت Vazirmatn از Google Fonts در همین صفحه بارگذاری می‌شود، پس داخل PDF جاسازی می‌شود و به نصب فونت روی دستگاه نیاز ندارد.
 * اندازه‌ها با واحد cqw (درصد عرض اسلاید) هستند: ۱ اینچ = ۷٫۵cqw و ۱pt = ۰٫۱۰۴cqw؛ پس همه‌چیز با عرض صفحه مقیاس می‌گیرد.
 */
import type { Chart, Deck, Slide } from "./types";
import { FONT_URL, FONT_URL_ALT, THEMES, iconOf, type Theme } from "./themes";
import { toFa } from "./util";
import { fitSize } from "./pptx";

const W = 13.333, M = 0.8;

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const I = (inch: number) => `${(inch * 7.5).toFixed(3)}cqw`;
const P = (pt: number) => `${((pt * 7.5) / 72).toFixed(3)}cqw`;

/** ارتفاع صفحه‌ی PDF ربات (اینچ): ۷٫۵ = فقط اسلاید؛ اگر اسلایدی یادداشت دارد ۱۰ (جای کادر یادداشت زیر اسلاید) */
export const pdfPageHeight = (deck: Deck) => (deck.slides.some((s) => s.notes) ? 10 : 7.5);

export interface PreviewOpts {
  id: string; theme: string; font: string; digits: boolean; images: number[]; nonce: string;
  /** حالت PDF سمت سرور (ربات تلگرام): شماره‌ی اسلاید ← تصویر به‌صورت data: URI؛ نوار بالا، راهنما و اسکریپت حذف می‌شوند */
  pdf?: Record<number, string>;
}

interface TOpts { bold?: boolean; align?: "right" | "center" | "left"; valign?: "top" | "middle" | "bottom"; bullet?: boolean | "number"; space?: number; emoji?: boolean }

export function renderPreview(deck: Deck, o: PreviewOpts): string {
  const t: Theme = THEMES[o.theme] ?? THEMES.ocean;
  const tx = (s: string) => esc(o.digits ? toFa(String(s)) : String(s));
  const fontName = /^[\w -]{1,40}$/.test(o.font) ? o.font : "Vazirmatn";
  const hasImg = new Set(o.images);

  // ---------- ابزارهای رسم (مختصات بر حسب اینچ، مثل pptx.ts) ----------
  const box = (x: number, y: number, w: number, h: number, inner = "", style = "") =>
    `<div class="b" style="left:${I(x)};top:${I(y)};width:${I(w)};height:${I(h)};${style}">${inner}</div>`;
  const shape = (x: number, y: number, w: number, h: number, fill: string, kind: "rect" | "ellipse" = "rect", opacity = 100) =>
    box(x, y, w, h, "", `background:#${fill};border-radius:${kind === "ellipse" ? "50%" : I(0.05 * Math.min(w, h))};${opacity < 100 ? `opacity:${opacity / 100};` : ""}`);
  const text = (x: number, y: number, w: number, h: number, paras: string[], size: number, color: string, op: TOpts = {}) => {
    const sp = op.space ?? 8;
    const items = paras.map((p) => (op.bullet ? `<li>${tx(p)}</li>` : `<p>${tx(p)}</p>`)).join("");
    const wrap = op.bullet ? `<${op.bullet === "number" ? "ol" : "ul"}>${items}</${op.bullet === "number" ? "ol" : "ul"}>` : items;
    const jc = op.valign === "middle" ? "center" : op.valign === "bottom" ? "flex-end" : "flex-start";
    return box(x, y, w, h, wrap,
      `display:flex;flex-direction:column;justify-content:${jc};font-size:${P(size)};color:#${color};text-align:${op.align ?? "right"};` +
      `font-weight:${op.bold ? 700 : 400};--sp:${P(sp)};${op.emoji ? "font-family:'Segoe UI Emoji','Apple Color Emoji','Noto Color Emoji',sans-serif;" : ""}`);
  };
  const title = (s: string) => text(M, 0.55, W - 2 * M, 1.0, [s], fitSize([s], W - 2 * M, 1.0, 34, 22, false, 0), t.primary, { bold: true, valign: "middle", space: 0 });

  // ---------- چیدمان‌ها: خروجی {bg, html} ----------
  type R = { bg: string; html: string; num: boolean };

  const titleLike = (sd: Slide, closing: boolean): R => {
    const align = closing ? "center" : "right", tw = W - 2 * M - 1;
    const sub = sd.subtitle ? [sd.subtitle] : sd.bullets.slice(0, 3);
    return { bg: t.primary, num: false, html:
      shape(-2.2, 3.6, 6.5, 6.5, t.accent, "ellipse", 22) + shape(9.6, -2.4, 5.2, 5.2, t.dark, "ellipse", 55) +
      text(M + 0.5, 2.1, tw, 1.9, [sd.title], fitSize([sd.title], tw, 1.9, 50, 30, false, 0), t.onPrimary, { bold: true, align, valign: "bottom", space: 0 }) +
      (sub.length ? text(M + 0.5, 4.3, tw, 1.6, sub, fitSize(sub, tw, 1.6, 24, 16), t.onPrimary, { align }) : "") };
  };
  const section = (sd: Slide, n: number): R => {
    const tw = W - 2 * M - 1;
    return { bg: t.dark, num: false, html:
      shape(-1.5, 4.2, 5.5, 5.5, t.primary, "ellipse", 60) +
      text(M + 0.5, 1.6, tw, 1.6, [String(n)], 80, t.accent, { bold: true }) +
      text(M + 0.5, 3.4, tw, 1.6, [sd.title], fitSize([sd.title], tw, 1.6, 44, 28, false, 0), t.onPrimary, { bold: true, space: 0 }) +
      (sd.subtitle ? text(M + 0.5, 5.1, tw, 1.0, [sd.subtitle], 20, t.muted) : "") };
  };
  const bullets = (sd: Slide): R => {
    const paras = sd.bullets.length ? sd.bullets : [""], iw = W - 2 * M - 1.0, ih = 4.1;
    return { bg: t.bg, num: true, html: title(sd.title) + shape(M, 1.8, W - 2 * M, 4.85, t.surface) +
      text(M + 0.5, 2.15, iw, ih, paras, fitSize(paras, iw, ih, 26, 15, true), t.text, { bullet: true, valign: "middle" }) };
  };
  const imageText = (sd: Slide, i: number): R => {
    const tx0 = W / 2 + 0.1, tw = W / 2 - M - 0.1, paras = sd.bullets.length ? sd.bullets : [""];
    const iw = W / 2 - M - 0.3, ih = 4.85;
    return { bg: t.bg, num: true, html: title(sd.title) +
      shape(M, 1.8, iw, ih, t.surface) + // پشت تصویر (مثل فایل pptx): کل تصویر بدون برش دیده می‌شود
      box(M, 1.8, iw, ih, (o.pdf?.[i] ? `<img src="${o.pdf[i]}" alt="" style="object-fit:contain">` : `<img data-src="/api/files/${encodeURIComponent(o.id)}/img/${i}" alt="" style="object-fit:contain">`), "overflow:hidden;border-radius:" + I(0.1)) +
      text(tx0, 1.8, tw, 4.85, paras, fitSize(paras, tw, 4.85, 24, 15, true), t.text, { bullet: true, valign: "middle" }) };
  };
  const columns = (sd: Slide, n: 2 | 3): R => {
    const gap = n === 3 ? 0.3 : 0.4, cw = (W - 2 * M - gap * (n - 1)) / n, pad = n === 3 ? 0.25 : 0.35;
    return { bg: t.bg, num: true, html: title(sd.title) + sd.columns.slice(0, n).map((col, i) => {
      const x = W - M - (i + 1) * cw - i * gap, b = col.bullets.length ? col.bullets : [""];
      return shape(x, 1.8, cw, 4.85, t.surface) +
        text(x + pad, 2.05, cw - 2 * pad, 0.7, [col.heading], n === 3 ? 22 : 24, t.primary, { bold: true, valign: "middle" }) +
        text(x + pad, 2.95, cw - 2 * pad, 3.4, b, fitSize(b, cw - 2 * pad, 3.4, n === 3 ? 20 : 22, 14, true), t.text, { bullet: true });
    }).join("") };
  };
  const stats = (sd: Slide): R => {
    const st = sd.stats.slice(0, 4), n = Math.max(1, st.length), gap = 0.35, cw = (W - 2 * M - gap * (n - 1)) / n;
    return { bg: t.bg, num: true, html: title(sd.title) + st.map((s, i) => {
      const x = W - M - (i + 1) * cw - i * gap;
      return shape(x, 2.0, cw, 3.0, t.surface) +
        text(x + 0.2, 2.3, cw - 0.4, 1.3, [s.value], s.value.length <= 6 ? 48 : 32, t.primary, { bold: true, align: "center", valign: "middle", space: 0 }) +
        text(x + 0.25, 3.7, cw - 0.5, 1.1, [s.label], fitSize([s.label], cw - 0.5, 1.1, 20, 13, false, 0), t.muted, { align: "center", space: 0 });
    }).join("") + (sd.bullets.length ? text(M, 5.4, W - 2 * M, 1.2, sd.bullets.slice(0, 2), 18, t.text, { bullet: true }) : "") };
  };
  const table = (sd: Slide): R => {
    const tb = sd.table!, n = tb.headers.length;
    const size = Math.max(13, (tb.rows.length <= 4 ? 20 : tb.rows.length <= 6 ? 18 : 16) - (n >= 5 ? 3 : n === 4 ? 1 : 0));
    const rowH = Math.min(0.8, 4.7 / (tb.rows.length + 1));
    const row = (cells: string[], bg: string, color: string, bold: boolean) =>
      `<tr style="background:#${bg};color:#${color};font-weight:${bold ? 700 : 400};height:${I(rowH)}">${cells.map((c) => `<td>${tx(c)}</td>`).join("")}</tr>`;
    const body = row(tb.headers, t.primary, t.onPrimary, true) + tb.rows.map((r, i) => row(r, i % 2 ? t.bg : t.surface, t.text, false)).join("");
    return { bg: t.bg, num: true, html: title(sd.title) +
      box(M, 1.85, W - 2 * M, rowH * (tb.rows.length + 1), `<table style="--bd:#${t.muted}">${body}</table>`, `font-size:${P(size)}`) };
  };
  const chart = (sd: Slide): R => {
    const c = sd.chart!, hasText = sd.bullets.length > 0, cw = hasText ? 7.0 : W - 2 * M;
    return { bg: t.bg, num: true, html: title(sd.title) + box(M, 1.8, cw, 4.55, chartSvg(c, cw, 4.55, t, tx)) +
      (hasText ? text(M + 7.3, 1.8, W - M - (M + 7.3), 4.55, sd.bullets.slice(0, 3), fitSize(sd.bullets.slice(0, 3), W - M - (M + 7.3), 4.55, 22, 14, true), t.text, { bullet: true, valign: "middle" }) : "") +
      text(M, 6.45, W - 2 * M, 0.35, ["داده‌ها تقریبی‌اند؛ پیش از ارائه با منبع معتبر تطبیق دهید."], 11, t.muted, { space: 0 }) };
  };
  const timeline = (sd: Slide): R => {
    const st = sd.steps!.slice(0, 6), n = st.length, tw = W - 2 * M, cw = tw / n, ly = 3.4, w = cw - 0.2;
    return { bg: t.bg, num: true, html: title(sd.title) + shape(M, ly - 0.03, tw, 0.06, t.muted) + st.map((x, i) => {
      const cx = W - M - (i + 0.5) * cw;
      return shape(cx - 0.3, ly - 0.3, 0.6, 0.6, t.primary, "ellipse") +
        text(cx - 0.3, ly - 0.3, 0.6, 0.6, [String(i + 1)], 18, t.onPrimary, { bold: true, align: "center", valign: "middle", space: 0 }) +
        text(cx - w / 2, 2.0, w, 0.85, [x.label], fitSize([x.label], w, 0.85, 22, 14, false, 0), t.primary, { bold: true, align: "center", valign: "bottom", space: 0 }) +
        text(cx - w / 2, 3.95, w, 2.65, [x.text], fitSize([x.text], w, 2.65, 20, 13, false, 0), t.text, { align: "center", space: 0 });
    }).join("") };
  };
  const process = (sd: Slide): R => {
    const st = sd.steps!.slice(0, 5), n = st.length, gap = 0.55, cw = (W - 2 * M - gap * (n - 1)) / n;
    return { bg: t.bg, num: true, html: title(sd.title) + st.map((x, i) => {
      const x0 = W - M - (i + 1) * cw - i * gap;
      return shape(x0, 2.0, cw, 3.9, t.surface) + shape(x0 + cw / 2 - 0.32, 2.25, 0.64, 0.64, t.primary, "ellipse") +
        text(x0 + cw / 2 - 0.32, 2.25, 0.64, 0.64, [String(i + 1)], 20, t.onPrimary, { bold: true, align: "center", valign: "middle", space: 0 }) +
        text(x0 + 0.2, 3.1, cw - 0.4, 0.85, [x.label], fitSize([x.label], cw - 0.4, 0.85, 22, 14, false, 0), t.primary, { bold: true, align: "center", valign: "middle", space: 0 }) +
        text(x0 + 0.2, 4.0, cw - 0.4, 1.7, [x.text], fitSize([x.text], cw - 0.4, 1.7, 18, 13, false, 0), t.text, { align: "center", space: 0 }) +
        (i < n - 1 ? box(x0 - gap + 0.09, 3.7, gap - 0.18, 0.4, "", `background:#${t.accent};clip-path:polygon(100% 25%,45% 25%,45% 0,0 50%,45% 100%,45% 75%,100% 75%)`) : "");
    }).join("") };
  };
  const quote = (sd: Slide): R => {
    const q = sd.quote!, tw = W - 2 * M - 1.2;
    return { bg: t.dark, num: true, html: shape(9.8, -2.2, 5.0, 5.0, t.primary, "ellipse", 45) +
      text(M + 0.6, 0.6, tw, 0.6, [sd.title], 22, t.accent, { bold: true, space: 0 }) +
      (q.author ? text(W - M - 2.6, 1.1, 2.0, 1.3, ["\u201C"], 90, t.accent, { bold: true, space: 0 }) : "") +
      text(M + 0.6, 2.3, tw, 2.9, [q.text], fitSize([q.text], tw, 2.9, 38, 22, false, 0), t.onPrimary, { bold: true, align: "center", valign: "middle", space: 0 }) +
      (q.author ? text(M + 0.6, 5.4, tw, 0.7, ["\u2014 " + q.author], 22, t.onPrimary, { align: "center", space: 0 }) : "") };
  };
  const icons = (sd: Slide): R => {
    const items = sd.items!.slice(0, 4), n = items.length, gap = 0.35, cw = (W - 2 * M - gap * (n - 1)) / n;
    return { bg: t.bg, num: true, html: title(sd.title) + items.map((it, i) => {
      const x0 = W - M - (i + 1) * cw - i * gap;
      return shape(x0, 1.9, cw, 4.3, t.surface) + shape(x0 + cw / 2 - 0.55, 2.2, 1.1, 1.1, t.primary, "ellipse") +
        text(x0 + cw / 2 - 0.55, 2.2, 1.1, 1.1, [iconOf(it.icon)], 34, t.onPrimary, { align: "center", valign: "middle", space: 0, emoji: true }) +
        text(x0 + 0.2, 3.55, cw - 0.4, 0.85, [it.heading], fitSize([it.heading], cw - 0.4, 0.85, 22, 14, false, 0), t.primary, { bold: true, align: "center", valign: "middle", space: 0 }) +
        text(x0 + 0.25, 4.45, cw - 0.5, 1.55, [it.text], fitSize([it.text], cw - 0.5, 1.55, 18, 13, false, 0), t.text, { align: "center", space: 0 });
    }).join("") };
  };
  const numbered = (sd: Slide, foot?: string): R => {
    const colBullets = sd.columns.flatMap((c) => c.bullets), paras = sd.bullets.length ? sd.bullets : colBullets.length ? colBullets : [""], iw = W - 2 * M - 1.0, ih = foot ? 3.8 : 4.1;
    return { bg: t.bg, num: true, html: title(sd.title) + shape(M, 1.8, W - 2 * M, foot ? 4.5 : 4.85, t.surface) +
      text(M + 0.5, 2.1, iw, ih, paras, fitSize(paras, iw, ih, foot ? 22 : 26, 14, true, 12), t.text, { bullet: "number", valign: "middle", space: 12 }) +
      (foot ? text(M, 6.45, W - 2 * M, 0.35, [foot], 11, t.muted, { space: 0 }) : "") };
  };

  // ---------- انتخاب چیدمان (همان شرط‌های pptx.ts: داده‌ی ناقص ⇒ اسلاید فهرستی) ----------
  let sec = 0;
  const slides = deck.slides.map((sd, i) => {
    const lay = sd.layout;
    const r: R =
      lay === "title" || lay === "closing" ? titleLike(sd, lay === "closing")
      : lay === "section" ? section(sd, ++sec)
      : lay === "image_text" && hasImg.has(i) ? imageText(sd, i)
      : lay === "three_column" && sd.columns.length >= 3 ? columns(sd, 3)
      : lay === "two_column" && sd.columns.length ? columns(sd, 2)
      : lay === "stats" && sd.stats.length ? stats(sd)
      : lay === "table" && sd.table ? table(sd)
      : lay === "chart" && sd.chart ? chart(sd)
      : lay === "timeline" && sd.steps?.length ? timeline(sd)
      : lay === "process" && sd.steps?.length ? process(sd)
      : lay === "quote" && sd.quote ? quote(sd)
      : lay === "icons" && sd.items?.length ? icons(sd)
      : lay === "sources" ? numbered(sd, "منابع پیشنهادی برای مطالعه‌ی بیشتر؛ پیش از ارجاع، وجود و صحت آن‌ها را بررسی کنید.")
      : lay === "questions" ? numbered(sd)
      : bullets(sd);
    const num = r.num ? text(0.6, 6.95, 1.0, 0.3, [String(i + 1)], 11, t.muted, { align: "left", space: 0 }) : "";
    // یادداشت سخنرانی مثل پیش‌نمایش وب زیر اسلاید می‌آید؛ در PDF ربات هم همان کادر در همان صفحه (فونت بر اساس طول متن کم می‌شود تا جا شود)
    const nlen = sd.notes ? sd.notes.length : 0;
    const npt = nlen <= 380 ? 16 : nlen <= 520 ? 14 : nlen <= 750 ? 12.5 : 11;
    const notes = sd.notes ? `<div class="notes"${o.pdf ? ` style="font-size:${npt}pt"` : ""}><b>یادداشت سخنرانی:</b> ${tx(sd.notes)}</div>` : "";
    return `<div class="item"><div class="sl"><section class="slide" style="background:#${r.bg}">${r.html}${num}</section></div>${notes}</div>`;
  }).join("\n");

  const pageH = pdfPageHeight(deck);
  const cssVars = `--font:"${fontName}","Vazirmatn",Tahoma,Arial,sans-serif`;
  const vazir = fontName === "Vazirmatn";
  const note = vazir
    ? `این پیش‌نمایش و PDF با فونت Vazirmatn ساخته می‌شود. برای نمایش درست فایل PPTX روی دستگاهت، فونت را نصب کن؛ دانلود: <a href="${FONT_URL}" target="_blank" rel="noopener">GitHub</a> · <a href="${FONT_URL_ALT}" target="_blank" rel="noopener">Google Fonts</a>`
    : `فونت انتخابی (${esc(fontName)}) روی بیشتر دستگاه‌ها نصب است؛ اگر در پیش‌نمایش متفاوت دیدی، فایل PPTX هم همین‌طور باز می‌شود.`;
  const id = encodeURIComponent(o.id);

  return `<!doctype html>
<html lang="fa" dir="rtl"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>پیش‌نمایش — ${esc(deck.title)}</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Vazirmatn:wght@400;700&display=swap">
<style>
*{box-sizing:border-box}
:root{${cssVars}}
body{margin:0;background:#eef1f6;font-family:var(--font);color:#1b2733}
.bar{position:sticky;top:0;z-index:5;display:flex;flex-wrap:wrap;gap:10px;align-items:center;justify-content:space-between;padding:10px 16px;background:#fff;border-bottom:1px solid #dbe1ea}
.bar h1{margin:0;font-size:1rem;flex:1 1 220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.act{display:flex;gap:8px;flex-wrap:wrap}
.btn{font:inherit;font-weight:700;font-size:.9rem;border:0;border-radius:10px;padding:8px 14px;cursor:pointer;text-decoration:none;background:#2563eb;color:#fff}
.btn.ghost{background:#fff;color:#1b2733;border:1px solid #cbd3df}
.hint{max-width:1000px;margin:12px auto 0;padding:0 16px;font-size:.85rem;color:#556070;line-height:1.9}
.hint a{color:#2563eb}
main{max-width:1000px;margin:0 auto;padding:12px 16px 40px}
.item{margin:0 0 22px}
.sl{container-type:inline-size;width:100%;border-radius:10px;overflow:hidden;box-shadow:0 6px 24px rgba(20,40,80,.18);background:#fff}
.slide{position:relative;width:100%;aspect-ratio:16/9;overflow:hidden;direction:rtl;font-family:var(--font);line-height:1.4}
.b{position:absolute}
.b p{margin:0 0 var(--sp,0)}.b p:last-child{margin-bottom:0}
.b ul,.b ol{margin:0;padding:0 1.6em 0 0}
.b li{margin:0 0 var(--sp,0)}.b li:last-child{margin-bottom:0}
.b img{width:100%;height:100%;object-fit:cover;display:block}
.b table{width:100%;border-collapse:collapse}
.b td{padding:0 .7em;border-bottom:.75pt solid var(--bd);text-align:right;vertical-align:middle}
.b svg{width:100%;height:100%;display:block}
.notes{margin-top:8px;padding:8px 12px;background:#fff;border:1px solid #dbe1ea;border-radius:8px;font-size:.85rem;line-height:1.9;color:#334}
@media print{
  @page{size:13.333in 7.5in;margin:0}
  body{background:#fff}
  .bar,.hint,.notes{display:none!important}
  main{max-width:none;padding:0}
  .item{margin:0;break-after:page;page-break-after:always}
  .sl{width:13.333in;height:7.5in;border-radius:0;box-shadow:none}
  *{-webkit-print-color-adjust:exact;print-color-adjust:exact}
}
</style>
${o.pdf ? `<style>
/* PDF ربات: هر صفحه = اسلاید + (در صورت وجود یادداشت) کادر یادداشت زیرش، مثل پیش‌نمایش وب */
@page{size:13.333in ${pageH}in;margin:0}
html,body{background:#eef1f6}
@media print{
  .item{height:${pageH}in;overflow:hidden;background:#eef1f6}
  .notes{display:block!important;margin:.2in .5in 0;height:${(pageH - 7.5 - 0.4).toFixed(2)}in;overflow:hidden;line-height:1.9;border:1px solid #dbe1ea;border-radius:8px;background:#fff;padding:.08in .2in}
}
</style>` : ""}
</head>
<body>
${o.pdf ? "" : `<header class="bar"><h1>👁 ${esc(deck.title)}</h1>
<div class="act"><a class="btn" href="/api/files/${id}" rel="nofollow">⬇️ دانلود PPTX</a><button class="btn" id="pdf" type="button">📄 ذخیره PDF</button><a class="btn ghost" href="/">بازگشت به سایت</a></div></header>
<p class="hint">برای PDF روی «ذخیره PDF» بزن و در پنجره‌ی چاپ، مقصد را <b>Save as PDF</b> بگذار (حاشیه: هیچ). ${note}</p>`}
<main>
${slides}
</main>
${o.pdf ? "" : `<script nonce="${o.nonce}">
document.getElementById("pdf").onclick=function(){window.print()};
// تصویرها از فایل PPTX می‌آیند؛ اگر فایل هنوز برای همه‌ی نقاط شبکه دیده نمی‌شد چند بار دوباره امتحان می‌شود
document.querySelectorAll("img[data-src]").forEach(function(im){var n=0;function go(){im.src=im.getAttribute("data-src")+(n?"?r="+n:"")}im.onerror=function(){if(n++<8)setTimeout(go,3000)};go()});
</script>`}
</body></html>`;
}

// ---------- نمودار (SVG؛ واحد viewBox = ۱۰۰ در هر اینچ) ----------
function chartSvg(c: Chart, wIn: number, hIn: number, t: Theme, tx: (s: string) => string): string {
  const vw = wIn * 100, vh = hIn * 100, fs = (pt: number) => ((pt * 100) / 72).toFixed(1);
  const pal = [t.primary, t.accent, "E0A93B", "2F7D5B", "D9482B", "5B3FA6", t.muted, "14B8A6"];
  const fmt = (v: number) => tx(Number.isInteger(v) ? String(v) : String(Math.round(v * 10) / 10));
  const txt = (x: number, y: number, s: string, size: number, color: string, anchor = "middle", bold = false) =>
    `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" font-size="${fs(size)}" fill="#${color}" text-anchor="${anchor}"${bold ? ' font-weight="700"' : ""}>${tx(s)}</text>`;
  const multi = c.series.length > 1 || c.type === "pie";
  const names = c.type === "pie" ? c.labels : c.series.map((s, i) => s.name || `سری ${i + 1}`);
  const legend = multi ? (() => {
    const wOf = (s: string) => 60 + s.length * 17;
    const total = names.reduce((a, n) => a + wOf(n), 0);
    let x = (vw - total) / 2;
    return names.map((n, i) => { const r = `<rect x="${x.toFixed(1)}" y="${vh - 38}" width="22" height="22" rx="4" fill="#${pal[i % pal.length]}"/>${txt(x + 32, vh - 19, n, 14, t.text, "start")}`; x += wOf(n); return r; }).join("");
  })() : "";
  const bottom = multi ? 90 : 55;

  if (c.type === "pie") {
    const vals = c.series[0].values, sum = vals.reduce((a, b) => a + Math.max(0, b), 0) || 1;
    const cx = vw / 2, cy = (vh - bottom) / 2 + 10, r = Math.min(vw, vh - bottom) / 2 - 10;
    let a0 = -Math.PI / 2;
    const slices = vals.map((v, i) => {
      const frac = Math.max(0, v) / sum, a1 = a0 + frac * Math.PI * 2, big = a1 - a0 > Math.PI ? 1 : 0;
      const p = (a: number, rr = r) => `${(cx + rr * Math.cos(a)).toFixed(1)} ${(cy + rr * Math.sin(a)).toFixed(1)}`;
      const mid = (a0 + a1) / 2, lx = cx + r * 0.62 * Math.cos(mid), ly = cy + r * 0.62 * Math.sin(mid);
      const d = frac >= 0.9999 ? `M ${p(a0)} A ${r} ${r} 0 1 1 ${p(a0 + Math.PI)} A ${r} ${r} 0 1 1 ${p(a0)} Z` : `M ${cx} ${cy} L ${p(a0)} A ${r} ${r} 0 ${big} 1 ${p(a1)} Z`;
      a0 = a1;
      return `<path d="${d}" fill="#${pal[i % pal.length]}" stroke="#${t.bg}" stroke-width="3"/>` + (frac >= 0.04 ? txt(lx, ly + 6, `${Math.round(frac * 100)}%`, 13, "FFFFFF", "middle", true) : "");
    }).join("");
    return `<svg direction="ltr" viewBox="0 0 ${vw} ${vh}" role="img">${slices}${legend}</svg>`;
  }

  const L = 80, R = 20, T = 30, pw = vw - L - R, ph = vh - T - bottom;
  const all = c.series.flatMap((s) => s.values), lo = Math.min(0, ...all), hi = Math.max(...all, 1);
  const raw = (hi - lo) / 4 || 1, mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? mag * 10;
  const a = Math.floor(lo / step) * step, b = Math.ceil(hi / step) * step;
  const y = (v: number) => T + ph * (1 - (v - a) / (b - a || 1));
  let grid = "";
  for (let v = a; v <= b + step / 2; v += step) grid += `<line x1="${L}" x2="${vw - R}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}" stroke="#${t.muted}" stroke-width="1" stroke-dasharray="6 6" opacity=".6"/>${txt(L - 10, y(v) + 5, fmt(v), 13, t.muted, "end")}`;
  const n = c.labels.length, gw = pw / n;
  const cats = c.labels.map((l, i) => txt(L + gw * (i + 0.5), vh - bottom + 30, l, 14, t.text)).join("");
  let marks = "";
  if (c.type === "bar") {
    const ns = c.series.length, bw = (gw * 0.62) / ns;
    c.series.forEach((s, si) => s.values.forEach((v, i) => {
      const x = L + gw * i + gw * 0.19 + bw * si, y0 = y(Math.max(v, 0)), h = Math.abs(y(v) - y(0));
      marks += `<rect x="${x.toFixed(1)}" y="${y0.toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(1, h).toFixed(1)}" fill="#${pal[si % pal.length]}"/>${txt(x + bw / 2, y0 - 8, fmt(v), 13, t.text)}`;
    }));
  } else {
    c.series.forEach((s, si) => {
      const pts = s.values.map((v, i) => `${(L + gw * (i + 0.5)).toFixed(1)},${y(v).toFixed(1)}`);
      marks += `<polyline points="${pts.join(" ")}" fill="none" stroke="#${pal[si % pal.length]}" stroke-width="5" stroke-linejoin="round"/>` +
        s.values.map((v, i) => `<circle cx="${(L + gw * (i + 0.5)).toFixed(1)}" cy="${y(v).toFixed(1)}" r="8" fill="#${pal[si % pal.length]}"/>${txt(L + gw * (i + 0.5), y(v) - 14, fmt(v), 13, t.text)}`).join("");
    });
  }
  return `<svg direction="ltr" viewBox="0 0 ${vw} ${vh}" role="img">${grid}${marks}${cats}${legend}</svg>`;
}
