/** ساخت فایل PPTX فارسی (راست‌به‌چپ) با PptxGenJS؛ بازنویسی pptx_builder.py. */
import PptxGenJS from "pptxgenjs";
import type { Deck, Slide } from "./types";
import { THEMES, type Theme } from "./themes";
import { toFa } from "./util";

const W = 13.333, H = 7.5, M = 0.8; // اسلاید 16:9 و حاشیه (اینچ)

/** اندازه‌ی کادر تصویر در اسلایدهای «تصویر و متن» (اینچ) */
export const IMAGE_BOX = { w: W / 2 - M - 0.3, h: 4.85 };


/** تخمین اندازه‌ی فونت مناسب تا متن در کادر جا شود. */
export function fitSize(paras: string[], w: number, h: number, mx: number, mn: number, bullet = false, space = 8): number {
  for (let size = mx; size >= mn; size--) {
    const cpl = Math.max(1, Math.floor(((w - (bullet ? 0.35 : 0)) * 72) / (size * 0.52)));
    const lines = paras.reduce((a, s) => a + Math.max(1, Math.ceil(s.length / cpl)), 0);
    const need = (lines * size * 1.4 + space * Math.max(0, paras.length - 1)) / 72;
    if (need <= h) return size;
  }
  return mn;
}

function toBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

interface TextOpts {
  bold?: boolean;
  align?: "right" | "center" | "left";
  valign?: "top" | "middle" | "bottom";
  bullet?: boolean | "number";
  space?: number;
}

export interface BuildOptions {
  theme?: string;
  font?: string;
  persianDigits?: boolean;
  images?: Map<number, Uint8Array>;
}

export async function buildPptx(deck: Deck, opts: BuildOptions = {}): Promise<Uint8Array> {
  const b = new Builder(opts);
  return b.build(deck);
}

class Builder {
  private p = new PptxGenJS();
  private t: Theme;
  private font: string;
  private digits: boolean;
  private images: Map<number, Uint8Array>;

  constructor(o: BuildOptions) {
    this.t = THEMES[o.theme ?? "ocean"] ?? THEMES.ocean;
    this.font = o.font ?? "Vazirmatn";
    this.digits = o.persianDigits ?? true;
    this.images = o.images ?? new Map();
    this.p.defineLayout({ name: "WIDE", width: W, height: H });
    this.p.layout = "WIDE";
    this.p.theme = { headFontFace: this.font, bodyFontFace: this.font };
  }

  // ---------- ابزارهای پایه ----------
  private txt(s: string) { return this.digits ? toFa(String(s)) : String(s); }

  private slide(bg: string) {
    const s = this.p.addSlide();
    s.background = { color: bg };
    return s;
  }

  private shape(s: PptxGenJS.Slide, x: number, y: number, w: number, h: number, fill: string,
    kind: "roundRect" | "ellipse" = "roundRect", opaque?: number) {
    s.addShape(kind === "ellipse" ? this.p.ShapeType.ellipse : this.p.ShapeType.roundRect, {
      x, y, w, h,
      fill: { color: fill, transparency: opaque === undefined ? 0 : 100 - opaque },
      line: { type: "none" } as any,
      ...(kind === "roundRect" ? { rectRadius: 0.05 * Math.min(w, h) } : {}),
    });
  }

  private text(s: PptxGenJS.Slide, x: number, y: number, w: number, h: number, paras: string[],
    size: number, color: string, o: TextOpts = {}) {
    const runs = paras.map((para) => ({
      text: this.txt(para),
      options: {
        breakLine: true,
        rtlMode: true, // جهت پاراگراف راست‌به‌چپ
        lang: "fa-IR",
        align: o.align ?? "right",
        fontFace: this.font,
        fontSize: size,
        bold: !!o.bold,
        color,
        lineSpacingMultiple: 1.15,
        paraSpaceAfter: o.space ?? 8,
        ...(o.bullet === "number" ? { bullet: { type: "number", indent: 28 } }
          : o.bullet ? { bullet: { characterCode: "2022", indent: 25 } } : {}),
      },
    }));
    s.addText(runs as any, { x, y, w, h, margin: 0, valign: o.valign ?? "top", fit: "none", wrap: true });
  }

