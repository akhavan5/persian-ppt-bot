/** ساخت فایل PPTX فارسی (راست‌به‌چپ) با PptxGenJS؛ بازنویسی pptx_builder.py. */
import PptxGenJS from "pptxgenjs";
import type { Deck, Slide } from "./types";
import { THEMES, iconOf, isBFont, type Theme } from "./themes";
import { toFa } from "./util";
import { BISMILLAH_IMG } from "./bismillah-img";
import { BISMILLAH, RAIL, academicPalette, badgeColor, isTemplate, pillRow, railDots } from "./template";

const W = 13.333, H = 7.5, M = 0.8; // اسلاید 16:9 و حاشیه (اینچ)

/** اندازه‌ی کادر تصویر در اسلایدهای «تصویر و متن» (اینچ) */
export const IMAGE_BOX = { w: W / 2 - M - 0.3, h: 4.85 };

/** ابعاد پیکسلی تصویر JPEG/PNG از روی سرفایل (بدون کتابخانه)؛ ناموفق ⇒ null */
export function imageSize(b: Uint8Array): { w: number; h: number } | null {
  if (b[0] === 0x89 && b[1] === 0x50) return b.length > 24 ? { w: ((b[16] << 24) | (b[17] << 16) | (b[18] << 8) | b[19]) >>> 0, h: ((b[20] << 24) | (b[21] << 16) | (b[22] << 8) | b[23]) >>> 0 } : null;
  if (b[0] !== 0xff || b[1] !== 0xd8) return null;
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) { i++; continue; }
    const m = b[i + 1];
    if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7) || m === 0xff) { i += m === 0xff ? 1 : 2; continue; }
    const len = (b[i + 2] << 8) | b[i + 3];
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { h: (b[i + 5] << 8) | b[i + 6], w: (b[i + 7] << 8) | b[i + 8] };
    i += 2 + len;
  }
  return null;
}


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

