/**
 * «قالب» اسلاید = سبک چیدمان و تزئین (مستقل از «تم رنگی»).
 *  classic  : همان طراحی قبلی (بدون هیچ تغییری).
 *  academic : قالب پیش‌فرض؛ برگرفته از «نسخه‌ی اسلایدمستر»: اسلاید «بسم‌الله» در ابتدا، قاب‌های گرد با خط‌دور، عنوان داخل کپسول،
 *             کپسول‌های رنگی، شماره‌ی گرد و نوار پیشرفت کناری (خط‌چین).
 * pptx.ts و preview.ts هر دو از همین ثابت‌ها استفاده می‌کنند تا فایل و پیش‌نمایش یکی بمانند.
 */
import type { Theme } from "./themes";

export const TEMPLATES = {
  academic: { name: "آکادمیک مدرن", emoji: "🎓", hint: "اسلاید «بسم‌الله» در ابتدا، کارت‌های گرد، عنوان قاب‌دار، کپسول‌های رنگی و نوار پیشرفت کناری؛ مناسب دفاع و ارائه‌ی رسمی" },
  classic: { name: "کلاسیک", emoji: "🎨", hint: "طراحی ساده و تخت؛ همان قالب همیشگی" },
} as const;
export type TemplateKey = keyof typeof TEMPLATES;
export const DEFAULT_TEMPLATE: TemplateKey = "academic";
export const isTemplate = (v: unknown): v is TemplateKey => typeof v === "string" && Object.hasOwn(TEMPLATES, v);

/** متن اسلاید ابتدایی قالب آکادمیک (قبل از اسلاید عنوان)؛ شماره‌ی اسلایدها شامل همین اسلاید است، مثل فایل اسلایدمستر */
export const BISMILLAH = "بسم الله الرحمن الرحیم";

/** رنگ‌های قالب آکادمیک بر پایه‌ی تم: روی تم روشن زمینه‌ی خاکستری روشن (مثل اسلایدمستر) با کارت سفید؛ روی تم تیره همان رنگ‌های خود تم */
export function academicPalette(t: Theme) {
  const light = t.bg.toUpperCase() === "FFFFFF";
  return { bg: light ? "EBEBF0" : t.bg, card: light ? "FFFFFF" : t.surface, head: light ? t.dark : t.onPrimary, line: t.primary };
}

/** رنگ کپسول/دایره‌ی شماره‌دار: به‌نوبت رنگ اصلی و رنگ تأکید */
export const badgeColor = (t: Theme, i: number) => (i % 2 ? t.accent : t.primary);

/** نوار پیشرفت کناری (سمت راست، داخل حاشیه): موقعیت نقطه‌ها و نقطه‌ی فعال؛ برای ارائه‌های بلند نقطه‌ها فشرده می‌شوند */
export const RAIL = { x: 12.93, top: 1.0, bottom: 6.5, maxDots: 12 };
export function railDots(i: number, n: number): { ys: number[]; active: number } {
  const count = Math.max(1, Math.min(n, RAIL.maxDots));
  const ys = Array.from({ length: count }, (_, k) => (count === 1 ? (RAIL.top + RAIL.bottom) / 2 : RAIL.top + (k * (RAIL.bottom - RAIL.top)) / (count - 1)));
  const active = n <= RAIL.maxDots || n <= 1 ? Math.min(i, count - 1) : Math.round((i * (count - 1)) / (n - 1));
  return { ys, active };
}

/** ردیف کپسول‌های زیر عنوان (اسلاید عنوان/پایان): مختصات هر کپسول؛ یک کپسول وسط‌چین، چند کپسول در تمام عرض (اولی سمت راست) */
export function pillRow(k: number, W: number, M: number, gap = 0.3): { x: number; w: number }[] {
  if (k <= 0) return [];
  if (k === 1) { const w = Math.min(W - 2 * M, 9); return [{ x: (W - w) / 2, w }]; }
  const w = (W - 2 * M - gap * (k - 1)) / k;
  return Array.from({ length: k }, (_, i) => ({ x: W - M - (i + 1) * w - i * gap, w }));
}