  private title(s: PptxGenJS.Slide, text: string) {
    const size = fitSize([text], W - 2 * M, 1.0, 34, 22, false, 0);
    this.text(s, M, 0.55, W - 2 * M, 1.0, [text], size, this.t.primary, { bold: true, valign: "middle", space: 0 });
  }

  private number(s: PptxGenJS.Slide, n: number) {
    this.text(s, 0.6, 6.95, 1.0, 0.3, [String(n)], 11, this.t.muted, { align: "left", space: 0 });
  }

  // ---------- چیدمان‌ها ----------
  private titleLike(sd: Slide, closing: boolean) {
    const s = this.slide(this.t.primary);
    this.shape(s, -2.2, 3.6, 6.5, 6.5, this.t.accent, "ellipse", 22);
    this.shape(s, 9.6, -2.4, 5.2, 5.2, this.t.dark, "ellipse", 55);
    const align = closing ? "center" : "right";
    const tw = W - 2 * M - 1;
    this.text(s, M + 0.5, 2.1, tw, 1.9, [sd.title], fitSize([sd.title], tw, 1.9, 50, 30, false, 0),
      this.t.onPrimary, { bold: true, align, valign: "bottom", space: 0 });
    const sub = sd.subtitle ? [sd.subtitle] : sd.bullets.slice(0, 3);
    if (sub.length) {
      this.text(s, M + 0.5, 4.3, tw, 1.6, sub, fitSize(sub, tw, 1.6, 24, 16), this.t.onPrimary, { align });
    }
    return s;
  }

  private section(sd: Slide, n: number) {
    const s = this.slide(this.t.dark);
    this.shape(s, -1.5, 4.2, 5.5, 5.5, this.t.primary, "ellipse", 60);
    const tw = W - 2 * M - 1;
    this.text(s, M + 0.5, 1.6, tw, 1.6, [String(n)], 80, this.t.accent, { bold: true });
    this.text(s, M + 0.5, 3.4, tw, 1.6, [sd.title], fitSize([sd.title], tw, 1.6, 44, 28, false, 0),
      this.t.onPrimary, { bold: true, space: 0 });
    if (sd.subtitle) this.text(s, M + 0.5, 5.1, tw, 1.0, [sd.subtitle], 20, this.t.muted);
    return s;
  }

  private bullets(sd: Slide) {
    const s = this.slide(this.t.bg);
    this.title(s, sd.title);
    this.shape(s, M, 1.8, W - 2 * M, 4.85, this.t.surface);
    const paras = sd.bullets.length ? sd.bullets : [""];
    const iw = W - 2 * M - 1.0, ih = 4.1;
    this.text(s, M + 0.5, 2.15, iw, ih, paras, fitSize(paras, iw, ih, 26, 15, true), this.t.text,
      { bullet: true, valign: "middle" });
    return s;
  }

  private imageText(sd: Slide, img: Uint8Array) {
    const s = this.slide(this.t.bg);
    this.title(s, sd.title);
    s.addImage({ data: `image/jpeg;base64,${toBase64(img)}`, x: M, y: 1.8, w: IMAGE_BOX.w, h: IMAGE_BOX.h });
    const tx = W / 2 + 0.1, tw = W / 2 - M - 0.1;
    const paras = sd.bullets.length ? sd.bullets : [""];
    this.text(s, tx, 1.8, tw, 4.85, paras, fitSize(paras, tw, 4.85, 24, 15, true), this.t.text,
      { bullet: true, valign: "middle" });
    return s;
  }