/** نویسه‌هایی که در فونت‌های B Nazanin / B Titr نیستند (حروف لاتین و چند علامت مثل ; & # @ _ ' " ? < > $ ~ ^ | → ←) و در PowerPoint «مربع» دیده می‌شوند؛ این تکه‌ها با فونت جایگزین نوشته می‌شوند */
const B_MISSING = /([0-9]*[A-Za-z](?:[A-Za-z0-9 .,:\-+\/()%&#@_'’"]*[A-Za-z0-9)%"'])?|[;&#@_'"?<>$~^|\\…–—→←`]+)/;
const B_FALLBACK = "Times New Roman";

interface TextOpts {
  bold?: boolean;
  align?: "right" | "center" | "left";
  valign?: "top" | "middle" | "bottom";
  bullet?: boolean | "number";
  space?: number;
  /** فونت جدا (مثلاً ایموجی)؛ پیش‌فرض فونت ارائه */
  font?: string;
}

export interface BuildOptions {
  theme?: string;
  /** قالب اسلاید (classic | academic)؛ ناشناخته/خالی = classic */
  template?: string;
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
  private ac: boolean;
  private A: ReturnType<typeof academicPalette>;
  private font: string;
  /** ضریب اندازه‌ی فونت: B Nazanin در همان نقطه کوچک‌تر از Vazirmatn دیده می‌شود */
  private fs: number;
  private digits: boolean;
  private images: Map<number, Uint8Array>;

  constructor(o: BuildOptions) {
    this.t = THEMES[o.theme ?? "violet"] ?? THEMES.violet;
    this.ac = isTemplate(o.template) && o.template === "academic";
    this.A = academicPalette(this.t);
    this.font = o.font ?? "Vazirmatn";
    this.fs = this.font === "B Nazanin" ? 1.1 : 1;
    this.digits = o.persianDigits ?? true;
    this.images = o.images ?? new Map();
    this.p.defineLayout({ name: "WIDE", width: W, height: H });
    this.p.layout = "WIDE";
    this.p.theme = { headFontFace: this.font, bodyFontFace: this.font };
  }

  // ---------- ابزارهای پایه ----------
  private txt(s: string) { return this.digits ? toFa(String(s)) : String(s); }
  /** متن سلول جدول؛ در فونت B تکه‌های لاتین/علامت‌های ناموجود با Times New Roman (وگرنه مربع می‌شوند) */
  private cellRuns(text: string, size: number, color: string, bold: boolean): any {
    const t = this.txt(text);
    if (!isBFont(this.font) || !B_MISSING.test(t)) return t;
    return t.split(B_MISSING).filter((x) => x !== "").map((x) => {
      const fb = x.replace(B_MISSING, "") === "";
      return { text: x, options: { fontFace: fb ? B_FALLBACK : this.font, fontSize: size, color, bold, lang: fb ? "en-US" : "fa-IR" } };
    });
  }
  /** نمودار نمی‌تواند چند فونت داشته باشد؛ برای فونت B از Tahoma (دارای حروف فارسی و لاتین) استفاده می‌شود */
  private get cfont() { return isBFont(this.font) ? "Tahoma" : this.font; }

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

  /** مستطیل گرد با خط‌دور اختیاری (قالب آکادمیک) */
  private round(s: PptxGenJS.Slide, x: number, y: number, w: number, h: number, fill: string, line?: string, r?: number, lw = 1.25) {
    s.addShape(this.p.ShapeType.roundRect, {
      x, y, w, h, fill: { color: fill },
      line: line ? { color: line, width: lw } : ({ type: "none" } as any),
      rectRadius: Math.min(r ?? 0.05 * Math.min(w, h), Math.min(w, h) / 2),
    });
  }

  /** کارت پس‌زمینه: کلاسیک = همان سطح ساده‌ی قبلی؛ آکادمیک = کارت سفید گرد با خط‌دور */
  private card(s: PptxGenJS.Slide, x: number, y: number, w: number, h: number) {
    if (this.ac) this.round(s, x, y, w, h, this.A.card, this.t.primary, 0.2, 1);
    else this.shape(s, x, y, w, h, this.t.surface);
  }
  private bgc() { return this.ac ? this.A.bg : this.t.bg; }
  /** رنگ دایره‌ی شماره‌دار/آیکن */
  private bc(i: number) { return this.ac ? badgeColor(this.t, i) : this.t.primary; }

  private text(s: PptxGenJS.Slide, x: number, y: number, w: number, h: number, paras: string[],
    size: number, color: string, o: TextOpts = {}) {
    const face = o.font ?? this.font, size2 = o.font ? size : Math.round(size * this.fs * 2) / 2;
    const runs = paras.flatMap((para) => {
      const para0 = {
        breakLine: true,
        rtlMode: true, // جهت پاراگراف راست‌به‌چپ
        lang: "fa-IR",
        align: o.align ?? "right",
        fontFace: face,
        fontSize: size2,
        bold: !!o.bold,
        color,
        lineSpacingMultiple: 1.15,
        paraSpaceAfter: o.space ?? 8,
        ...(o.bullet === "number" ? { bullet: { type: "number", indent: 28 } }
          : o.bullet ? { bullet: { characterCode: "2022", indent: 25 } } : {}),
      };
      const txt = this.txt(para);
      // فونت B: تکه‌های لاتین/علامت‌های ناموجود جدا و با Times New Roman نوشته می‌شوند (فقط اولین تکه‌ی هر پاراگراف گزینه‌های پاراگراف را می‌گیرد)
      const segs = !o.font && isBFont(this.font) ? txt.split(B_MISSING).filter((x) => x !== "") : [txt];
      if (segs.length <= 1 && !(segs[0] && B_MISSING.test(segs[0]) && !o.font && isBFont(this.font))) return [{ text: txt, options: para0 }];
      return segs.map((t, k) => {
        const fb = isBFont(this.font) && B_MISSING.test(t) && t.replace(B_MISSING, "") === "";
        const last = k === segs.length - 1;
        const run = { fontFace: fb ? B_FALLBACK : face, fontSize: size2, bold: !!o.bold, color, lang: fb ? "en-US" : "fa-IR", breakLine: last };
        return { text: t, options: k === 0 ? { ...para0, ...run } : run };
      });
    });
    s.addText(runs as any, { x, y, w, h, margin: 0, valign: o.valign ?? "top", fit: "none", wrap: true });
  }

  private title(s: PptxGenJS.Slide, text: string) {
    if (this.ac) {
      this.round(s, M, 0.45, W - 2 * M, 0.95, this.A.card, this.t.primary, 0.475, 1.25);
      this.shape(s, W - M - 0.55, 0.45 + 0.475 - 0.14, 0.28, 0.28, this.t.accent, "ellipse");
      const tw = W - 2 * M - 1.4;
      this.text(s, M + 0.7, 0.45, tw, 0.95, [text], fitSize([text], tw, 0.95, 34, 20, false, 0), this.t.primary, { bold: true, align: "center", valign: "middle", space: 0 });
      return;
    }
    const size = fitSize([text], W - 2 * M, 1.0, 34, 22, false, 0);
    this.text(s, M, 0.55, W - 2 * M, 1.0, [text], size, this.t.primary, { bold: true, valign: "middle", space: 0 });
  }

  private number(s: PptxGenJS.Slide, n: number) {
    if (this.ac) {
      this.shape(s, 0.55, 6.82, 0.5, 0.5, this.t.primary, "ellipse");
      this.text(s, 0.55, 6.82, 0.5, 0.5, [String(n)], 12, this.t.onPrimary, { bold: true, align: "center", valign: "middle", space: 0 });
      return;
    }
    this.text(s, 0.6, 6.95, 1.0, 0.3, [String(n)], 11, this.t.muted, { align: "left", space: 0 });
  }

  /** نوار پیشرفت کناری (قالب آکادمیک): یک نقطه برای هر اسلاید (حداکثر ۱۲)، نقطه‌ی فعال نارنجی و بزرگ‌تر */
  private rail(s: PptxGenJS.Slide, i: number, n: number) {
    const { ys, active } = railDots(i, n);
    s.addShape(this.p.ShapeType.line, { x: RAIL.x, y: RAIL.top, w: 0, h: RAIL.bottom - RAIL.top, line: { color: this.t.muted, width: 1, dashType: "dash" } });
    ys.forEach((y, k) => {
      if (k === active) this.shape(s, RAIL.x - 0.13, y - 0.13, 0.26, 0.26, this.t.accent, "ellipse");
      else this.shape(s, RAIL.x - 0.06, y - 0.06, 0.12, 0.12, this.t.muted, "ellipse", 70);
    });
  }

  /** اسلاید ابتدایی «بسم‌الله» (قالب آکادمیک): خط‌نویسی روی کارت سفید گرد؛ کارت روی هر تمی سفید می‌ماند تا خط مشکی دیده شود */
  private acBismillah() {
    const t = this.t, A = this.A, s = this.slide(A.bg);
    this.shape(s, -1.6, -1.8, 4.6, 4.6, t.accent, "ellipse", 28);
    this.shape(s, 10.6, 4.9, 4.6, 4.6, t.primary, "ellipse", 22);
    const cw = 6.6, ch = 6.1, cx = (W - cw) / 2, cy = (H - ch) / 2;
    this.round(s, cx, cy, cw, ch, "FFFFFF", t.primary, 0.3, 2);
    this.round(s, W / 2 - 0.6, cy + 0.3, 1.2, 0.1, t.accent, undefined, 0.05);
    const ih = ch - 1.0, iw = ih * BISMILLAH_IMG.w / BISMILLAH_IMG.h;
    s.addImage({ data: `image/png;base64,${BISMILLAH_IMG.b64}`, x: (W - iw) / 2, y: cy + 0.65, w: iw, h: ih, altText: BISMILLAH });
    return s;
  }

  private acTitle(sd: Slide, closing: boolean) {
    const t = this.t, A = this.A, s = this.slide(A.bg);
    this.shape(s, -1.6, -1.8, 4.6, 4.6, t.accent, "ellipse", 28);
    this.shape(s, 10.6, 4.9, 4.6, 4.6, t.primary, "ellipse", 22);
    this.round(s, M, 1.2, W - 2 * M, 3.55, A.card, t.primary, 0.3, 2);
    this.round(s, W - M - 1.6, 1.55, 1.0, 0.1, t.accent, undefined, 0.05);
    const tw = W - 2 * M - 1.2;
    this.text(s, M + 0.6, 1.8, tw, 2.8, [sd.title], fitSize([sd.title], tw, 2.8, 46, 26, false, 0), A.head,
      { bold: true, align: closing ? "center" : "right", valign: "middle", space: 0 });
    const sub = (sd.subtitle ? [sd.subtitle] : sd.bullets.slice(0, 3)).filter(Boolean);
    pillRow(sub.length, W, M).forEach((pos, i) => {
      this.round(s, pos.x, 5.1, pos.w, 1.25, i % 2 ? t.accent : t.primary, undefined, 0.5);
      this.text(s, pos.x + 0.3, 5.1, pos.w - 0.6, 1.25, [sub[i]], fitSize([sub[i]], pos.w - 0.6, 1.25, 22, 14, false, 0), t.onPrimary, { bold: true, align: "center", valign: "middle", space: 0 });
    });
    return s;
  }

  private acSection(sd: Slide, n: number) {
    const t = this.t, s = this.slide(t.primary);
    this.shape(s, -1.5, 4.2, 5.5, 5.5, t.dark, "ellipse", 45);
    this.shape(s, 10.4, -2.0, 5.0, 5.0, t.accent, "ellipse", 25);
    this.shape(s, W - M - 2.0, 2.3, 1.7, 1.7, t.accent, "ellipse");
    this.text(s, W - M - 2.0, 2.3, 1.7, 1.7, [String(n)], 60, t.onPrimary, { bold: true, align: "center", valign: "middle", space: 0 });
    const tw = W - 2 * M - 2.8;
    this.text(s, M + 0.4, 2.2, tw, 1.9, [sd.title], fitSize([sd.title], tw, 1.9, 44, 26, false, 0), t.onPrimary, { bold: true, valign: "middle", space: 0 });
    if (sd.subtitle) this.text(s, M + 0.4, 4.4, W - 2 * M - 0.8, 1.0, [sd.subtitle], 20, t.onPrimary);
    return s;
  }

  // ---------- چیدمان‌ها ----------
  private titleLike(sd: Slide, closing: boolean) {
    if (this.ac) return this.acTitle(sd, closing);
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
    if (this.ac) return this.acSection(sd, n);
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
    const s = this.slide(this.bgc());
    this.title(s, sd.title);
    this.card(s, M, 1.8, W - 2 * M, 4.85);
    if (this.ac) this.round(s, W - M - 0.32, 2.2, 0.1, 4.25, this.t.accent, undefined, 0.05);
    const paras = sd.bullets.length ? sd.bullets : [""];
    const iw = W - 2 * M - 1.0, ih = 4.1;
    this.text(s, M + 0.5, 2.15, iw, ih, paras, fitSize(paras, iw, ih, 26, 15, true), this.t.text,
      { bullet: true, valign: "middle" });
    return s;
  }

  private imageText(sd: Slide, img: Uint8Array) {
    const s = this.slide(this.bgc());
    this.title(s, sd.title);
    // عکس‌های واقعی وب نسبت‌های مختلفی دارند و گاهی متن/لوگو در لبه‌هایشان است؛ با cover لبه‌ها بریده می‌شد.
    // با sizing=contain کل تصویر (بدون برش و بدون کشیدگی) وسط کادر می‌نشیند؛ پشتش کادر هم‌رنگ سطح اسلاید است.
    // w/h = ابعاد (نسبت) خود تصویر، و sizing.w/h = اندازه‌ی کادر
    this.card(s, M, 1.8, IMAGE_BOX.w, IMAGE_BOX.h);
    const png = img[0] === 0x89 && img[1] === 0x50; // امضای PNG
    const d = imageSize(img), aspect = d && d.w > 0 && d.h > 0 ? d.w / d.h : 1; // نسبت واقعی تصویر (عکس‌های واقعی مربع نیستند)
    s.addImage({
      data: `image/${png ? "png" : "jpeg"};base64,${toBase64(img)}`, x: M, y: 1.8,
      w: IMAGE_BOX.h * aspect, h: IMAGE_BOX.h, sizing: { type: "contain", w: IMAGE_BOX.w, h: IMAGE_BOX.h },
    });
    const tx = W / 2 + 0.1, tw = W / 2 - M - 0.1;
    const paras = sd.bullets.length ? sd.bullets : [""];
    this.text(s, tx, 1.8, tw, 4.85, paras, fitSize(paras, tw, 4.85, 24, 15, true), this.t.text,
      { bullet: true, valign: "middle" });
    return s;
  }

  /** ۲ یا ۳ ستون (مقایسه، سه محور)؛ ستون اول سمت راست */
  private columns(sd: Slide, n: 2 | 3) {
    const s = this.slide(this.bgc());
    this.title(s, sd.title);
    const gap = n === 3 ? 0.3 : 0.4, cw = (W - 2 * M - gap * (n - 1)) / n, pad = n === 3 ? 0.25 : 0.35;
    sd.columns.slice(0, n).forEach((col, i) => {
      const x = W - M - (i + 1) * cw - i * gap;
      this.card(s, x, 1.8, cw, 4.85);
      if (this.ac) {
        this.round(s, x + 0.2, 2.0, cw - 0.4, 0.75, this.bc(i), undefined, 0.375);
        this.text(s, x + 0.35, 2.0, cw - 0.7, 0.75, [col.heading], n === 3 ? 20 : 22, this.t.onPrimary, { bold: true, align: "center", valign: "middle", space: 0 });
      } else this.text(s, x + pad, 2.05, cw - 2 * pad, 0.7, [col.heading], n === 3 ? 22 : 24, this.t.primary, { bold: true, valign: "middle" });
      const b = col.bullets.length ? col.bullets : [""];
      this.text(s, x + pad, 2.95, cw - 2 * pad, 3.4, b, fitSize(b, cw - 2 * pad, 3.4, n === 3 ? 20 : 22, 14, true), this.t.text, { bullet: true });
    });
    return s;
  }

  /** خط زمان: مرحله‌ی اول سمت راست؛ تاریخ/عنوان بالای خط و توضیح زیر آن */
  private timeline(sd: Slide) {
    const s = this.slide(this.bgc());
    this.title(s, sd.title);
    const st = sd.steps!.slice(0, 6), n = st.length, tw = W - 2 * M, cw = tw / n, ly = 3.4, w = cw - 0.2;
    this.shape(s, M, ly - 0.03, tw, 0.06, this.t.muted);
    st.forEach((x, i) => {
      const cx = W - M - (i + 0.5) * cw;
      this.shape(s, cx - 0.3, ly - 0.3, 0.6, 0.6, this.bc(i), "ellipse");
      if (this.ac) this.card(s, cx - w / 2, 3.85, w, 2.85);
      this.text(s, cx - 0.3, ly - 0.3, 0.6, 0.6, [String(i + 1)], 18, this.t.onPrimary, { bold: true, align: "center", valign: "middle", space: 0 });
      this.text(s, cx - w / 2, 2.0, w, 0.85, [x.label], fitSize([x.label], w, 0.85, 22, 14, false, 0), this.t.primary, { bold: true, align: "center", valign: "bottom", space: 0 });
      this.text(s, cx - w / 2, 3.95, w, 2.65, [x.text], fitSize([x.text], w, 2.65, 20, 13, false, 0), this.t.text, { align: "center", space: 0 });
    });
    return s;
  }

  /** فرایند: کارت‌های شماره‌دار با فلش به چپ (جهت خواندن فارسی) */
  private process(sd: Slide) {
    const s = this.slide(this.bgc());
    this.title(s, sd.title);
    const st = sd.steps!.slice(0, 5), n = st.length, gap = 0.55, cw = (W - 2 * M - gap * (n - 1)) / n;
    st.forEach((x, i) => {
      const x0 = W - M - (i + 1) * cw - i * gap;
      this.card(s, x0, 2.0, cw, 3.9);
      this.shape(s, x0 + cw / 2 - 0.32, 2.25, 0.64, 0.64, this.bc(i), "ellipse");
      this.text(s, x0 + cw / 2 - 0.32, 2.25, 0.64, 0.64, [String(i + 1)], 20, this.t.onPrimary, { bold: true, align: "center", valign: "middle", space: 0 });
      this.text(s, x0 + 0.2, 3.1, cw - 0.4, 0.85, [x.label], fitSize([x.label], cw - 0.4, 0.85, 22, 14, false, 0), this.t.primary, { bold: true, align: "center", valign: "middle", space: 0 });
      this.text(s, x0 + 0.2, 4.0, cw - 0.4, 1.7, [x.text], fitSize([x.text], cw - 0.4, 1.7, 18, 13, false, 0), this.t.text, { align: "center", space: 0 });
      if (i < n - 1) s.addShape(this.p.ShapeType.leftArrow, { x: x0 - gap + 0.09, y: 3.7, w: gap - 0.18, h: 0.4, fill: { color: this.t.accent }, line: { type: "none" } as any });
    });
    return s;
  }

  /** نقل‌قول یا پیام کلیدی روی زمینه‌ی تیره */
  private quote(sd: Slide) {
    const s = this.slide(this.t.dark);
    this.shape(s, 9.8, -2.2, 5.0, 5.0, this.t.primary, "ellipse", 45);
    const q = sd.quote!, tw = W - 2 * M - 1.2;
    this.text(s, M + 0.6, 0.6, tw, 0.6, [sd.title], 22, this.t.accent, { bold: true, space: 0 });
    if (q.author) this.text(s, W - M - 2.6, 1.1, 2.0, 1.3, ["\u201C"], 90, this.t.accent, { bold: true, space: 0 });
    this.text(s, M + 0.6, 2.3, tw, 2.9, [q.text], fitSize([q.text], tw, 2.9, 38, 22, false, 0), this.t.onPrimary, { bold: true, align: "center", valign: "middle", space: 0 });
    if (q.author) this.text(s, M + 0.6, 5.4, tw, 0.7, ["\u2014 " + q.author], 22, this.t.onPrimary, { align: "center", space: 0 });
    return s;
  }

  /** کارت‌های آیکن‌دار (۲ تا ۴ مورد)؛ آیکن ایموجی داخل دایره */
  private icons(sd: Slide) {
    const s = this.slide(this.bgc());
    this.title(s, sd.title);
    const items = sd.items!.slice(0, 4), n = items.length, gap = 0.35, cw = (W - 2 * M - gap * (n - 1)) / n;
    items.forEach((it, i) => {
      const x0 = W - M - (i + 1) * cw - i * gap;
      this.card(s, x0, 1.9, cw, 4.3);
      this.shape(s, x0 + cw / 2 - 0.55, 2.2, 1.1, 1.1, this.bc(i), "ellipse");
      this.text(s, x0 + cw / 2 - 0.55, 2.2, 1.1, 1.1, [iconOf(it.icon)], 34, this.t.onPrimary, { align: "center", valign: "middle", space: 0, font: "Segoe UI Emoji" });
      this.text(s, x0 + 0.2, 3.55, cw - 0.4, 0.85, [it.heading], fitSize([it.heading], cw - 0.4, 0.85, 22, 14, false, 0), this.t.primary, { bold: true, align: "center", valign: "middle", space: 0 });
      this.text(s, x0 + 0.25, 4.45, cw - 0.5, 1.55, [it.text], fitSize([it.text], cw - 0.5, 1.55, 18, 13, false, 0), this.t.text, { align: "center", space: 0 });
    });
    return s;
  }

  private stats(sd: Slide) {
    const s = this.slide(this.bgc());
    this.title(s, sd.title);
    const stats = sd.stats.slice(0, 4);
    const n = Math.max(1, stats.length), gap = 0.35, cw = (W - 2 * M - gap * (n - 1)) / n;
    stats.forEach((st, i) => {
      const x = W - M - (i + 1) * cw - i * gap;
      this.card(s, x, 2.0, cw, 3.0);
      this.text(s, x + 0.2, 2.3, cw - 0.4, 1.3, [st.value], st.value.length <= 6 ? 48 : 32, this.t.primary,
        { bold: true, align: "center", valign: "middle", space: 0 });
      this.text(s, x + 0.25, 3.7, cw - 0.5, 1.1, [st.label], fitSize([st.label], cw - 0.5, 1.1, 20, 13, false, 0),
        this.t.muted, { align: "center", space: 0 });
    });
    if (sd.bullets.length) this.text(s, M, 5.4, W - 2 * M, 1.2, sd.bullets.slice(0, 2), 18, this.t.text, { bullet: true });
    return s;
  }

  private table(sd: Slide) {
    const s = this.slide(this.bgc());
    this.title(s, sd.title);
    const t = sd.table!;
    const n = t.headers.length, tw = W - 2 * M;
    const size = Math.max(13, (t.rows.length <= 4 ? 20 : t.rows.length <= 6 ? 18 : 16) - (n >= 5 ? 3 : n === 4 ? 1 : 0));
    const rowH = Math.min(0.8, 4.7 / (t.rows.length + 1));
    const rev = <T,>(a: T[]) => [...a].reverse(); // ستون اول سمت راست
    const cell = (text: string, color: string, fill: string, bold = false) => ({
      text: this.cellRuns(text, size, color, bold),
      options: { fontFace: this.font, fontSize: size, color, bold, align: "right" as const, valign: "middle" as const,
        rtlMode: true, lang: "fa-IR", fill: { color: fill },
        border: [{ type: "none" }, { type: "none" }, { type: "solid", pt: 0.75, color: this.t.muted }, { type: "none" }] as any },
    });
    const rows = [
      rev(t.headers).map((h) => cell(h, this.t.onPrimary, this.t.primary, true)),
      ...t.rows.map((r, i) => rev(r).map((c) => cell(c, this.t.text, i % 2 ? (this.ac ? this.A.card : this.t.bg) : this.t.surface))),
    ];
    s.addTable(rows as any, { x: M, y: 1.85, w: tw, colW: Array(n).fill(tw / n), rowH });
    return s;
  }

  private chart(sd: Slide) {
    const s = this.slide(this.bgc());
    this.title(s, sd.title);
    const c = sd.chart!;
    const hasText = sd.bullets.length > 0;
    const labels = c.labels.map((l) => this.txt(l));
    const data = c.series.map((se, i) => ({ name: this.txt(se.name || `سری ${i + 1}`), labels, values: se.values }));
    const palette = [this.t.primary, this.t.accent, "E0A93B", "2F7D5B", "D9482B", "5B3FA6", this.t.muted, "14B8A6"];
    const ring = c.type === "pie" || c.type === "doughnut"; // سهم اجزا از یک کل
    const stacked = c.type === "stacked";
    const type = c.type === "line" ? this.p.ChartType.line : c.type === "pie" ? this.p.ChartType.pie : c.type === "doughnut" ? this.p.ChartType.doughnut : this.p.ChartType.bar;
    const font = { fontFace: this.cfont, color: this.t.text } as const;
    const cwid = hasText ? 7.0 : W - 2 * M;
    if (this.ac) this.card(s, M, 1.8, cwid, 4.55);
    s.addChart(type, data as any, {
      x: this.ac ? M + 0.15 : M, y: this.ac ? 1.9 : 1.8, w: this.ac ? cwid - 0.3 : cwid, h: this.ac ? 4.35 : 4.55,
      chartColors: ring ? palette.slice(0, labels.length) : palette.slice(0, data.length),
      showLegend: ring || data.length > 1, legendPos: "b", legendFontFace: this.cfont, legendFontSize: 14, legendColor: this.t.text,
      catAxisLabelFontFace: this.cfont, catAxisLabelFontSize: 14, catAxisLabelColor: this.t.text,
      valAxisLabelFontFace: this.cfont, valAxisLabelFontSize: 13, valAxisLabelColor: this.t.muted,
      valGridLine: { color: this.t.muted, size: 0.5, style: "dash" } as any, catGridLine: { style: "none" } as any,
      showValue: !ring, showPercent: ring, dataLabelFontFace: this.cfont, dataLabelFontSize: 13, dataLabelColor: ring || stacked ? "FFFFFF" : font.color,
      ...(c.type === "line" ? { lineSize: 3, lineDataSymbolSize: 9 } : {}),
      ...(c.type === "bar" || stacked ? { barGapWidthPct: 60 } : {}),
      ...(stacked ? { barGrouping: "stacked" } : {}),
      ...(c.type === "doughnut" ? { holeSize: 55 } : {}),
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
    const s = this.slide(this.bgc());
    this.title(s, sd.title);
    this.card(s, M, 1.8, W - 2 * M, foot ? 4.5 : 4.85);
    if (this.ac) this.round(s, W - M - 0.32, 2.15, 0.1, foot ? 4.0 : 4.25, this.t.accent, undefined, 0.05);
    const colBullets = sd.columns.flatMap((c) => c.bullets);
    const paras = sd.bullets.length ? sd.bullets : colBullets.length ? colBullets : [""];
    const iw = W - 2 * M - 1.0, ih = foot ? 3.8 : 4.1;
    this.text(s, M + 0.5, 2.1, iw, ih, paras, fitSize(paras, iw, ih, foot ? 22 : 26, 14, true, 12), this.t.text,
      { bullet: "number", valign: "middle", space: 12 });
    if (foot) this.text(s, M, 6.45, W - 2 * M, 0.35, [foot], 11, this.t.muted, { space: 0 });
    return s;
  }

  // ---------- ساخت نهایی ----------
  async build(deck: Deck): Promise<Uint8Array> {
    let sec = 0;
    if (this.ac) this.acBismillah(); // اسلاید «بسم‌الله» فقط در قالب آکادمیک؛ در شماره‌گذاری نمی‌آید
    deck.slides.forEach((sd, i) => {
      const lay = sd.layout;
      let s: PptxGenJS.Slide;
      const img = this.images.get(i);
      if (lay === "title" || lay === "closing") s = this.titleLike(sd, lay === "closing");
      else if (lay === "section") s = this.section(sd, ++sec);
      else if (lay === "image_text" && img) s = this.imageText(sd, img);
      else if (lay === "three_column" && sd.columns.length >= 3) s = this.columns(sd, 3);
      else if (lay === "two_column" && sd.columns.length) s = this.columns(sd, 2);
      else if (lay === "timeline" && sd.steps?.length) s = this.timeline(sd);
      else if (lay === "process" && sd.steps?.length) s = this.process(sd);
      else if (lay === "quote" && sd.quote) s = this.quote(sd);
      else if (lay === "icons" && sd.items?.length) s = this.icons(sd);
      else if (lay === "stats" && sd.stats.length) s = this.stats(sd);
      else if (lay === "table" && sd.table) s = this.table(sd);
      else if (lay === "chart" && sd.chart) s = this.chart(sd);
      else if (lay === "sources") s = this.numbered(sd, "منابع پیشنهادی برای مطالعه‌ی بیشتر؛ پیش از ارجاع، وجود و صحت آن‌ها را بررسی کنید.");
      else if (lay === "questions") s = this.numbered(sd);
      else s = this.bullets(sd);
      if (lay !== "title" && lay !== "closing" && lay !== "section") this.number(s, i + 1);
      if (this.ac && lay !== "title" && lay !== "closing" && lay !== "section" && !(lay === "quote" && sd.quote)) this.rail(s, i, deck.slides.length);
      if (sd.notes) s.addNotes(this.txt(sd.notes));
    });
    this.p.title = deck.title;
    // compression:false = ذخیره بدون فشرده‌سازی؛ مصرف CPU را (برای سقف ۱۰ms پلن رایگان) پایین نگه می‌دارد
    const out = await this.p.write({ outputType: "uint8array", compression: false });
    return out as Uint8Array;
  }
}
