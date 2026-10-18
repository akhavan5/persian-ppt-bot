import type { Mode } from "./types";

export interface Theme {
  name: string; bg: string; surface: string; primary: string; dark: string;
  accent: string; text: string; muted: string; onPrimary: string;
}

export const THEMES: Record<string, Theme> = {
  ocean: { name: "اقیانوس", bg: "FFFFFF", surface: "EAF2FB", primary: "1F4E8C", dark: "14335C", accent: "2E9CCA", text: "1B2733", muted: "6B7A8C", onPrimary: "FFFFFF" },
  forest: { name: "جنگل", bg: "FFFFFF", surface: "EAF5EE", primary: "2F7D5B", dark: "1D4D38", accent: "E0A93B", text: "1E2B24", muted: "6A7B71", onPrimary: "FFFFFF" },
  sunset: { name: "غروب", bg: "FFFFFF", surface: "FDEFE7", primary: "D9482B", dark: "8E2A16", accent: "F2A541", text: "2B1E1A", muted: "8A7168", onPrimary: "FFFFFF" },
  royal: { name: "سلطنتی", bg: "FFFFFF", surface: "F0ECF9", primary: "5B3FA6", dark: "3A2673", accent: "E05CA0", text: "231B33", muted: "756B8A", onPrimary: "FFFFFF" },
  violet: { name: "بنفش و نارنجی", bg: "FFFFFF", surface: "EEE9FF", primary: "6B3FF5", dark: "3F23A0", accent: "FF9225", text: "262335", muted: "7A7790", onPrimary: "FFFFFF" },
  midnight: { name: "نیمه‌شب", bg: "0F172A", surface: "1E293B", primary: "4F46E5", dark: "0B1120", accent: "22D3EE", text: "F1F5F9", muted: "94A3B8", onPrimary: "FFFFFF" },
};

/** حالت‌های ساخت. minSlides: حداقل اسلاید لازم برای ساختار کامل آن حالت (۰ = بدون حداقل) */
export const MODES: Record<Mode, { name: string; emoji: string; hint: string; minSlides: number }> = {
  normal: { name: "عادی", emoji: "📄", hint: "ساختار آزاد، متناسب با موضوع", minSlides: 0 },
  student: { name: "دانشجویی", emoji: "🎓", hint: "فهرست، مقدمه، بدنه، نتیجه‌گیری و منابع", minSlides: 8 },
  business: { name: "کسب‌وکار", emoji: "💼", hint: "خلاصه‌ی مدیریتی، مسئله و راه‌حل، جدول و نمودار، برنامه‌ی اجرا و گام‌های بعدی", minSlides: 8 },
  teacher: { name: "معلم", emoji: "🍎", hint: "اهداف درس، پرسش آغازین، محتوا، فعالیت کلاسی، جمع‌بندی و پرسش‌های مرور", minSlides: 8 },
  thesis: { name: "دفاع پایان‌نامه", emoji: "🎓", hint: "مسئله، اهداف، پیشینه، روش، یافته‌ها، نتیجه‌گیری، پیشنهادها و منابع", minSlides: 10 },
};
export const isMode = (v: unknown): v is Mode => typeof v === "string" && Object.hasOwn(MODES, v);
export const nextMode = (m: Mode): Mode => { const k = Object.keys(MODES) as Mode[]; return k[(k.indexOf(m) + 1) % k.length]; };

export const TONES: Record<string, string> = {
  formal: "رسمی و حرفه‌ای",
  friendly: "دوستانه و ساده",
  educational: "آموزشی و روشن",
  persuasive: "متقاعدکننده و انگیزشی",
};

export const FONTS = ["Vazirmatn", "B Nazanin", "B Titr", "Tahoma", "Arial"] as const;
/** فونت‌های سری B (نازنین، تیتر): جزو فونت‌های رایج ویندوز/آفیس فارسی‌اند ولی با ربات همراه نیستند؛ باید روی دستگاه نمایش‌دهنده نصب باشند */
export const isBFont = (f: string) => f === "B Nazanin" || f === "B Titr";

/** آیکن کارت‌ها: مدل فقط نام (کلید) را می‌نویسد و ایموجی از این جدول می‌آید؛ نام ناشناخته = ستاره */
export const ICONS: Record<string, string> = {
  idea: "💡", growth: "📈", people: "👥", security: "🔒", time: "⏰", money: "💰", target: "🎯", tech: "💻", book: "📚", global: "🌍",
  health: "🩺", settings: "⚙️", check: "✅", warning: "⚠️", star: "⭐", chat: "💬", search: "🔍", shield: "🛡️", speed: "⚡", heart: "❤️",
};
export const iconOf = (name: string) => ICONS[String(name || "").trim().toLowerCase()] ?? ICONS.star;

/** فونت Vazirmatn داخل فایل PPTX جاسازی نمی‌شود؛ روی دستگاهی که نصبش نکرده، PowerPoint فونت دیگری جایگزین می‌کند. */
/** دانلود مستقیم (Regular + Bold) از خود سایت؛ فایل‌ها در public/fonts */
export const FONT_URL = "https://pptsaz.ir/fonts/Vazirmatn.zip";
export const FONT_URL_ALT = "https://pptsaz.ir/fonts/Vazirmatn-Regular.ttf";
/** فونت‌های سری B (نازنین و تیتر) هم از خود سایت قابل دانلودند (یک فایل zip شامل B Nazanin Regular/Bold و B Titr Bold) */
export const B_FONTS_URL = "https://pptsaz.ir/fonts/BFonts.zip";
/** @font-face فونت B انتخابی برای پیش‌نمایش و PDF؛ آدرس مطلق چون PDF در مرورگرِ بدون مبدأ ساخته می‌شود. B Titr فقط Bold دارد و برای هر دو وزن همان استفاده می‌شود. نویسه‌های لاتین در این فونت‌ها نیست و از Vazirmatn می‌آید (در پشته‌ی فونت). */
export const bFontFaceCss = (font: string): string => {
  const f = (family: string, weight: number, file: string) =>
    `@font-face{font-family:"${family}";font-weight:${weight};font-display:swap;src:url(https://pptsaz.ir/fonts/${file}) format("truetype")}`;
  if (font === "B Nazanin") return f("B Nazanin", 400, "BNazanin.ttf") + f("B Nazanin", 700, "BNazanin-Bold.ttf");
  if (font === "B Titr") return f("B Titr", 400, "BTitr-Bold.ttf") + f("B Titr", 700, "BTitr-Bold.ttf");
  return "";
};
/** یادداشت نصب فونت برای کپشن تلگرام (HTML)؛ برای Vazirmatn و فونت‌های B */
export const fontCaption = (font: string) => font === "Vazirmatn"
  ? `\n\n🔤 برای نمایش درست، فونت <a href="${FONT_URL}">Vazirmatn</a> را روی دستگاهت نصب کن؛ یا در /settings فونت Tahoma را انتخاب کن.`
  : isBFont(font)
    ? `\n\n🔤 برای نمایش درست، فونت ${font} را روی دستگاهت نصب کن: <a href="${B_FONTS_URL}">دانلود فونت‌های B Nazanin و B Titr</a>؛ یا در /settings فونت Tahoma را انتخاب کن.`
    : "";