  private twoColumn(sd: Slide) {
    const s = this.slide(this.t.bg);
    this.title(s, sd.title);
    const gap = 0.4, cw = (W - 2 * M - gap) / 2;
    sd.columns.slice(0, 2).forEach((col, i) => {
      const x = W - M - (i + 1) * cw - i * gap; // ستون اول سمت راست
      this.shape(s, x, 1.8, cw, 4.85, this.t.surface);
      this.text(s, x + 0.35, 2.05, cw - 0.7, 0.7, [col.heading], 24, this.t.primary, { bold: true, valign: "middle" });
      const b = col.bullets.length ? col.bullets : [""];
      this.text(s, x + 0.35, 2.95, cw - 0.7, 3.4, b, fitSize(b, cw - 0.7, 3.4, 22, 14, true), this.t.text, { bullet: true });
    });
    return s;
  }

  private stats(sd: Slide) {
    const s = this.slide(this.t.bg);
    this.title(s, sd.title);
    const stats = sd.stats.slice(0, 4);
    const n = Math.max(1, stats.length), gap = 0.35, cw = (W - 2 * M - gap * (n - 1)) / n;
    stats.forEach((st, i) => {
      const x = W - M - (i + 1) * cw - i * gap;
      this.shape(s, x, 2.0, cw, 3.0, this.t.surface);
      this.text(s, x + 0.2, 2.3, cw - 0.4, 1.3, [st.value], st.value.length <= 6 ? 48 : 32, this.t.primary,
        { bold: true, align: "center", valign: "middle", space: 0 });
      this.text(s, x + 0.25, 3.7, cw - 0.5, 1.1, [st.label], fitSize([st.label], cw - 0.5, 1.1, 20, 13, false, 0),
        this.t.muted, { align: "center", space: 0 });
    });
    if (sd.bullets.length) this.text(s, M, 5.4, W - 2 * M, 1.2, sd.bullets.slice(0, 2), 18, this.t.text, { bullet: true });
    return s;
  }

  private table(sd: Slide) {
    const s = this.slide(this.t.bg);
    this.title(s, sd.title);
    const t = sd.table!;
    const n = t.headers.length, tw = W - 2 * M;
    const size = Math.max(13, (t.rows.length <= 4 ? 20 : t.rows.length <= 6 ? 18 : 16) - (n >= 5 ? 3 : n === 4 ? 1 : 0));
    const rowH = Math.min(0.8, 4.7 / (t.rows.length + 1));
    const rev = <T,>(a: T[]) => [...a].reverse(); // ستون اول سمت راست
    const cell = (text: string, color: string, fill: string, bold = false) => ({
      text: this.txt(text),
      options: { fontFace: this.font, fontSize: size, color, bold, align: "right" as const, valign: "middle" as const,
        rtlMode: true, lang: "fa-IR", fill: { color: fill },
        border: [{ type: "none" }, { type: "none" }, { type: "solid", pt: 0.75, color: this.t.muted }, { type: "none" }] as any },
    });
    const rows = [
      rev(t.headers).map((h) => cell(h, this.t.onPrimary, this.t.primary, true)),
      ...t.rows.map((r, i) => rev(r).map((c) => cell(c, this.t.text, i % 2 ? this.t.bg : this.t.surface))),
    ];
    s.addTable(rows as any, { x: M, y: 1.85, w: tw, colW: Array(n).fill(tw / n), rowH });
    return s;
  }

