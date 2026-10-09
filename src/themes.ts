export interface Theme {
  name: string; bg: string; surface: string; primary: string; dark: string;
  accent: string; text: string; muted: string; onPrimary: string;
}

export const THEMES: Record<string, Theme> = {
  ocean: { name: "اقیانوس", bg: "FFFFFF", surface: "EAF2FB", primary: "1F4E8C", dark: "14335C", accent: "2E9CCA", text: "1B2733", muted: "6B7A8C", onPrimary: "FFFFFF" },
  forest: { name: "جنگل", bg: "FFFFFF", surface: "EAF5EE", primary: "2F7D5B", dark: "1D4D38", accent: "E0A93B", text: "1E2B24", muted: "6A7B71", onPrimary: "FFFFFF" },
  sunset: { name: "غروب", bg: "FFFFFF", surface: "FDEFE7", primary: "D9482B", dark: "8E2A16", accent: "F2A541", text: "2B1E1A", muted: "8A7168", onPrimary: "FFFFFF" },
  royal: { name: "سلطنتی", bg: "FFFFFF", surface: "F0ECF9", primary: "5B3FA6", dark: "3A2673", accent: "E05CA0", text: "231B33", muted: "756B8A", onPrimary: "FFFFFF" },
  midnight: { name: "نیمه‌شب", bg: "0F172A", surface: "1E293B", primary: "4F46E5", dark: "0B1120", accent: "22D3EE", text: "F1F5F9", muted: "94A3B8", onPrimary: "FFFFFF" },
};

export const TONES: Record<string, string> = {
  formal: "رسمی و حرفه‌ای",
  friendly: "دوستانه و ساده",
  educational: "آموزشی و روشن",
  persuasive: "متقاعدکننده و انگیزشی",
};

export const FONTS = ["Vazirmatn", "Tahoma", "Arial"] as const;

/** آیکن کارت‌ها: مدل فقط نام (کلید) را می‌نویسد و ایموجی از این جدول می‌آید؛ نام ناشناخته = ستاره */
export const ICONS: Record<string, string> = {
  idea: "💡", growth: "📈", people: "👥", security: "🔒", time: "⏰", money: "💰", target: "🎯", tech: "💻", book: "📚", global: "🌍",
  health: "🩺", settings: "⚙️", check: "✅", warning: "⚠️", star: "⭐", chat: "💬", search: "🔍", shield: "🛡️", speed: "⚡", heart: "❤️",
};
export const iconOf = (name: string) => ICONS[String(name || "").trim().toLowerCase()] ?? ICONS.star;

/** فونت Vazirmatn داخل خود فایل PPTX جاسازی می‌شود (src/embed-font.ts)؛ نیازی به نصب نیست. لینک‌ها فقط برای ویرایش در برنامه‌های دیگر. */
export const FONT_URL = "https://github.com/rastikerdar/vazirmatn/releases/latest";
export const FONT_URL_ALT = "https://fonts.google.com/specimen/Vazirmatn";
/** فونت وزیر داخل فایل جاسازی شده؛ دیگر یادداشت نصب لازم نیست (برای سازگاری با فراخوانی‌ها نگه داشته شد) */
export const fontCaption = (_font: string) => "";