  private chart(sd: Slide) {
    const s = this.slide(this.t.bg);
    this.title(s, sd.title);
    const c = sd.chart!;
    const hasText = sd.bullets.length > 0;
    const labels = c.labels.map((l) => this.txt(l));
    const data = c.series.map((se, i) => ({ name: this.txt(se.name || `سری ${i + 1}`), labels, values: se.values }));
    const palette = [this.t.primary, this.t.accent, "E0A93B", "2F7D5B", "D9482B", "5B3FA6", this.t.muted, "14B8A6"];
    const type = c.type === "line" ? this.p.ChartType.line : c.type === "pie" ? this.p.ChartType.pie : this.p.ChartType.bar;
    const font = { fontFace: this.font, color: this.t.text } as const;
    s.addChart(type, data as any, {
      x: M, y: 1.8, w: hasText ? 7.0 : W - 2 * M, h: 4.55,
      chartColors: c.type === "pie" ? palette.slice(0, labels.length) : palette.slice(0, data.length),
      showLegend: c.type === "pie" || data.length > 1, legendPos: "b", legendFontFace: this.font, legendFontSize: 14, legendColor: this.t.text,
      catAxisLabelFontFace: this.font, catAxisLabelFontSize: 14, catAxisLabelColor: this.t.text,
      valAxisLabelFontFace: this.font, valAxisLabelFontSize: 13, valAxisLabelColor: this.t.muted,
      valGridLine: { color: this.t.muted, size: 0.5, style: "dash" } as any, catGridLine: { style: "none" } as any,
      showValue: c.type !== "pie", showPercent: c.type === "pie", dataLabelFontFace: this.font, dataLabelFontSize: 13, dataLabelColor: c.type === "pie" ? "FFFFFF" : font.color,
      ...(c.type === "line" ? { lineSize: 3, lineDataSymbolSize: 9 } : {}),
      ...(c.type === "bar" ? { barGapWidthPct: 60 } : {}),
    } as any);
    if (hasText) {
      const tx = M + 7.3, tw = W - M - tx;
      this.text(s, tx, 1.8, tw, 4.55, sd.bullets.slice(0, 3), fitSize(sd.bullets.slice(0, 3), tw, 4.55, 22, 14, true), this.t.text,
        { bullet: true, valign: "middle" });
    }
    this.text(s, M, 6.45, W - 2 * M, 0.35, ["داده‌ها تقریبی‌اند؛ پیش از ارائه با منبع معتبر تطبیق دهید."], 11, this.t.muted, { space: 0 });
    return s;
  }

  /** فهرست شماره‌دار: برای «منابع» و «پرسش‌های پایانی» */
  private numbered(sd: Slide, foot?: string) {
    const s = this.slide(this.t.bg);
    this.title(s, sd.title);
    this.shape(s, M, 1.8, W - 2 * M, foot ? 4.5 : 4.85, this.t.surface);
    const paras = sd.bullets.length ? sd.bullets : [""];
    const iw = W - 2 * M - 1.0, ih = foot ? 3.8 : 4.1;
    this.text(s, M + 0.5, 2.1, iw, ih, paras, fitSize(paras, iw, ih, foot ? 22 : 26, 14, true, 12), this.t.text,
      { bullet: "number", valign: "middle", space: 12 });
    if (foot) this.text(s, M, 6.45, W - 2 * M, 0.35, [foot], 11, this.t.muted, { space: 0 });
    return s;
  }

  // ---------- ساخت نهایی ----------
  async build(deck: Deck): Promise<Uint8Array> {
    let sec = 0;
    deck.slides.forEach((sd, i) => {
      const lay = sd.layout;
      let s: PptxGenJS.Slide;
      const img = this.images.get(i);
      if (lay === "title" || lay === "closing") s = this.titleLike(sd, lay === "closing");
      else if (lay === "section") s = this.section(sd, ++sec);
      else if (lay === "image_text" && img) s = this.imageText(sd, img);
      else if (lay === "two_column" && sd.columns.length) s = this.twoColumn(sd);
      else if (lay === "stats" && sd.stats.length) s = this.stats(sd);
      else if (lay === "table" && sd.table) s = this.table(sd);
      else if (lay === "chart" && sd.chart) s = this.chart(sd);
      else if (lay === "sources") s = this.numbered(sd, "منابع پیشنهادی برای مطالعه‌ی بیشتر؛ پیش از ارجاع، وجود و صحت آن‌ها را بررسی کنید.");
      else if (lay === "questions") s = this.numbered(sd);
      else s = this.bullets(sd);
      if (lay !== "title" && lay !== "closing" && lay !== "section") this.number(s, i + 1);
      if (sd.notes) s.addNotes(this.txt(sd.notes));
    });
    this.p.title = deck.title;
    // compression:false = ذخیره بدون فشرده‌سازی؛ مصرف CPU را (برای سقف ۱۰ms پلن رایگان) پایین نگه می‌دارد
    const out = await this.p.write({ outputType: "uint8array", compression: false });
    return out as Uint8Array;
  }
}
